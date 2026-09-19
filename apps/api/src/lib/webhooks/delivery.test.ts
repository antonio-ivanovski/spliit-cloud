import { beforeEach, describe, expect, it, vi } from 'vitest'

import { WebhookDeliveryStatus } from '@spliit/domain/webhooks'

import '../../test/mocks'
import { usePrismaMemoryStore } from '../../test/prisma-memory-store'
import { prismaMock } from '../../test/state'
import {
  handleWebhookDelivery,
  personalizePayloadForDelivery,
} from './delivery'

const securityMocks = vi.hoisted(() => ({
  resolveWebhookTarget: vi.fn(),
  sendWebhookRequest: vi.fn(),
  sendWebhookRelayRequest: vi.fn(),
}))
vi.mock('./security', async (importOriginal) => {
  const security = await importOriginal()
  return {
    ...security,
    resolveWebhookTarget: securityMocks.resolveWebhookTarget,
    sendWebhookRequest: securityMocks.sendWebhookRequest,
    sendWebhookRelayRequest: securityMocks.sendWebhookRelayRequest,
  }
})

const envMocks = vi.hoisted(() => ({
  getWebhookRelayConfig: vi.fn(),
}))

vi.mock('../env', async (importOriginal) => {
  const env = await importOriginal()
  return { ...env, getWebhookRelayConfig: envMocks.getWebhookRelayConfig }
})

const NOW = new Date('2026-01-01T00:00:00.000Z')

function ctx(overrides: { retryCount?: number; retryLimit?: number } = {}) {
  return { retryCount: 0, retryLimit: 8, ...overrides } as never
}

function seed(args: {
  enabled?: boolean
  anonymous?: boolean
  verified?: boolean
  involvedOnly?: boolean
  status?: string
  attemptCount?: number
  eventType?: string
  eventOverrides?: Record<string, unknown>
  members?: Array<Record<string, unknown>> | null
}) {
  const eventOverrides = args.eventOverrides ?? {}
  usePrismaMemoryStore({
    user: [
      {
        id: 'acct-self',
        isAnonymous: args.anonymous ?? false,
        emailVerified: args.verified ?? true,
      },
    ],
    webhookEndpoint: [
      {
        id: 'ep-1',
        accountId: 'acct-self',
        name: 'Hook',
        url: 'https://example.com/hook',
        enabled: args.enabled ?? true,
        notifyCreated: true,
        notifyUpdated: true,
        notifyDeleted: true,
        involvedOnly: args.involvedOnly ?? false,
        secretVersion: 1,
        createdAt: NOW,
        updatedAt: NOW,
      },
    ],
    group:
      args.members === null
        ? []
        : [{ id: 'grp-1', name: 'Trip', groupType: 'GROUP' }],
    ...(args.members
      ? {
          groupMember: args.members,
        }
      : {}),
    webhookEvent: [
      {
        id: 'evt-1',
        sourceKey: 'test:evt-1',
        type: args.eventType ?? 'expense.created',
        apiVersion: 'v1',
        occurredAt: NOW,
        payload: { hello: 'world' },
        groupId: null,
        activityId: null,
        allowAfterDelete: false,
        createdAt: NOW,
        ...eventOverrides,
      },
    ],
    webhookDelivery: [
      {
        id: 'del-1',
        endpointId: 'ep-1',
        eventId: 'evt-1',
        status: args.status ?? WebhookDeliveryStatus.PENDING,
        attemptCount: args.attemptCount ?? 0,
        createdAt: NOW,
        updatedAt: NOW,
      },
    ],
  })
}

async function delivery() {
  return prismaMock.webhookDelivery.findUnique({ where: { id: 'del-1' } })
}

async function attempts() {
  return prismaMock.webhookDeliveryAttempt.findMany({
    where: { deliveryId: 'del-1' },
  })
}

async function endpoint() {
  return prismaMock.webhookEndpoint.findUnique({ where: { id: 'ep-1' } })
}

beforeEach(() => {
  securityMocks.resolveWebhookTarget.mockReset()
  securityMocks.sendWebhookRequest.mockReset()
  securityMocks.sendWebhookRelayRequest.mockReset()
  envMocks.getWebhookRelayConfig.mockReset()
  securityMocks.resolveWebhookTarget.mockResolvedValue({} as never)
  securityMocks.sendWebhookRequest.mockResolvedValue(200)
  securityMocks.sendWebhookRelayRequest.mockResolvedValue(200)
  envMocks.getWebhookRelayConfig.mockReturnValue(undefined)
})

describe('handleWebhookDelivery eligibility', () => {
  it('ignores already-terminal deliveries without sending', async () => {
    seed({ status: WebhookDeliveryStatus.SENT })

    await handleWebhookDelivery('del-1', ctx())

    expect(securityMocks.sendWebhookRequest).not.toHaveBeenCalled()
    expect(await attempts()).toHaveLength(0)
  })

  it('loses the claim race without sending', async () => {
    seed({
      status: WebhookDeliveryStatus.PROCESSING,
      attemptCount: 1,
    })

    await handleWebhookDelivery('del-1', ctx())

    expect(securityMocks.sendWebhookRequest).not.toHaveBeenCalled()
    expect(await attempts()).toHaveLength(0)
  })

  it('cancels work for a disabled endpoint without sending', async () => {
    seed({ enabled: false })

    await handleWebhookDelivery('del-1', ctx())

    expect(securityMocks.sendWebhookRequest).not.toHaveBeenCalled()
    expect(await delivery()).toMatchObject({
      status: WebhookDeliveryStatus.CANCELED,
      lastErrorCode: 'ENDPOINT_DISABLED',
    })
  })

  it('still delivers webhook.test to a disabled endpoint', async () => {
    seed({ enabled: false, eventType: 'webhook.test' })

    await handleWebhookDelivery('del-1', ctx())

    expect(securityMocks.sendWebhookRequest).toHaveBeenCalledTimes(1)
    expect(await delivery()).toMatchObject({
      status: WebhookDeliveryStatus.SENT,
    })
  })

  it.each([
    ['anonymous account', { anonymous: true, verified: true }],
    ['unverified email', { anonymous: false, verified: false }],
  ])('cancels work for an ineligible account (%s)', async (_label, flags) => {
    seed({ ...flags })

    await handleWebhookDelivery('del-1', ctx())

    expect(securityMocks.sendWebhookRequest).not.toHaveBeenCalled()
    expect(await delivery()).toMatchObject({
      status: WebhookDeliveryStatus.CANCELED,
      lastErrorCode: 'ENDPOINT_DISABLED',
    })
  })

  it('cancels group-scoped work after membership ends', async () => {
    seed({
      eventOverrides: { groupId: 'grp-1', allowAfterDelete: false },
      members: [
        {
          id: 'gm-1',
          groupId: 'grp-1',
          accountId: 'acct-self',
          role: 'MEMBER',
          status: 'LEFT',
        },
      ],
    })

    await handleWebhookDelivery('del-1', ctx())

    expect(securityMocks.sendWebhookRequest).not.toHaveBeenCalled()
    expect(await delivery()).toMatchObject({
      status: WebhookDeliveryStatus.CANCELED,
      lastErrorCode: 'MEMBERSHIP_ENDED',
    })
  })

  it('delivers group-scoped work to active members', async () => {
    seed({
      eventOverrides: { groupId: 'grp-1', allowAfterDelete: false },
      members: [
        {
          id: 'gm-1',
          groupId: 'grp-1',
          accountId: 'acct-self',
          role: 'MEMBER',
          status: 'ACTIVE',
        },
      ],
    })

    await handleWebhookDelivery('del-1', ctx())

    expect(securityMocks.sendWebhookRequest).toHaveBeenCalledTimes(1)
    expect(await delivery()).toMatchObject({
      status: WebhookDeliveryStatus.SENT,
    })
  })
})

describe('handleWebhookDelivery outcomes', () => {
  it('records success with attempt and endpoint timestamps', async () => {
    seed({})

    await handleWebhookDelivery('del-1', ctx())

    expect(securityMocks.sendWebhookRequest).toHaveBeenCalledTimes(1)
    expect(await delivery()).toMatchObject({
      status: WebhookDeliveryStatus.SENT,
      attemptCount: 1,
      lastHttpStatus: 200,
      lastErrorCode: null,
    })
    expect(await attempts()).toMatchObject([
      { attempt: 1, outcome: 'SENT', httpStatus: 200 },
    ])
    const endpoint = await prismaMock.webhookEndpoint.findUnique({
      where: { id: 'ep-1' },
    })
    expect(endpoint?.lastSuccessAt).not.toBeNull()
  })

  it('re-queues transient failures and rethrows for the job runner', async () => {
    seed({})
    securityMocks.sendWebhookRequest.mockResolvedValue(500)

    await expect(handleWebhookDelivery('del-1', ctx())).rejects.toThrow()
    expect(await delivery()).toMatchObject({
      status: WebhookDeliveryStatus.PENDING,
      lastErrorCode: 'HTTP_500',
    })
    expect(await attempts()).toMatchObject([{ outcome: 'RETRYING' }])
  })

  it('exhausts retries without rethrowing', async () => {
    seed({})
    securityMocks.sendWebhookRequest.mockResolvedValue(500)

    await handleWebhookDelivery('del-1', ctx({ retryCount: 8 }))

    expect(await delivery()).toMatchObject({
      status: WebhookDeliveryStatus.RETRY_EXHAUSTED,
      lastErrorCode: 'HTTP_500',
    })
  })

  it('fails permanently on 4xx without rethrowing', async () => {
    seed({})
    securityMocks.sendWebhookRequest.mockResolvedValue(400)

    await handleWebhookDelivery('del-1', ctx())

    expect(await delivery()).toMatchObject({
      status: WebhookDeliveryStatus.PERMANENT_FAILURE,
      lastErrorCode: 'HTTP_400',
    })
  })

  it('retries transient DNS errors and fails permanent ones immediately', async () => {
    seed({})
    securityMocks.resolveWebhookTarget.mockRejectedValue(
      Object.assign(new Error('query timed out'), { code: 'EAI_AGAIN' }),
    )

    await expect(handleWebhookDelivery('del-1', ctx())).rejects.toThrow()
    expect(await delivery()).toMatchObject({
      status: WebhookDeliveryStatus.PENDING,
      lastErrorCode: 'DNS_TRANSIENT',
    })

    seed({})
    securityMocks.resolveWebhookTarget.mockRejectedValue(
      new Error('resolved to a private address'),
    )

    await handleWebhookDelivery('del-1', ctx())
    expect(await delivery()).toMatchObject({
      status: WebhookDeliveryStatus.PERMANENT_FAILURE,
      lastErrorCode: 'INVALID_ENDPOINT',
    })
  })

  it('classifies transport timeouts and rethrows while retries remain', async () => {
    seed({})
    securityMocks.sendWebhookRequest.mockRejectedValue(
      new Error('request timed out after 10000ms'),
    )

    await expect(handleWebhookDelivery('del-1', ctx())).rejects.toThrow()
    expect(await delivery()).toMatchObject({
      status: WebhookDeliveryStatus.PENDING,
      lastErrorCode: 'TIMEOUT',
    })
  })

  it('lets an explicit cancellation win over a late network failure', async () => {
    seed({})
    securityMocks.sendWebhookRequest.mockImplementation(async () => {
      await prismaMock.webhookDelivery.update({
        where: { id: 'del-1' },
        data: { status: WebhookDeliveryStatus.CANCELED },
      })
      throw new Error('connection reset')
    })

    await handleWebhookDelivery('del-1', ctx())

    // Cancellation sticks: the late failure neither resurrects the delivery
    // nor records a failure over the explicit cancel.
    expect(await delivery()).toMatchObject({
      status: WebhookDeliveryStatus.CANCELED,
    })
    expect(await endpoint()).not.toHaveProperty('lastFailureAt')
  })

  it('does not mark the endpoint successful when a send lands after cancellation', async () => {
    seed({})
    securityMocks.sendWebhookRequest.mockImplementation(async () => {
      await prismaMock.webhookDelivery.update({
        where: { id: 'del-1' },
        data: { status: WebhookDeliveryStatus.CANCELED },
      })
      return 200
    })

    await handleWebhookDelivery('del-1', ctx())

    expect(await delivery()).toMatchObject({
      status: WebhookDeliveryStatus.CANCELED,
    })
    expect(await endpoint()).not.toHaveProperty('lastSuccessAt')
  })
})

describe('handleWebhookDelivery relay branch', () => {
  it('sends through the relay with envelope headers and no direct request', async () => {
    seed({})
    envMocks.getWebhookRelayConfig.mockReturnValue({
      url: 'https://relay.example.com/forward',
      secret: 's'.repeat(32),
    })

    await handleWebhookDelivery('del-1', ctx())

    expect(securityMocks.sendWebhookRelayRequest).toHaveBeenCalledTimes(1)
    expect(securityMocks.sendWebhookRelayRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        relayUrl: 'https://relay.example.com/forward',
        body: JSON.stringify({ hello: 'world' }),
      }),
    )
    const { headers } = securityMocks.sendWebhookRelayRequest.mock.calls[0]![0]
    expect(headers['webhook-signature']).toMatch(/^v1,/)
    expect(headers['x-spliit-relay-signature']).toMatch(/^v1,/)
    expect(headers['x-spliit-relay-destination']).toBe(
      Buffer.from('https://example.com/hook', 'utf8').toString('base64url'),
    )
    expect(securityMocks.sendWebhookRequest).not.toHaveBeenCalled()
    expect(await delivery()).toMatchObject({
      status: WebhookDeliveryStatus.SENT,
    })
  })
})

function expenseSnapshot(
  id: string,
  paidByAccount: string,
  paidForAccounts: string[],
) {
  // Participant ids are shared across lists (ledger participant ids), so the
  // same owner resolves in both paidBy and paidFor.
  const ids = new Map<string, string>()
  const participantId = (accountId: string) => {
    const existing = ids.get(accountId)
    if (existing) return existing
    const created = `lp-${id}-${ids.size}`
    ids.set(accountId, created)
    return created
  }
  const entry = (accountId: string | null) => ({
    participant: {
      id: accountId === null ? `lp-unlinked-${id}` : participantId(accountId),
      name: accountId ?? 'unlinked',
      accountId,
      removed: false,
    },
    shares: 100,
  })
  return {
    id,
    version: 1,
    title: 'Dinner',
    expenseDate: '2026-01-01T00:00:00.000Z',
    expenseTimeZone: 'UTC',
    createdAt: '2026-01-01T00:00:00.000Z',
    categoryId: 'cat-food',
    notes: null,
    amount: {
      ledger: { minor: 1000, currency: 'USD' },
      original: null,
      conversionRate: null,
      conversionSource: null,
    },
    splitMode: 'EVENLY',
    paidBySplitMode: 'EVENLY',
    paidBy: [entry(paidByAccount)],
    paidFor: paidForAccounts.map((accountId) => entry(accountId)),
    items: [],
    itemizedRemainder: null,
    documents: [],
    createdBy: null,
    recurrence: null,
    settlement: false,
  }
}

function singularPayload() {
  return {
    id: 'evt-1',
    apiVersion: 'v1',
    type: 'expense.created',
    occurredAt: '2026-01-01T00:00:00.000Z',
    data: {
      group: { id: 'grp-1', name: 'Trip', type: 'GROUP' },
      actor: { type: 'system', id: null, name: null },
      expense: expenseSnapshot('exp-1', 'acct-self', [
        'acct-self',
        'acct-other',
      ]),
      changedFields: [],
    },
  }
}

function batchPayload() {
  return {
    id: 'evt-1',
    apiVersion: 'v1',
    type: 'expenses.created',
    occurredAt: '2026-01-01T00:00:00.000Z',
    data: {
      group: { id: 'grp-1', name: 'Trip', type: 'GROUP' },
      actor: { type: 'system', id: null, name: null },
      batchId: 'evt-1',
      source: 'csv-import',
      expenses: [
        {
          expense: expenseSnapshot('exp-1', 'acct-self', [
            'acct-self',
            'acct-other',
          ]),
          changedFields: [],
        },
        {
          expense: expenseSnapshot('exp-2', 'acct-other', ['acct-other']),
          changedFields: [],
        },
      ],
    },
  }
}

function sentBody() {
  const call = securityMocks.sendWebhookRequest.mock.calls[0]?.[0] as
    | { body: string }
    | undefined
  expect(call).toBeDefined()
  return JSON.parse(call!.body) as {
    data: { viewer?: unknown; expenses?: Array<{ viewer?: unknown }> }
  }
}

describe('personalizePayloadForDelivery', () => {
  it('attaches the owner viewer on singular events', () => {
    const personalized = personalizePayloadForDelivery(singularPayload(), {
      accountId: 'acct-self',
      involvedOnly: false,
    })

    expect(personalized?.data).toMatchObject({
      viewer: {
        participantId: 'lp-exp-1-0',
        paid: 1000,
        owes: 500,
        net: 500,
        involved: true,
      },
    })
  })

  it('derives different viewers per recipient from one shared payload', () => {
    const payload = singularPayload()
    const self = personalizePayloadForDelivery(payload, {
      accountId: 'acct-self',
      involvedOnly: false,
    })
    const other = personalizePayloadForDelivery(payload, {
      accountId: 'acct-other',
      involvedOnly: false,
    })

    expect(self?.data).toMatchObject({
      viewer: { paid: 1000, owes: 500, involved: true },
    })
    expect(other?.data).toMatchObject({
      viewer: { paid: 0, owes: 500, involved: true },
    })
    // Stored payload untouched: no viewer leaked into the shared object.
    expect(payload.data).not.toHaveProperty('viewer')
  })

  it('returns null for involved-only recipients with no stake', () => {
    expect(
      personalizePayloadForDelivery(singularPayload(), {
        accountId: 'acct-stranger',
        involvedOnly: true,
      }),
    ).toBeNull()
    expect(
      personalizePayloadForDelivery(batchPayload(), {
        accountId: 'acct-stranger',
        involvedOnly: true,
      }),
    ).toBeNull()
  })

  it('prunes uninvolved batch entries for involved-only recipients', () => {
    const personalized = personalizePayloadForDelivery(batchPayload(), {
      accountId: 'acct-self',
      involvedOnly: true,
    })
    expect(personalized).not.toBeNull()
    const expenses = (
      personalized!.data as {
        expenses: Array<{ expense: { id: string }; viewer: unknown }>
      }
    ).expenses

    expect(expenses.map(({ expense }) => expense.id)).toEqual(['exp-1'])
    expect(expenses[0]).toMatchObject({
      viewer: { paid: 1000, owes: 500, involved: true },
    })
  })

  it('keeps every batch entry for recipients without the filter', () => {
    const personalized = personalizePayloadForDelivery(batchPayload(), {
      accountId: 'acct-self',
      involvedOnly: false,
    })
    expect(personalized).not.toBeNull()
    const expenses = (
      personalized!.data as {
        expenses: Array<{ viewer: unknown }>
      }
    ).expenses

    expect(expenses).toHaveLength(2)
    expect(expenses[1]).toMatchObject({
      viewer: { participantId: null, involved: false },
    })
  })

  it('passes webhook.test and unknown shapes through unchanged', () => {
    const testEvent = {
      id: 'evt-t',
      apiVersion: 'v1',
      type: 'webhook.test',
      occurredAt: '2026-01-01T00:00:00.000Z',
      data: { message: 'hi' },
    }
    expect(
      personalizePayloadForDelivery(testEvent, {
        accountId: 'acct-self',
        involvedOnly: true,
      }),
    ).toBe(testEvent)
    const opaque = { hello: 'world' }
    expect(
      personalizePayloadForDelivery(opaque, {
        accountId: 'acct-self',
        involvedOnly: true,
      }),
    ).toBe(opaque)
  })
})

describe('handleWebhookDelivery personalization', () => {
  it('sends the viewer block in the signed body', async () => {
    seed({ eventOverrides: { payload: singularPayload() } })

    await handleWebhookDelivery('del-1', ctx())

    expect(sentBody().data.viewer).toMatchObject({
      participantId: 'lp-exp-1-0',
      paid: 1000,
      owes: 500,
      net: 500,
      involved: true,
    })
    expect(await delivery()).toMatchObject({
      status: WebhookDeliveryStatus.SENT,
    })
  })

  it('sends a pruned batch for involved-only endpoints', async () => {
    seed({
      involvedOnly: true,
      eventType: 'expenses.created',
      eventOverrides: { payload: batchPayload() },
    })

    await handleWebhookDelivery('del-1', ctx())

    const body = sentBody()
    expect(body.data.expenses).toHaveLength(1)
    expect(body.data.expenses?.[0]).toMatchObject({
      viewer: { paid: 1000, involved: true },
    })
    expect(await delivery()).toMatchObject({
      status: WebhookDeliveryStatus.SENT,
    })
  })

  it('cancels without sending when an involved-only owner has no stake', async () => {
    seed({
      involvedOnly: true,
      eventOverrides: {
        payload: {
          ...singularPayload(),
          data: {
            ...singularPayload().data,
            expense: expenseSnapshot('exp-1', 'acct-other', ['acct-other']),
          },
        },
      },
    })

    await handleWebhookDelivery('del-1', ctx())

    expect(securityMocks.sendWebhookRequest).not.toHaveBeenCalled()
    expect(await attempts()).toHaveLength(0)
    expect(await delivery()).toMatchObject({
      status: WebhookDeliveryStatus.CANCELED,
      lastErrorCode: 'NOT_INVOLVED',
    })
  })
})
