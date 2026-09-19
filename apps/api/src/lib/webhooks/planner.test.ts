import { describe, expect, it } from 'vitest'

import type { WebhookExpenseSnapshot } from '@spliit/domain/webhooks'

import '../../test/mocks'
import { usePrismaMemoryStore } from '../../test/prisma-memory-store'
import { prismaMock } from '../../test/state'
import {
  planExpenseBatchWebhook,
  planExpenseWebhook,
  planSettlementWebhookBatch,
} from './planner'

const NOW = new Date('2026-01-01T00:00:00.000Z')

const SNAPSHOT: WebhookExpenseSnapshot = {
  id: 'exp-1',
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
  paidBy: [],
  paidFor: [],
  items: [],
  itemizedRemainder: null,
  documents: [],
  createdBy: null,
  recurrence: null,
  settlement: false,
}

const ACTIVITY = {
  id: 'act-1',
  time: NOW,
  subjectId: null,
  actorType: 'SYSTEM',
  actorId: null,
} as never

function seed(args: {
  users?: Array<Record<string, unknown>>
  members?: Array<Record<string, unknown>>
  endpoints?: Array<Record<string, unknown>>
}) {
  usePrismaMemoryStore({
    group: [{ id: 'grp-1', name: 'Trip', groupType: 'GROUP' }],
    user: args.users ?? [
      { id: 'acct-self', isAnonymous: false, emailVerified: true },
    ],
    groupMember: args.members ?? [
      {
        id: 'gm-1',
        groupId: 'grp-1',
        accountId: 'acct-self',
        role: 'MEMBER',
        status: 'ACTIVE',
      },
    ],
    webhookEndpoint: args.endpoints ?? [
      {
        id: 'ep-1',
        accountId: 'acct-self',
        name: 'Hook',
        url: 'https://example.com/hook',
        enabled: true,
        notifyCreated: true,
        notifyUpdated: true,
        notifyDeleted: true,
        secretVersion: 1,
        createdAt: NOW,
        updatedAt: NOW,
      },
    ],
  })
}

function endpoint(
  id: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    accountId: 'acct-self',
    name: `Hook ${id}`,
    url: 'https://example.com/hook',
    enabled: true,
    notifyCreated: true,
    notifyUpdated: true,
    notifyDeleted: true,
    secretVersion: 1,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

async function deliveryCount() {
  return (await prismaMock.webhookDelivery.findMany()).length
}

async function eventCount() {
  return (await prismaMock.webhookEvent.findMany()).length
}

describe('planExpenseWebhook eligibility', () => {
  it('plans one delivery per eligible endpoint', async () => {
    seed({ endpoints: [endpoint('ep-1'), endpoint('ep-2')] })

    const eventId = await planExpenseWebhook({
      tx: prismaMock as never,
      boss: null,
      activity: ACTIVITY,
      groupId: 'grp-1',
      operation: 'created',
      expenseSnapshot: SNAPSHOT,
    })

    expect(typeof eventId).toBe('string')
    expect(await deliveryCount()).toBe(2)
    const event = await prismaMock.webhookEvent.findUnique({
      where: { id: eventId! },
    })
    expect(event?.type).toBe('expense.created')
  })

  it('skips disabled endpoints without persisting an event', async () => {
    seed({ endpoints: [endpoint('ep-1', { enabled: false })] })

    const eventId = await planExpenseWebhook({
      tx: prismaMock as never,
      boss: null,
      activity: ACTIVITY,
      groupId: 'grp-1',
      operation: 'created',
      expenseSnapshot: SNAPSHOT,
    })

    expect(eventId).toBeNull()
    expect(await eventCount()).toBe(0)
  })

  it('routes operations to their matching filter column', async () => {
    seed({
      endpoints: [
        endpoint('ep-created', {
          notifyCreated: true,
          notifyUpdated: false,
          notifyDeleted: false,
        }),
        endpoint('ep-updated', {
          notifyCreated: false,
          notifyUpdated: true,
          notifyDeleted: false,
        }),
      ],
    })
    const tx = prismaMock as never

    const createdId = await planExpenseWebhook({
      tx,
      boss: null,
      activity: ACTIVITY,
      groupId: 'grp-1',
      operation: 'created',
      expenseSnapshot: SNAPSHOT,
    })
    expect(createdId).not.toBeNull()

    const deliveries = await prismaMock.webhookDelivery.findMany()
    expect(deliveries.map(({ endpointId }) => endpointId)).toEqual([
      'ep-created',
    ])

    const updatedId = await planExpenseWebhook({
      tx,
      boss: null,
      activity: { ...ACTIVITY, id: 'act-2' },
      groupId: 'grp-1',
      operation: 'updated',
      expenseSnapshot: SNAPSHOT,
    })
    expect(updatedId).not.toBeNull()
    const updatedDeliveries = (
      await prismaMock.webhookDelivery.findMany({
        where: { eventId: updatedId! },
      })
    ).map(({ endpointId }) => endpointId)
    expect(updatedDeliveries).toEqual(['ep-updated'])
  })

  it.each([
    [
      'anonymous account',
      [{ id: 'acct-self', isAnonymous: true, emailVerified: true }],
    ],
    [
      'unverified email',
      [{ id: 'acct-self', isAnonymous: false, emailVerified: false }],
    ],
  ])('skips endpoints of an ineligible account (%s)', async (_label, users) => {
    seed({ users })

    const eventId = await planExpenseWebhook({
      tx: prismaMock as never,
      boss: null,
      activity: ACTIVITY,
      groupId: 'grp-1',
      operation: 'created',
      expenseSnapshot: SNAPSHOT,
    })

    expect(eventId).toBeNull()
    expect(await eventCount()).toBe(0)
  })

  it.each([['LEFT'], ['REMOVED'], ['SUSPENDED']])(
    'requires an ACTIVE membership (got %s)',
    async (status) => {
      seed({
        members: [
          {
            id: 'gm-1',
            groupId: 'grp-1',
            accountId: 'acct-self',
            role: 'MEMBER',
            status,
          },
        ],
      })

      const eventId = await planExpenseWebhook({
        tx: prismaMock as never,
        boss: null,
        activity: ACTIVITY,
        groupId: 'grp-1',
        operation: 'created',
        expenseSnapshot: SNAPSHOT,
      })

      expect(eventId).toBeNull()
      expect(await eventCount()).toBe(0)
    },
  )

  it('returns null when no snapshot can be loaded', async () => {
    seed({})

    const eventId = await planExpenseWebhook({
      tx: prismaMock as never,
      boss: null,
      activity: ACTIVITY,
      groupId: 'grp-1',
      operation: 'created',
    })

    expect(eventId).toBeNull()
    expect(await eventCount()).toBe(0)
  })
})

describe('planExpenseBatchWebhook', () => {
  it('returns null for an empty batch', async () => {
    seed({})

    const eventId = await planExpenseBatchWebhook({
      tx: prismaMock as never,
      boss: null,
      sourceKey: 'test:empty',
      groupId: 'grp-1',
      actorAccountId: null,
      operation: 'created',
      source: 'test',
      occurredAt: NOW,
      expenses: [],
    })

    expect(eventId).toBeNull()
    expect(await eventCount()).toBe(0)
  })

  it('packs every snapshot into a single batch event', async () => {
    seed({})

    const eventId = await planExpenseBatchWebhook({
      tx: prismaMock as never,
      boss: null,
      sourceKey: 'test:batch',
      groupId: 'grp-1',
      actorAccountId: null,
      operation: 'created',
      source: 'csv-import',
      occurredAt: NOW,
      expenses: [
        { expense: SNAPSHOT },
        { expense: { ...SNAPSHOT, id: 'exp-2' }, changedFields: ['title'] },
      ],
    })

    expect(eventId).not.toBeNull()
    expect(await deliveryCount()).toBe(1)
    const event = await prismaMock.webhookEvent.findUnique({
      where: { id: eventId! },
    })
    const payload = event?.payload as {
      type: string
      data: { expenses: unknown[]; source: string }
    }
    expect(payload.type).toBe('expenses.created')
    expect(payload.data.expenses).toHaveLength(2)
    expect(payload.data.source).toBe('csv-import')
  })
})

const INVOLVED_SNAPSHOT: WebhookExpenseSnapshot = {
  ...SNAPSHOT,
  paidBy: [
    {
      participant: {
        id: 'lp-self',
        name: 'Self',
        accountId: 'acct-self',
        removed: false,
      },
      shares: 100,
    },
  ],
  paidFor: [
    {
      participant: {
        id: 'lp-self',
        name: 'Self',
        accountId: 'acct-self',
        removed: false,
      },
      shares: 100,
    },
    {
      participant: {
        id: 'lp-other',
        name: 'Other',
        accountId: 'acct-other',
        removed: false,
      },
      shares: 100,
    },
  ],
}

function seedTwoOwners() {
  seed({
    users: [
      { id: 'acct-self', isAnonymous: false, emailVerified: true },
      { id: 'acct-other', isAnonymous: false, emailVerified: true },
      { id: 'acct-third', isAnonymous: false, emailVerified: true },
    ],
    members: [
      {
        id: 'gm-1',
        groupId: 'grp-1',
        accountId: 'acct-self',
        role: 'MEMBER',
        status: 'ACTIVE',
      },
      {
        id: 'gm-2',
        groupId: 'grp-1',
        accountId: 'acct-other',
        role: 'MEMBER',
        status: 'ACTIVE',
      },
      {
        id: 'gm-3',
        groupId: 'grp-1',
        accountId: 'acct-third',
        role: 'MEMBER',
        status: 'ACTIVE',
      },
    ],
    endpoints: [
      endpoint('ep-involved', {
        accountId: 'acct-other',
        involvedOnly: true,
      }),
      endpoint('ep-uninvolved', {
        accountId: 'acct-third',
        involvedOnly: true,
      }),
      endpoint('ep-all', { accountId: 'acct-third' }),
    ],
  })
}

describe('involved-only filtering', () => {
  it('singular: keeps involved-only endpoints whose owner is involved', async () => {
    seedTwoOwners()

    const eventId = await planExpenseWebhook({
      tx: prismaMock as never,
      boss: null,
      activity: ACTIVITY,
      groupId: 'grp-1',
      operation: 'created',
      expenseSnapshot: INVOLVED_SNAPSHOT,
    })

    expect(eventId).not.toBeNull()
    const deliveries = await prismaMock.webhookDelivery.findMany()
    expect(deliveries.map(({ endpointId }) => endpointId).sort()).toEqual([
      'ep-all',
      'ep-involved',
    ])
  })

  it('singular: persists nothing when only uninvolved involved-only endpoints exist', async () => {
    seed({
      users: [
        { id: 'acct-self', isAnonymous: false, emailVerified: true },
        { id: 'acct-third', isAnonymous: false, emailVerified: true },
      ],
      members: [
        {
          id: 'gm-1',
          groupId: 'grp-1',
          accountId: 'acct-self',
          role: 'MEMBER',
          status: 'ACTIVE',
        },
        {
          id: 'gm-3',
          groupId: 'grp-1',
          accountId: 'acct-third',
          role: 'MEMBER',
          status: 'ACTIVE',
        },
      ],
      endpoints: [
        endpoint('ep-uninvolved', {
          accountId: 'acct-third',
          involvedOnly: true,
        }),
      ],
    })

    const eventId = await planExpenseWebhook({
      tx: prismaMock as never,
      boss: null,
      activity: ACTIVITY,
      groupId: 'grp-1',
      operation: 'created',
      expenseSnapshot: INVOLVED_SNAPSHOT,
    })

    expect(eventId).toBeNull()
    expect(await eventCount()).toBe(0)
  })

  it('batch: keeps involved-only endpoints involved in at least one entry', async () => {
    seedTwoOwners()
    const otherOnly: WebhookExpenseSnapshot = {
      ...INVOLVED_SNAPSHOT,
      id: 'exp-2',
      paidBy: [
        {
          participant: {
            id: 'lp-other',
            name: 'Other',
            accountId: 'acct-other',
            removed: false,
          },
          shares: 100,
        },
      ],
      paidFor: [
        {
          participant: {
            id: 'lp-other',
            name: 'Other',
            accountId: 'acct-other',
            removed: false,
          },
          shares: 100,
        },
      ],
    }

    const eventId = await planExpenseBatchWebhook({
      tx: prismaMock as never,
      boss: null,
      sourceKey: 'test:involved-batch',
      groupId: 'grp-1',
      actorAccountId: null,
      operation: 'created',
      source: 'csv-import',
      occurredAt: NOW,
      expenses: [{ expense: otherOnly }],
    })

    expect(eventId).not.toBeNull()
    const deliveries = await prismaMock.webhookDelivery.findMany()
    expect(deliveries.map(({ endpointId }) => endpointId).sort()).toEqual([
      'ep-all',
      'ep-involved',
    ])
  })

  it('batch: persists nothing when an involved-only owner is in no entry', async () => {
    seed({
      users: [
        { id: 'acct-self', isAnonymous: false, emailVerified: true },
        { id: 'acct-other', isAnonymous: false, emailVerified: true },
      ],
      members: [
        {
          id: 'gm-1',
          groupId: 'grp-1',
          accountId: 'acct-self',
          role: 'MEMBER',
          status: 'ACTIVE',
        },
        {
          id: 'gm-2',
          groupId: 'grp-1',
          accountId: 'acct-other',
          role: 'MEMBER',
          status: 'ACTIVE',
        },
      ],
      endpoints: [
        endpoint('ep-involved', {
          accountId: 'acct-other',
          involvedOnly: true,
        }),
      ],
    })
    const selfOnly: WebhookExpenseSnapshot = {
      ...INVOLVED_SNAPSHOT,
      id: 'exp-2',
      paidFor: [
        {
          participant: {
            id: 'lp-self',
            name: 'Self',
            accountId: 'acct-self',
            removed: false,
          },
          shares: 100,
        },
      ],
    }

    const eventId = await planExpenseBatchWebhook({
      tx: prismaMock as never,
      boss: null,
      sourceKey: 'test:involved-batch-none',
      groupId: 'grp-1',
      actorAccountId: null,
      operation: 'created',
      source: 'csv-import',
      occurredAt: NOW,
      expenses: [{ expense: selfOnly }],
    })

    expect(eventId).toBeNull()
    expect(await eventCount()).toBe(0)
  })
})

describe('planSettlementWebhookBatch', () => {
  it('returns null without loading snapshots when nobody is eligible', async () => {
    seed({ endpoints: [endpoint('ep-1', { enabled: false })] })

    const eventId = await planSettlementWebhookBatch({
      tx: prismaMock as never,
      boss: null,
      groupId: 'grp-1',
      actorAccountId: 'acct-self',
      source: 'member-removal',
      settlements: [
        { expenseId: 'exp-1', activity: { id: 'act-1', time: NOW } },
      ],
    })

    expect(eventId).toBeNull()
    expect(await eventCount()).toBe(0)
  })
})
