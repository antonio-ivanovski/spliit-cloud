import { describe, expect, it } from 'vitest'

import { mergeExpenseLists, type MergeableExpense } from './merge-expenses'

/**
 * Fixtures mirror real list rows: no `version` (detail-only) and full rendered
 * projection. Change detection must work on these fields.
 */
function row(
  id: string,
  overrides: Partial<MergeableExpense> = {},
): MergeableExpense {
  return {
    id,
    expenseDate: new Date('2026-03-02T12:00:00Z'),
    createdAt: new Date('2026-03-02T13:00:00Z'),
    amount: 1000,
    title: `Expense ${id}`,
    expenseTimeZone: 'UTC',
    categoryId: 'groceries',
    splitMode: 'EVENLY',
    paidBySplitMode: 'EVENLY',
    documentCount: 0,
    ...overrides,
  }
}

describe('mergeExpenseLists', () => {
  it('returns local rows immediately while the network is pending', () => {
    const local = [row('a'), row('b')]
    const result = mergeExpenseLists({ local, network: null })

    expect(result.expenses).toHaveLength(2)
    expect(result.addedIds).toEqual([])
    // Same references: memoized cards bail out (canonical order is id desc).
    expect(result.expenses.map((expense) => expense.id)).toEqual(['b', 'a'])
    expect(result.expenses.find((expense) => expense.id === 'a')).toBe(local[0])
  })

  it('inserts network-only rows and reuses local references for unchanged rows', () => {
    const localA = row('a')
    const localB = row('b')
    const network = [row('a'), row('b'), row('c')]
    const result = mergeExpenseLists({
      local: [localA, localB],
      network,
      networkComplete: true,
    })

    // Canonical order: equal timestamps fall through to fixed id desc.
    expect(result.expenses.map((expense) => expense.id)).toEqual([
      'c',
      'b',
      'a',
    ])
    expect(result.addedIds).toEqual(['c'])
    expect(result.updatedIds).toEqual([])
    expect(result.expenses.find((expense) => expense.id === 'a')).toBe(localA)
    expect(result.expenses.find((expense) => expense.id === 'b')).toBe(localB)
  })

  it('patches changed rows with the network reference', () => {
    const localA = row('a', { amount: 1000 })
    const networkA = row('a', { amount: 2000 })
    const result = mergeExpenseLists({
      local: [localA],
      network: [networkA],
      networkComplete: true,
    })

    expect(result.updatedIds).toEqual(['a'])
    expect(result.expenses[0]).toBe(networkA)
    expect(result.expenses[0]).not.toBe(localA)
  })

  it('detects participant share changes without a version field', () => {
    const localA = row('a', {
      paidFor: [{ ledgerParticipant: { id: 'lp-1' }, shares: 1 }],
    })
    const networkA = row('a', {
      paidFor: [
        { ledgerParticipant: { id: 'lp-1' }, shares: 1 },
        { ledgerParticipant: { id: 'lp-2' }, shares: 1 },
      ],
    })
    const result = mergeExpenseLists({
      local: [localA],
      network: [networkA],
      networkComplete: true,
    })

    expect(result.updatedIds).toEqual(['a'])
    expect(result.expenses[0]).toBe(networkA)
  })

  it('detects participant renames without a version field', () => {
    const localA = row('a', {
      paidFor: [
        {
          ledgerParticipant: { id: 'lp-1', name: 'Alice', removed: false },
          shares: 1,
        },
      ],
    })
    const networkA = row('a', {
      paidFor: [
        {
          ledgerParticipant: { id: 'lp-1', name: 'Alicia', removed: false },
          shares: 1,
        },
      ],
    })
    const result = mergeExpenseLists({
      local: [localA],
      network: [networkA],
      networkComplete: true,
    })

    expect(result.updatedIds).toEqual(['a'])
    expect(result.expenses[0]).toBe(networkA)
  })

  it('sorts merged rows canonically: primary dir, then fixed desc tie-breaks', () => {
    const local = [
      row('old', { expenseDate: new Date('2026-01-01T12:00:00Z') }),
    ]
    const network = [
      row('new', { expenseDate: new Date('2026-04-01T12:00:00Z') }),
      row('old', { expenseDate: new Date('2026-01-01T12:00:00Z') }),
    ]
    const result = mergeExpenseLists({
      local,
      network,
      networkComplete: true,
    })

    expect(result.expenses.map((expense) => expense.id)).toEqual(['new', 'old'])
  })

  it('uses fixed desc id order regardless of selected dir', () => {
    const local = [row('a'), row('b')]
    const ascending = mergeExpenseLists({
      local,
      network: [row('a'), row('b')],
      sortBy: 'amount',
      sortDir: 'asc',
      networkComplete: true,
    })

    // Equal amounts: id desc even when the primary dir is asc.
    expect(ascending.expenses.map((expense) => expense.id)).toEqual(['b', 'a'])
  })

  it('retains local-only rows while the network window is partial', () => {
    // A concurrent insert shifted the page boundary: rank-20 fell off the
    // network page but lives in the downloaded snapshot.
    const local = [row('fresh'), row('boundary')]
    const network = [row('fresh')]
    const result = mergeExpenseLists({ local, network })

    expect(result.expenses.map((expense) => expense.id)).toContain('boundary')
    expect(result.addedIds).toEqual([])
  })

  it('drops local-only rows once the network window is complete', () => {
    const local = [row('a'), row('deleted')]
    const network = [row('a')]
    const result = mergeExpenseLists({
      local,
      network,
      networkComplete: true,
    })

    expect(result.expenses.map((expense) => expense.id)).toEqual(['a'])
  })

  it('overlays pending offline-created rows and never drops them', () => {
    const pending = {
      ...row('pending-1'),
      id: 'pending-1',
      clientId: 'pending-1',
      requestId: 'req-1',
      status: 'pending' as const,
    }
    const result = mergeExpenseLists({
      local: [row('a')],
      network: [row('a')],
      pending: [pending],
      networkComplete: true,
    })

    expect(result.expenses.map((expense) => expense.id)).toContain('pending-1')
    expect(result.pendingIds).toEqual(['pending-1'])
    expect(result.expenses.find((expense) => expense.id === 'pending-1')).toBe(
      pending,
    )
  })

  it('keeps pending rows when the network has no trace of them yet', () => {
    const pending = {
      ...row('pending-9'),
      id: 'pending-9',
      clientId: 'pending-9',
      requestId: 'req-9',
      status: 'pending' as const,
    }
    const result = mergeExpenseLists({
      local: [],
      network: [],
      pending: [pending],
      networkComplete: true,
    })

    expect(result.expenses).toHaveLength(1)
    expect(result.expenses[0]).toBe(pending)
  })
})
