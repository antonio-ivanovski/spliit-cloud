import { describe, expect, it } from 'vitest'

import {
  deriveViewer,
  webhookEventFilterSchema,
  type WebhookExpenseSnapshot,
} from './webhooks'

function participant(
  id: string,
  accountId: string | null,
  shares: number,
): WebhookExpenseSnapshot['paidFor'][number] {
  return { participant: { id, name: id, accountId, removed: false }, shares }
}

function makeSnapshot(
  overrides: Partial<WebhookExpenseSnapshot> = {},
): WebhookExpenseSnapshot {
  return {
    id: 'exp-1',
    version: 1,
    title: 'Dinner',
    expenseDate: '2026-09-01T00:00:00.000Z',
    expenseTimeZone: 'UTC',
    createdAt: '2026-09-01T00:00:00.000Z',
    categoryId: 'food',
    notes: null,
    amount: {
      ledger: { minor: 9000, currency: 'EUR' },
      original: null,
      conversionRate: null,
      conversionSource: null,
    },
    splitMode: 'EVENLY',
    paidBySplitMode: 'EVENLY',
    paidBy: [participant('lp-alice', 'account-alice', 100)],
    paidFor: [
      participant('lp-alice', 'account-alice', 100),
      participant('lp-bob', 'account-bob', 100),
      participant('lp-carol', 'account-carol', 100),
    ],
    items: [],
    itemizedRemainder: null,
    documents: [],
    createdBy: null,
    recurrence: null,
    settlement: false,
    ...overrides,
  }
}

describe('webhookEventFilterSchema', () => {
  it('accepts the involvedOnly flag and keeps the events-required refine', () => {
    expect(
      webhookEventFilterSchema.parse({
        created: true,
        updated: false,
        deleted: false,
        involvedOnly: true,
      }),
    ).toEqual({
      created: true,
      updated: false,
      deleted: false,
      involvedOnly: true,
    })
    expect(() =>
      webhookEventFilterSchema.parse({
        created: false,
        updated: false,
        deleted: false,
        involvedOnly: true,
      }),
    ).toThrow()
  })

  it('rejects a missing involvedOnly flag', () => {
    expect(() =>
      webhookEventFilterSchema.parse({
        created: true,
        updated: true,
        deleted: true,
      }),
    ).toThrow()
  })
})

describe('deriveViewer', () => {
  it('computes paid, owes, and net for an involved owner', () => {
    // Alice paid €90, owes €30 (even split three ways).
    expect(deriveViewer(makeSnapshot(), 'account-alice')).toEqual({
      participantId: 'lp-alice',
      paid: 9000,
      owes: 3000,
      net: 6000,
      involved: true,
    })
    expect(deriveViewer(makeSnapshot(), 'account-bob')).toEqual({
      participantId: 'lp-bob',
      paid: 0,
      owes: 3000,
      net: -3000,
      involved: true,
    })
  })

  it('reports uninvolved owners with zeros', () => {
    const snapshot = makeSnapshot({
      paidFor: [
        participant('lp-alice', 'account-alice', 100),
        participant('lp-bob', 'account-bob', 100),
      ],
    })
    expect(deriveViewer(snapshot, 'account-carol')).toEqual({
      participantId: null,
      paid: 0,
      owes: 0,
      net: 0,
      involved: false,
    })
  })

  it('reports a null-participant shape for unknown accounts', () => {
    expect(deriveViewer(makeSnapshot(), 'account-unknown')).toEqual({
      participantId: null,
      paid: 0,
      owes: 0,
      net: 0,
      involved: false,
    })
    expect(deriveViewer(makeSnapshot(), null)).toEqual({
      participantId: null,
      paid: 0,
      owes: 0,
      net: 0,
      involved: false,
    })
  })

  it('reports zeros for settlement expenses', () => {
    const snapshot = makeSnapshot({ categoryId: 'settlement' })
    const viewer = deriveViewer(snapshot, 'account-alice')
    expect(viewer.paid).toBe(0)
    expect(viewer.owes).toBe(0)
    expect(viewer.net).toBe(0)
    expect(viewer.involved).toBe(false)
  })

  it('handles percentage splits', () => {
    const snapshot = makeSnapshot({
      splitMode: 'BY_PERCENTAGE',
      paidFor: [
        participant('lp-alice', 'account-alice', 2500),
        participant('lp-bob', 'account-bob', 7500),
      ],
    })
    expect(deriveViewer(snapshot, 'account-alice')).toMatchObject({
      paid: 9000,
      owes: 2250,
      net: 6750,
      involved: true,
    })
  })

  it('is deterministic for the same expense', () => {
    const snapshot = makeSnapshot()
    expect(deriveViewer(snapshot, 'account-bob')).toEqual(
      deriveViewer(snapshot, 'account-bob'),
    )
  })
})
