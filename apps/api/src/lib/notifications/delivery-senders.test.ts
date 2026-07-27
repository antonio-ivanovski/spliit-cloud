import { NotificationCategory } from '@spliit/domain/notifications'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import '../../test/mocks'
import { prismaMock, sendEmailMock } from '../../test/state'
import {
  assertDeliveryTimeoutOrdering,
  DELIVERY_LEASE_MS,
  PermanentDeliveryError,
  PROVIDER_TIMEOUT_MS,
  SMTP_OPERATION_BUDGET_MS,
  TransientDeliveryError,
} from './delivery-senders'
import { deliverySnapshotV1Schema } from './delivery-snapshot'
import { EmailDeliverySenderImpl } from './email-delivery-sender'
import { PushDeliverySenderImpl } from './push-delivery-sender'

const sendPushMock = vi.hoisted(() => vi.fn(async () => undefined))
vi.mock('./push', () => ({
  sendPushNotification: sendPushMock,
  isPermanentPushError: (error: unknown) => {
    const statusCode = (error as { statusCode?: number } | null)?.statusCode
    return statusCode === 404 || statusCode === 410
  },
}))

const buildEmailUnsubscribeMetadataMock = vi.hoisted(() =>
  vi.fn(
    async () =>
      null as null | {
        url: string
        headers: { 'List-Unsubscribe': string; 'List-Unsubscribe-Post': string }
        textFooter: string
      },
  ),
)
vi.mock('./unsubscribe', () => ({
  buildEmailUnsubscribeMetadata: buildEmailUnsubscribeMetadataMock,
  createEmailUnsubscribeToken: vi.fn(),
  verifyEmailUnsubscribeToken: vi.fn(),
  getEmailUnsubscribeUrl: vi.fn(),
  getEmailUnsubscribePreviewUrl: vi.fn(),
  previewEmailUnsubscribeToken: vi.fn(),
}))

function buildExpenseCreatedSnapshot() {
  return deliverySnapshotV1Schema.parse({
    version: 1,
    kind: 'expense_created',
    category: NotificationCategory.EXPENSE_CREATED,
    occurredAt: '2026-07-02T12:00:00Z',
    actor: { id: 'acct-alice', name: 'Alice' },
    recipient: { accountId: 'acct-bob', displayName: 'Bob' },
    group: { id: 'grp-1', name: 'Trip', type: 'GROUP' },
    expense: {
      id: 'exp-1',
      description: 'Dinner',
      amount: 4500,
      currencyCode: 'EUR',
    },
    link: 'http://localhost:3000/groups/grp-1/expenses/exp-1',
    date: '2026-07-02',
  })
}

const emailSender = new EmailDeliverySenderImpl()
const pushSender = new PushDeliverySenderImpl()

beforeEach(() => {
  sendEmailMock.mockClear()
  sendPushMock.mockClear()
  buildEmailUnsubscribeMetadataMock.mockReset()
  buildEmailUnsubscribeMetadataMock.mockResolvedValue(null)
})

describe('EmailDeliverySenderImpl', () => {
  it('renders the template and forwards a single email to sendEmail', async () => {
    prismaMock.account.findUnique.mockResolvedValue({
      email: 'bob@example.com',
      emailVerified: true,
    } as never)
    const snapshot = buildExpenseCreatedSnapshot()

    await emailSender.send({
      deliveryId: 'delivery-1',
      snapshot,
      recipientAccountId: 'acct-bob',
    })

    expect(sendEmailMock).toHaveBeenCalledTimes(1)
    const message = sendEmailMock.mock.calls[0][0]
    expect(message.to).toBe('bob@example.com')
    expect(message.subject).toContain('added "Dinner"')
    // Group-scoped phrasing must use the group name, not the recipient's
    // display name, even though both are present on the snapshot.
    expect(message.subject).toContain('Trip')
    expect(message.subject).not.toContain('Bob')
    expect(message.html).toContain('Dinner')
    expect(message.headers?.['Message-ID']).toBe('<delivery-1@spliit.app>')
    expect(buildEmailUnsubscribeMetadataMock).not.toHaveBeenCalled()
    expect(message.headers?.['List-Unsubscribe']).toBeUndefined()
  })

  it('throws PermanentDeliveryError when the account is missing', async () => {
    prismaMock.account.findUnique.mockResolvedValue(null as never)
    const snapshot = buildExpenseCreatedSnapshot()

    await expect(
      emailSender.send({
        deliveryId: 'delivery-2',
        snapshot,
        recipientAccountId: 'acct-missing',
      }),
    ).rejects.toBeInstanceOf(PermanentDeliveryError)
    expect(sendEmailMock).not.toHaveBeenCalled()
  })

  it('throws PermanentDeliveryError when the email is not verified', async () => {
    prismaMock.account.findUnique.mockResolvedValue({
      email: 'bob@example.com',
      emailVerified: false,
    } as never)
    const snapshot = buildExpenseCreatedSnapshot()

    await expect(
      emailSender.send({
        deliveryId: 'delivery-3',
        snapshot,
        recipientAccountId: 'acct-bob',
      }),
    ).rejects.toMatchObject({
      name: 'PermanentDeliveryError',
      code: 'TARGET_GONE',
    })
    expect(sendEmailMock).not.toHaveBeenCalled()
  })

  it('adds RFC 8058 headers and footer when the snapshot opts in to unsubscribe', async () => {
    prismaMock.account.findUnique.mockResolvedValue({
      email: 'bob@example.com',
      emailVerified: true,
    } as never)
    buildEmailUnsubscribeMetadataMock.mockResolvedValue({
      url: 'https://api.example.com/email/unsubscribe?token=abc',
      headers: {
        'List-Unsubscribe':
          '<https://api.example.com/email/unsubscribe?token=abc>',
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
      textFooter:
        '\n\nUnsubscribe from expense_created email notifications: https://api.example.com/email/unsubscribe?token=abc',
    })
    const snapshot = {
      ...buildExpenseCreatedSnapshot(),
      unsubscribeCategory: NotificationCategory.EXPENSE_CREATED,
    }

    await emailSender.send({
      deliveryId: 'delivery-4',
      snapshot,
      recipientAccountId: 'acct-bob',
    })

    expect(buildEmailUnsubscribeMetadataMock).toHaveBeenCalledWith({
      accountId: 'acct-bob',
      category: NotificationCategory.EXPENSE_CREATED,
    })
    const message = sendEmailMock.mock.calls[0][0]
    expect(message.headers?.['List-Unsubscribe']).toBe(
      '<https://api.example.com/email/unsubscribe?token=abc>',
    )
    expect(message.headers?.['List-Unsubscribe-Post']).toBe(
      'List-Unsubscribe=One-Click',
    )
    expect(message.text).toContain('Unsubscribe from expense_created')
  })

  it('classifies SMTP 5xx as PermanentDeliveryError', async () => {
    prismaMock.account.findUnique.mockResolvedValue({
      email: 'bob@example.com',
      emailVerified: true,
    } as never)
    sendEmailMock.mockRejectedValueOnce(
      Object.assign(new Error('mailbox unavailable'), {
        code: 'EENVELOPE',
        responseCode: 550,
      }),
    )

    await expect(
      emailSender.send({
        deliveryId: 'delivery-5',
        snapshot: buildExpenseCreatedSnapshot(),
        recipientAccountId: 'acct-bob',
      }),
    ).rejects.toBeInstanceOf(PermanentDeliveryError)
  })

  it('classifies SMTP 4xx as TransientDeliveryError', async () => {
    prismaMock.account.findUnique.mockResolvedValue({
      email: 'bob@example.com',
      emailVerified: true,
    } as never)
    sendEmailMock.mockRejectedValueOnce(
      Object.assign(new Error('try again'), {
        code: 'ETIMEDOUT',
        responseCode: 421,
      }),
    )

    await expect(
      emailSender.send({
        deliveryId: 'delivery-6',
        snapshot: buildExpenseCreatedSnapshot(),
        recipientAccountId: 'acct-bob',
      }),
    ).rejects.toBeInstanceOf(TransientDeliveryError)
  })

  it('redacts long SMTP error messages before throwing', async () => {
    prismaMock.account.findUnique.mockResolvedValue({
      email: 'bob@example.com',
      emailVerified: true,
    } as never)
    const longMessage = `line1\nline2\n${'x'.repeat(500)}`
    sendEmailMock.mockRejectedValueOnce(
      Object.assign(new Error(longMessage), {
        code: 'EENVELOPE',
        responseCode: 550,
      }),
    )

    let captured: unknown
    try {
      await emailSender.send({
        deliveryId: 'delivery-7',
        snapshot: buildExpenseCreatedSnapshot(),
        recipientAccountId: 'acct-bob',
      })
    } catch (err) {
      captured = err
    }
    expect(captured).toBeInstanceOf(PermanentDeliveryError)
    if (captured instanceof PermanentDeliveryError) {
      expect(captured.message).not.toContain('\n')
      expect(captured.message.length).toBeLessThanOrEqual(300)
      expect(captured.providerStatus).toBe(550)
    }
  })
})

describe('PushDeliverySenderImpl', () => {
  const pushSnapshot = deliverySnapshotV1Schema.parse({
    version: 1,
    kind: 'expense_created',
    category: NotificationCategory.EXPENSE_CREATED,
    occurredAt: '2026-07-02T12:00:00Z',
    actor: { id: 'acct-alice', name: 'Alice' },
    recipient: { accountId: 'acct-bob', displayName: 'Bob' },
    group: { id: 'grp-1', name: 'Trip', type: 'GROUP' },
    expense: {
      id: 'exp-1',
      description: 'Dinner',
      amount: 4500,
      currencyCode: 'EUR',
    },
    link: 'http://localhost:3000/groups/grp-1/expenses/exp-1',
    date: '2026-07-02',
    push: {
      subscriptionId: 'push-1',
      title: 'Expense added',
      body: 'Alice added Dinner',
      url: 'http://localhost:3000/groups/grp-1/expenses/exp-1',
      tag: 'activity:1',
    },
  })

  it('sends a push payload derived from the snapshot', async () => {
    prismaMock.pushSubscription.findUnique.mockResolvedValue({
      id: 'push-1',
      endpoint: 'https://push.example/abc',
      p256dh: 'BNcRdre',
      auth: 'tBHItJI',
    } as never)

    await pushSender.send({
      deliveryId: 'delivery-push-1',
      snapshot: pushSnapshot,
      pushSubscriptionId: 'push-1',
    })

    expect(sendPushMock).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: 'https://push.example/abc' }),
      expect.objectContaining({
        title: 'Expense added',
        body: 'Alice added Dinner',
        url: 'http://localhost:3000/groups/grp-1/expenses/exp-1',
        tag: 'activity:1',
        activityId: 'delivery-push-1',
      }),
    )
  })

  it('throws PermanentDeliveryError and deletes the subscription on 404', async () => {
    prismaMock.pushSubscription.findUnique.mockResolvedValue({
      id: 'push-1',
      endpoint: 'https://push.example/abc',
      p256dh: 'BNcRdre',
      auth: 'tBHItJI',
    } as never)
    prismaMock.pushSubscription.delete.mockResolvedValue({} as never)
    sendPushMock.mockRejectedValueOnce(
      Object.assign(new Error('Not Found'), { statusCode: 404 }),
    )

    await expect(
      pushSender.send({
        deliveryId: 'delivery-push-2',
        snapshot: pushSnapshot,
        pushSubscriptionId: 'push-1',
      }),
    ).rejects.toMatchObject({
      name: 'PermanentDeliveryError',
      code: 'HTTP_404',
      providerStatus: 404,
    })
    expect(prismaMock.pushSubscription.delete).toHaveBeenCalledWith({
      where: { id: 'push-1' },
    })
  })

  it('throws PermanentDeliveryError and deletes the subscription on 410', async () => {
    prismaMock.pushSubscription.findUnique.mockResolvedValue({
      id: 'push-1',
      endpoint: 'https://push.example/abc',
      p256dh: 'BNcRdre',
      auth: 'tBHItJI',
    } as never)
    prismaMock.pushSubscription.delete.mockResolvedValue({} as never)
    sendPushMock.mockRejectedValueOnce(
      Object.assign(new Error('Gone'), { statusCode: 410 }),
    )

    await expect(
      pushSender.send({
        deliveryId: 'delivery-push-3',
        snapshot: pushSnapshot,
        pushSubscriptionId: 'push-1',
      }),
    ).rejects.toMatchObject({
      name: 'PermanentDeliveryError',
      code: 'HTTP_410',
      providerStatus: 410,
    })
    expect(prismaMock.pushSubscription.delete).toHaveBeenCalledWith({
      where: { id: 'push-1' },
    })
  })

  it('still throws PermanentDeliveryError if the conditional delete fails', async () => {
    prismaMock.pushSubscription.findUnique.mockResolvedValue({
      id: 'push-1',
      endpoint: 'https://push.example/abc',
      p256dh: 'BNcRdre',
      auth: 'tBHItJI',
    } as never)
    prismaMock.pushSubscription.delete.mockRejectedValue(new Error('db down'))
    sendPushMock.mockRejectedValueOnce(
      Object.assign(new Error('Not Found'), { statusCode: 404 }),
    )

    await expect(
      pushSender.send({
        deliveryId: 'delivery-push-3b',
        snapshot: pushSnapshot,
        pushSubscriptionId: 'push-1',
      }),
    ).rejects.toBeInstanceOf(PermanentDeliveryError)
  })

  it('throws PermanentDeliveryError when the subscription row is missing', async () => {
    prismaMock.pushSubscription.findUnique.mockResolvedValue(null as never)

    await expect(
      pushSender.send({
        deliveryId: 'delivery-push-4',
        snapshot: pushSnapshot,
        pushSubscriptionId: 'push-missing',
      }),
    ).rejects.toMatchObject({
      name: 'PermanentDeliveryError',
      code: 'TARGET_GONE',
    })
    expect(sendPushMock).not.toHaveBeenCalled()
  })

  it('throws TransientDeliveryError on network errors', async () => {
    prismaMock.pushSubscription.findUnique.mockResolvedValue({
      id: 'push-1',
      endpoint: 'https://push.example/abc',
      p256dh: 'BNcRdre',
      auth: 'tBHItJI',
    } as never)
    sendPushMock.mockRejectedValueOnce(
      Object.assign(new Error('connect ECONNREFUSED'), {
        code: 'ECONNREFUSED',
      }),
    )

    await expect(
      pushSender.send({
        deliveryId: 'delivery-push-5',
        snapshot: pushSnapshot,
        pushSubscriptionId: 'push-1',
      }),
    ).rejects.toMatchObject({
      name: 'TransientDeliveryError',
      code: 'ECONNREFUSED',
    })
    expect(prismaMock.pushSubscription.delete).not.toHaveBeenCalled()
  })

  it('throws TransientDeliveryError on HTTP 429 rate limit', async () => {
    prismaMock.pushSubscription.findUnique.mockResolvedValue({
      id: 'push-1',
      endpoint: 'https://push.example/abc',
      p256dh: 'BNcRdre',
      auth: 'tBHItJI',
    } as never)
    sendPushMock.mockRejectedValueOnce(
      Object.assign(new Error('rate limited'), { statusCode: 429 }),
    )

    await expect(
      pushSender.send({
        deliveryId: 'delivery-push-6',
        snapshot: pushSnapshot,
        pushSubscriptionId: 'push-1',
      }),
    ).rejects.toBeInstanceOf(TransientDeliveryError)
  })

  it('throws TransientDeliveryError on HTTP 503 upstream outage', async () => {
    prismaMock.pushSubscription.findUnique.mockResolvedValue({
      id: 'push-1',
      endpoint: 'https://push.example/abc',
      p256dh: 'BNcRdre',
      auth: 'tBHItJI',
    } as never)
    sendPushMock.mockRejectedValueOnce(
      Object.assign(new Error('service unavailable'), { statusCode: 503 }),
    )

    await expect(
      pushSender.send({
        deliveryId: 'delivery-push-7',
        snapshot: pushSnapshot,
        pushSubscriptionId: 'push-1',
      }),
    ).rejects.toBeInstanceOf(TransientDeliveryError)
  })

  it('redacts the error message before throwing', async () => {
    prismaMock.pushSubscription.findUnique.mockResolvedValue({
      id: 'push-1',
      endpoint: 'https://push.example/abc',
      p256dh: 'BNcRdre',
      auth: 'tBHItJI',
    } as never)
    const longMessage = `${'x'.repeat(500)}`
    sendPushMock.mockRejectedValueOnce(
      Object.assign(new Error(longMessage), { code: 'ECONNREFUSED' }),
    )

    let captured: unknown
    try {
      await pushSender.send({
        deliveryId: 'delivery-push-8',
        snapshot: pushSnapshot,
        pushSubscriptionId: 'push-1',
      })
    } catch (err) {
      captured = err
    }
    expect(captured).toBeInstanceOf(TransientDeliveryError)
    if (captured instanceof TransientDeliveryError) {
      expect(captured.message.length).toBeLessThanOrEqual(300)
      expect(captured.message).not.toContain('\n')
    }
  })
})

describe('assertDeliveryTimeoutOrdering', () => {
  it('accepts smtpBudget < lease < expiry', () => {
    expect(() =>
      assertDeliveryTimeoutOrdering({
        providerTimeoutMs: 30_000,
        leaseDurationMs: 120_000,
        jobExpirySeconds: 300,
      }),
    ).not.toThrow()
  })

  it('rejects when the 3-phase SMTP budget >= leaseDurationMs', () => {
    expect(() =>
      assertDeliveryTimeoutOrdering({
        providerTimeoutMs: 60_000,
        leaseDurationMs: 120_000,
        jobExpirySeconds: 300,
      }),
    ).toThrow(/timeout ordering violated/)
  })

  it('rejects leaseDurationMs >= jobExpiry', () => {
    expect(() =>
      assertDeliveryTimeoutOrdering({
        providerTimeoutMs: 30_000,
        leaseDurationMs: 600_000,
        jobExpirySeconds: 300,
      }),
    ).toThrow(/timeout ordering violated/)
  })

  it('exports the documented default constants', () => {
    expect(PROVIDER_TIMEOUT_MS).toBe(30_000)
    expect(SMTP_OPERATION_BUDGET_MS).toBe(90_000)
    expect(DELIVERY_LEASE_MS).toBe(120_000)
    expect(SMTP_OPERATION_BUDGET_MS).toBeLessThan(DELIVERY_LEASE_MS)
    expect(DELIVERY_LEASE_MS).toBeLessThan(300_000)
  })
})
