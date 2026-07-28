import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  NotificationCategory,
  NotificationChannel,
} from '@spliit/domain/notifications'

import { handleNotificationDelivery } from './notification-delivery'

const hoisted = vi.hoisted(() => {
  class TransientDeliveryError extends Error {
    constructor(
      message: string,
      public readonly code: string,
      public readonly providerStatus?: number,
    ) {
      super(message)
      this.name = 'TransientDeliveryError'
    }
  }

  class PermanentDeliveryError extends Error {
    constructor(
      message: string,
      public readonly code: string,
      public readonly providerStatus?: number,
    ) {
      super(message)
      this.name = 'PermanentDeliveryError'
    }
  }

  return {
    TransientDeliveryError,
    PermanentDeliveryError,
    tx: {} as Record<string, unknown>,
    claimDelivery: vi.fn(),
    markPermanentFailure: vi.fn(),
    markRetryExhausted: vi.fn(),
    markSent: vi.fn(),
    markTransientFailure: vi.fn(),
    normalizeProviderError: vi.fn(),
    emailSend: vi.fn(),
    pushSend: vi.fn(),
  }
})

const mocks = hoisted

// prisma.$transaction accepts either a function (for interactive tx) or an
// array of promises. The delivery handler always passes a function.
vi.mock('@spliit/db', () => ({
  prisma: {
    $transaction: (input: unknown) => {
      if (typeof input === 'function') {
        return (input as (client: unknown) => unknown)(hoisted.tx)
      }
      return Promise.resolve(undefined)
    },
  },
}))

vi.mock('@spliit/api/lib/notifications/delivery-senders', () => ({
  DELIVERY_LEASE_MS: 120_000,
  PROVIDER_TIMEOUT_MS: 30_000,
  assertDeliveryTimeoutOrdering: () => undefined,
  TransientDeliveryError: hoisted.TransientDeliveryError,
  PermanentDeliveryError: hoisted.PermanentDeliveryError,
}))

vi.mock('@spliit/api/lib/notifications/delivery-repository', () => ({
  claimDelivery: hoisted.claimDelivery,
  markPermanentFailure: hoisted.markPermanentFailure,
  markRetryExhausted: hoisted.markRetryExhausted,
  markSent: hoisted.markSent,
  markTransientFailure: hoisted.markTransientFailure,
  normalizeProviderError: hoisted.normalizeProviderError,
}))

vi.mock('@spliit/api/lib/notifications/email-delivery-sender', () => ({
  emailDeliverySender: { send: hoisted.emailSend },
}))

vi.mock('@spliit/api/lib/notifications/push-delivery-sender', () => ({
  pushDeliverySender: { send: hoisted.pushSend },
}))

const TransientDeliveryError = hoisted.TransientDeliveryError
const PermanentDeliveryError = hoisted.PermanentDeliveryError

const LEASE_TOKEN = 'lease-token-1'

function baseDelivery(overrides: Record<string, unknown> = {}) {
  return {
    id: 'delivery-1',
    eventKey: 'evt-1',
    activityId: 'act-1',
    recipientAccountId: 'acct-recipient',
    category: NotificationCategory.EXPENSE_CREATED,
    channel: NotificationChannel.EMAIL,
    targetKey: 'account:acct-recipient',
    pushSubscriptionId: null,
    status: 'PENDING',
    snapshotVersion: 1,
    snapshot: {
      version: 1,
      kind: 'expense_created',
      category: NotificationCategory.EXPENSE_CREATED,
      occurredAt: '2026-07-22T00:00:00.000Z',
      actor: { id: 'acct-actor', name: 'Alice' },
      recipient: { accountId: 'acct-recipient', displayName: 'Trip' },
      group: { id: 'grp-1', name: 'Trip', type: 'GROUP' },
      expense: {
        id: 'exp-1',
        description: 'Dinner',
        amount: 4500,
        currencyCode: 'EUR',
      },
      link: 'https://app.spliit/groups/grp-1/expenses/exp-1',
    },
    attemptCount: 0,
    lastAttemptAt: null,
    leaseToken: null,
    leaseJobId: null,
    leaseExpiresAt: null,
    lastErrorKind: null,
    lastErrorCode: null,
    lastProviderStatus: null,
    lastErrorMessage: null,
    lastErrorAt: null,
    sentAt: null,
    terminalAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

function baseContext(
  overrides: Partial<{
    jobId: string
    retryCount: number
    retryLimit: number
    signal: AbortSignal
  }> = {},
) {
  const controller = new AbortController()
  return {
    boss: {} as never,
    name: 'notification.deliver' as const,
    jobId: 'job-1',
    signal: controller.signal,
    retryCount: 0,
    retryLimit: 5,
    ...overrides,
  }
}

beforeEach(() => {
  mocks.claimDelivery.mockReset()
  mocks.markPermanentFailure.mockReset()
  mocks.markRetryExhausted.mockReset()
  mocks.markSent.mockReset()
  mocks.markTransientFailure.mockReset()
  mocks.normalizeProviderError.mockReset()
  mocks.emailSend.mockReset()
  mocks.pushSend.mockReset()

  mocks.markPermanentFailure.mockResolvedValue(true)
  mocks.markRetryExhausted.mockResolvedValue(true)
  mocks.markSent.mockResolvedValue(true)
  mocks.markTransientFailure.mockResolvedValue(true)
  mocks.normalizeProviderError.mockImplementation(
    (
      error: unknown,
      classification: 'transient' | 'permanent',
      providerStatus?: number,
    ) => {
      const errRecord = error as {
        kind?: string
        code?: string
        message?: string
      } | null
      const allowedKinds = new Set([
        'TRANSIENT',
        'PERMANENT',
        'TARGET_GONE',
        'ENDPOINT_GONE',
        'DATA_CONTRACT',
      ])
      const fallbackKind =
        classification === 'transient' ? 'TRANSIENT' : 'PERMANENT'
      const kind =
        errRecord?.kind && allowedKinds.has(errRecord.kind)
          ? errRecord.kind
          : fallbackKind
      return {
        kind,
        code: errRecord?.code ?? 'UNKNOWN',
        providerStatus,
        message: errRecord?.message ?? 'unknown error',
      }
    },
  )
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('handleNotificationDelivery - claim outcomes', () => {
  it('completes a successful email delivery and marks the row as SENT', async () => {
    mocks.claimDelivery.mockResolvedValue({
      outcome: 'acquired',
      leaseToken: LEASE_TOKEN,
      delivery: baseDelivery(),
    })
    mocks.emailSend.mockResolvedValue(undefined)

    await handleNotificationDelivery('delivery-1', baseContext())

    expect(mocks.emailSend).toHaveBeenCalledWith({
      deliveryId: 'delivery-1',
      snapshot: expect.objectContaining({
        kind: 'expense_created',
        recipient: expect.objectContaining({ accountId: 'acct-recipient' }),
      }),
      recipientAccountId: 'acct-recipient',
    })
    expect(mocks.markSent).toHaveBeenCalledWith(
      expect.any(Object),
      'delivery-1',
      LEASE_TOKEN,
    )
    expect(mocks.markTransientFailure).not.toHaveBeenCalled()
    expect(mocks.markPermanentFailure).not.toHaveBeenCalled()
  })

  it('completes a successful push delivery and marks the row as SENT', async () => {
    mocks.claimDelivery.mockResolvedValue({
      outcome: 'acquired',
      leaseToken: LEASE_TOKEN,
      delivery: baseDelivery({
        channel: NotificationChannel.PUSH,
        pushSubscriptionId: 'push-sub-1',
        snapshot: {
          ...baseDelivery().snapshot,
          push: {
            subscriptionId: 'push-sub-1',
            title: 'New expense',
            body: 'Alice added Dinner',
            url: 'https://app.spliit/groups/grp-1/expenses/exp-1',
          },
        },
      }),
    })
    mocks.pushSend.mockResolvedValue(undefined)

    await handleNotificationDelivery('delivery-1', baseContext())

    expect(mocks.pushSend).toHaveBeenCalledWith({
      deliveryId: 'delivery-1',
      snapshot: expect.objectContaining({
        kind: 'expense_created',
        push: expect.objectContaining({ subscriptionId: 'push-sub-1' }),
      }),
      pushSubscriptionId: 'push-sub-1',
    })
    expect(mocks.markSent).toHaveBeenCalledWith(
      expect.any(Object),
      'delivery-1',
      LEASE_TOKEN,
    )
  })

  it('acknowledges a terminal claim without invoking a sender', async () => {
    mocks.claimDelivery.mockResolvedValue({
      outcome: 'terminal',
      status: 'SENT',
    })

    await handleNotificationDelivery('delivery-1', baseContext())

    expect(mocks.emailSend).not.toHaveBeenCalled()
    expect(mocks.pushSend).not.toHaveBeenCalled()
    expect(mocks.markSent).not.toHaveBeenCalled()
    expect(mocks.markTransientFailure).not.toHaveBeenCalled()
    expect(mocks.markPermanentFailure).not.toHaveBeenCalled()
  })

  it('acknowledges a duplicate active-lease claim without invoking a sender', async () => {
    mocks.claimDelivery.mockResolvedValue({
      outcome: 'active_lease',
      leaseExpiresAt: new Date(Date.now() + 30_000),
    })

    await handleNotificationDelivery('delivery-1', baseContext())

    expect(mocks.emailSend).not.toHaveBeenCalled()
    expect(mocks.pushSend).not.toHaveBeenCalled()
    expect(mocks.markSent).not.toHaveBeenCalled()
    expect(mocks.markTransientFailure).not.toHaveBeenCalled()
    expect(mocks.markPermanentFailure).not.toHaveBeenCalled()
  })

  it('logs a warning and acknowledges when the delivery row is missing', async () => {
    mocks.claimDelivery.mockResolvedValue({ outcome: 'missing' })

    await handleNotificationDelivery('delivery-1', baseContext())

    expect(mocks.emailSend).not.toHaveBeenCalled()
    expect(mocks.markSent).not.toHaveBeenCalled()
    expect(mocks.markPermanentFailure).not.toHaveBeenCalled()
  })

  it('marks the delivery as PERMANENT_FAILURE on unsupported snapshot version', async () => {
    mocks.claimDelivery.mockResolvedValue({
      outcome: 'acquired',
      leaseToken: LEASE_TOKEN,
      delivery: baseDelivery({ snapshotVersion: 99 }),
    })

    await handleNotificationDelivery('delivery-1', baseContext())

    expect(mocks.emailSend).not.toHaveBeenCalled()
    expect(mocks.pushSend).not.toHaveBeenCalled()
    expect(mocks.markPermanentFailure).toHaveBeenCalledWith(
      expect.any(Object),
      'delivery-1',
      LEASE_TOKEN,
      expect.objectContaining({
        kind: 'DATA_CONTRACT',
        code: 'INVALID_SNAPSHOT_VERSION',
      }),
    )
  })

  it('marks the delivery as PERMANENT_FAILURE on a DATA_CONTRACT snapshot parse failure', async () => {
    mocks.claimDelivery.mockResolvedValue({
      outcome: 'acquired',
      leaseToken: LEASE_TOKEN,
      delivery: baseDelivery({ snapshot: { kind: 'totally-not-real' } }),
    })

    await handleNotificationDelivery('delivery-1', baseContext())

    expect(mocks.emailSend).not.toHaveBeenCalled()
    expect(mocks.pushSend).not.toHaveBeenCalled()
    expect(mocks.markPermanentFailure).toHaveBeenCalledWith(
      expect.any(Object),
      'delivery-1',
      LEASE_TOKEN,
      expect.objectContaining({
        kind: 'DATA_CONTRACT',
        code: 'SNAPSHOT_PARSE_FAILED',
      }),
    )
    expect(mocks.markSent).not.toHaveBeenCalled()
  })

  it('marks the delivery as PERMANENT_FAILURE when the channel is unsupported', async () => {
    mocks.claimDelivery.mockResolvedValue({
      outcome: 'acquired',
      leaseToken: LEASE_TOKEN,
      delivery: baseDelivery({ channel: 'SMS' }),
    })

    await handleNotificationDelivery('delivery-1', baseContext())

    expect(mocks.emailSend).not.toHaveBeenCalled()
    expect(mocks.pushSend).not.toHaveBeenCalled()
    expect(mocks.markPermanentFailure).toHaveBeenCalledWith(
      expect.any(Object),
      'delivery-1',
      LEASE_TOKEN,
      expect.objectContaining({
        kind: 'DATA_CONTRACT',
        code: 'UNKNOWN_CHANNEL',
      }),
    )
  })
})

describe('handleNotificationDelivery - failure handling', () => {
  it('records a transient failure and rethrows for pg-boss retry when attempts remain', async () => {
    const transient = new TransientDeliveryError(
      'upstream timeout',
      'ETIMEDOUT',
      504,
    )
    mocks.emailSend.mockRejectedValue(transient)
    mocks.claimDelivery.mockResolvedValue({
      outcome: 'acquired',
      leaseToken: LEASE_TOKEN,
      delivery: baseDelivery(),
    })

    await expect(
      handleNotificationDelivery('delivery-1', baseContext({ retryCount: 0 })),
    ).rejects.toBe(transient)

    expect(mocks.markTransientFailure).toHaveBeenCalledWith(
      expect.any(Object),
      'delivery-1',
      LEASE_TOKEN,
      expect.objectContaining({
        kind: 'TRANSIENT',
        code: 'ETIMEDOUT',
        providerStatus: 504,
      }),
    )
    expect(mocks.markRetryExhausted).not.toHaveBeenCalled()
    expect(mocks.markPermanentFailure).not.toHaveBeenCalled()
  })

  it('records a transient failure at retryCount 4 of 5 (not exhausted)', async () => {
    const transient = new TransientDeliveryError('still down', 'ETIMEDOUT', 503)
    mocks.emailSend.mockRejectedValue(transient)
    mocks.claimDelivery.mockResolvedValue({
      outcome: 'acquired',
      leaseToken: LEASE_TOKEN,
      delivery: baseDelivery(),
    })

    await expect(
      handleNotificationDelivery(
        'delivery-1',
        baseContext({ retryCount: 4, retryLimit: 5 }),
      ),
    ).rejects.toBe(transient)

    expect(mocks.markTransientFailure).toHaveBeenCalledWith(
      expect.any(Object),
      'delivery-1',
      LEASE_TOKEN,
      expect.objectContaining({
        kind: 'TRANSIENT',
        code: 'ETIMEDOUT',
      }),
    )
    expect(mocks.markRetryExhausted).not.toHaveBeenCalled()
  })

  it('routes a transient failure to RETRY_EXHAUSTED at retryCount 5 of 5', async () => {
    const transient = new TransientDeliveryError('still down', 'ETIMEDOUT', 503)
    mocks.emailSend.mockRejectedValue(transient)
    mocks.claimDelivery.mockResolvedValue({
      outcome: 'acquired',
      leaseToken: LEASE_TOKEN,
      delivery: baseDelivery(),
    })

    await expect(
      handleNotificationDelivery(
        'delivery-1',
        baseContext({ retryCount: 5, retryLimit: 5 }),
      ),
    ).rejects.toBe(transient)

    expect(mocks.markRetryExhausted).toHaveBeenCalledWith(
      expect.any(Object),
      'delivery-1',
      LEASE_TOKEN,
      expect.objectContaining({
        kind: 'TRANSIENT',
        code: 'ETIMEDOUT',
      }),
    )
    expect(mocks.markTransientFailure).not.toHaveBeenCalled()
  })

  it('treats an unknown error as transient when attempts remain', async () => {
    const unknown = new Error('totally unexpected')
    mocks.emailSend.mockRejectedValue(unknown)
    mocks.claimDelivery.mockResolvedValue({
      outcome: 'acquired',
      leaseToken: LEASE_TOKEN,
      delivery: baseDelivery(),
    })

    await expect(
      handleNotificationDelivery('delivery-1', baseContext({ retryCount: 1 })),
    ).rejects.toBe(unknown)

    expect(mocks.markTransientFailure).toHaveBeenCalledWith(
      expect.any(Object),
      'delivery-1',
      LEASE_TOKEN,
      expect.objectContaining({ kind: 'TRANSIENT' }),
    )
  })

  it('marks a permanent Push endpoint failure without retrying', async () => {
    const permanent = new PermanentDeliveryError(
      'subscription is gone',
      'ENDPOINT_GONE',
      410,
    )
    mocks.pushSend.mockRejectedValue(permanent)
    mocks.claimDelivery.mockResolvedValue({
      outcome: 'acquired',
      leaseToken: LEASE_TOKEN,
      delivery: baseDelivery({
        channel: NotificationChannel.PUSH,
        pushSubscriptionId: 'push-sub-1',
        snapshot: {
          ...baseDelivery().snapshot,
          push: {
            subscriptionId: 'push-sub-1',
            title: 'New expense',
            body: 'Alice added Dinner',
            url: 'https://app.spliit/groups/grp-1/expenses/exp-1',
          },
        },
      }),
    })

    await handleNotificationDelivery('delivery-1', baseContext())

    expect(mocks.markPermanentFailure).toHaveBeenCalledWith(
      expect.any(Object),
      'delivery-1',
      LEASE_TOKEN,
      expect.objectContaining({
        kind: 'PERMANENT',
        code: 'ENDPOINT_GONE',
        providerStatus: 410,
      }),
    )
    expect(mocks.markTransientFailure).not.toHaveBeenCalled()
    expect(mocks.markRetryExhausted).not.toHaveBeenCalled()
  })

  it('marks a permanent Email target failure without retrying', async () => {
    const permanent = new PermanentDeliveryError(
      'account missing',
      'TARGET_GONE',
    )
    mocks.emailSend.mockRejectedValue(permanent)
    mocks.claimDelivery.mockResolvedValue({
      outcome: 'acquired',
      leaseToken: LEASE_TOKEN,
      delivery: baseDelivery(),
    })

    await handleNotificationDelivery('delivery-1', baseContext())

    expect(mocks.markPermanentFailure).toHaveBeenCalledWith(
      expect.any(Object),
      'delivery-1',
      LEASE_TOKEN,
      expect.objectContaining({
        kind: 'PERMANENT',
        code: 'TARGET_GONE',
      }),
    )
    expect(mocks.markTransientFailure).not.toHaveBeenCalled()
  })

  it('treats an aborted context signal as a transient failure and rethrows', async () => {
    mocks.claimDelivery.mockResolvedValue({
      outcome: 'acquired',
      leaseToken: LEASE_TOKEN,
      delivery: baseDelivery(),
    })

    const controller = new AbortController()
    controller.abort()

    await expect(
      handleNotificationDelivery(
        'delivery-1',
        baseContext({ signal: controller.signal, retryCount: 1 }),
      ),
    ).rejects.toThrow(/aborted/i)

    expect(mocks.emailSend).not.toHaveBeenCalled()
    expect(mocks.pushSend).not.toHaveBeenCalled()
    expect(mocks.markTransientFailure).toHaveBeenCalledWith(
      expect.any(Object),
      'delivery-1',
      LEASE_TOKEN,
      expect.objectContaining({
        kind: 'TRANSIENT',
        code: 'CANCELLED',
      }),
    )
  })

  it('tolerates a stale lease token on markSent without throwing', async () => {
    mocks.claimDelivery.mockResolvedValue({
      outcome: 'acquired',
      leaseToken: LEASE_TOKEN,
      delivery: baseDelivery(),
    })
    mocks.emailSend.mockResolvedValue(undefined)
    mocks.markSent.mockResolvedValue(false)

    await expect(
      handleNotificationDelivery('delivery-1', baseContext()),
    ).resolves.toBeUndefined()

    expect(mocks.markSent).toHaveBeenCalledWith(
      expect.any(Object),
      'delivery-1',
      LEASE_TOKEN,
    )
  })
})
