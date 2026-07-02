import { describe, expect, it } from 'vitest'
import type { Expense, ExpenseApiItem } from '@spliit/domain'
import {
  getAffectedParticipantIds,
  getExpenseChangedFields,
} from './expense-activity-diff'

function makeExpense(overrides: Partial<Expense> = {}): Expense {
  const base: Expense = {
    expenseDate: new Date('2026-01-01T00:00:00.000Z'),
    title: 'Dinner',
    category: 'general',
    amount: 4500,
    paidBySplitMode: 'BY_AMOUNT',
    paidByList: [{ participant: 'lp-alice', shares: 4500 }],
    paidFor: [
      { participant: 'lp-alice', shares: 1 },
      { participant: 'lp-bob', shares: 1 },
    ],
    isMultiPayer: false,
    splitMode: 'EVENLY',
    saveDefaultSplittingOptions: false,
    isReimbursement: false,
    documents: [],
    recurrenceRule: 'NONE',
  } as Expense
  return { ...base, ...overrides } as Expense
}

function item(overrides: Partial<ExpenseApiItem> = {}): ExpenseApiItem {
  return {
    id: undefined,
    title: 'Pizza',
    unitPrice: 1500,
    quantity: 1,
    amount: 1500,
    splitMode: 'EVENLY',
    paidFor: [{ participant: 'lp-alice', shares: 1 }],
    ...overrides,
  } as ExpenseApiItem
}

describe('getAffectedParticipantIds', () => {
  it('returns every payer and split participant from a single expense (create case)', () => {
    const expense = makeExpense({
      paidByList: [
        { participant: 'lp-alice', shares: 3000 },
        { participant: 'lp-bob', shares: 1500 },
      ],
      paidFor: [
        { participant: 'lp-alice', shares: 1 },
        { participant: 'lp-bob', shares: 1 },
        { participant: 'lp-carol', shares: 1 },
      ],
    })
    const ids = getAffectedParticipantIds({ newExpense: expense })
    expect(ids).toEqual(
      new Set(['lp-alice', 'lp-bob', 'lp-carol']),
    )
  })

  it('unions old and new expense participant ids (update case)', () => {
    const oldExpense = makeExpense({
      paidByList: [{ participant: 'lp-alice', shares: 4500 }],
      paidFor: [
        { participant: 'lp-alice', shares: 1 },
        { participant: 'lp-bob', shares: 1 },
      ],
    })
    const newExpense = makeExpense({
      paidByList: [{ participant: 'lp-alice', shares: 4500 }],
      paidFor: [
        { participant: 'lp-alice', shares: 1 },
        { participant: 'lp-carol', shares: 1 },
      ],
    })
    const ids = getAffectedParticipantIds({ oldExpense, newExpense })
    // Bob was removed, Carol was added — both stay in the union so an
    // update can notify "removed from expense" members as well.
    expect(ids).toEqual(new Set(['lp-alice', 'lp-bob', 'lp-carol']))
  })

  it('tolerates undefined oldExpense (create)', () => {
    const ids = getAffectedParticipantIds({
      newExpense: makeExpense(),
    })
    expect(ids.has('lp-alice')).toBe(true)
    expect(ids.has('lp-bob')).toBe(true)
  })

  it('tolerates undefined newExpense (delete)', () => {
    const ids = getAffectedParticipantIds({
      oldExpense: makeExpense(),
    })
    expect(ids.has('lp-alice')).toBe(true)
    expect(ids.has('lp-bob')).toBe(true)
  })

  it('collects participants referenced by items and itemized remainder', () => {
    const oldExpense = makeExpense({
      splitMode: 'ITEMIZED',
      paidFor: [{ participant: 'lp-alice', shares: 1 }],
      items: [
        item({ id: 'i-1', paidFor: [{ participant: 'lp-alice', shares: 1 }] }),
      ],
    })
    const newExpense = makeExpense({
      splitMode: 'ITEMIZED',
      paidFor: [{ participant: 'lp-alice', shares: 1 }],
      items: [
        item({
          id: 'i-1',
          paidFor: [{ participant: 'lp-alice', shares: 1 }],
        }),
        item({
          id: 'i-2',
          paidFor: [
            { participant: 'lp-bob', shares: 1 },
            { participant: 'lp-carol', shares: 1 },
          ],
        }),
      ],
      itemizedRemainder: {
        splitMode: 'EVENLY',
        paidFor: [{ participant: 'lp-dave', shares: 1 }],
      },
    })
    const ids = getAffectedParticipantIds({ oldExpense, newExpense })
    expect(ids).toEqual(
      new Set(['lp-alice', 'lp-bob', 'lp-carol', 'lp-dave']),
    )
  })
})

describe('getExpenseChangedFields', () => {
  it('returns null for byte-identical expenses', () => {
    const a = makeExpense()
    const b = makeExpense()
    expect(getExpenseChangedFields(a, b)).toBeNull()
  })

  it('detects title, amount, date, category, notes, recurrence one-by-one', () => {
    expect(
      getExpenseChangedFields(
        makeExpense({ title: 'A' }),
        makeExpense({ title: 'B' }),
      ),
    ).toEqual(['title'])
    expect(
      getExpenseChangedFields(
        makeExpense({ amount: 100 }),
        makeExpense({ amount: 200 }),
      ),
    ).toEqual(['amount'])
    expect(
      getExpenseChangedFields(
        makeExpense({ expenseDate: new Date('2026-01-01') }),
        makeExpense({ expenseDate: new Date('2026-01-02') }),
      ),
    ).toEqual(['date'])
    // Compare a Date with an ISO-string form across the API boundary.
    expect(
      getExpenseChangedFields(
        makeExpense({ expenseDate: new Date('2026-01-01T00:00:00.000Z') }),
        makeExpense({
          expenseDate: new Date('2026-01-01T00:00:00.000Z'),
        }),
      ),
    ).toBeNull()
    expect(
      getExpenseChangedFields(
        makeExpense({ category: 'general' }),
        makeExpense({ category: 'groceries' }),
      ),
    ).toEqual(['category'])
    expect(
      getExpenseChangedFields(
        makeExpense({ notes: undefined }),
        makeExpense({ notes: 'added a note' }),
      ),
    ).toEqual(['notes'])
    expect(
      getExpenseChangedFields(
        makeExpense({ recurrenceRule: 'NONE' }),
        makeExpense({ recurrenceRule: 'WEEKLY' }),
      ),
    ).toEqual(['recurrence'])
  })

  it('flags payer-only changes as `payers`', () => {
    const result = getExpenseChangedFields(
      makeExpense({
        paidByList: [{ participant: 'lp-alice', shares: 4500 }],
      }),
      makeExpense({
        paidByList: [{ participant: 'lp-bob', shares: 4500 }],
      }),
    )
    expect(result).toEqual(['payers'])
  })

  it('flags split-only changes as `split` and ignores reorder', () => {
    // Same shares, different order — compare should be order-independent.
    const a = makeExpense({
      paidFor: [
        { participant: 'lp-alice', shares: 1 },
        { participant: 'lp-bob', shares: 1 },
      ],
    })
    const b = makeExpense({
      paidFor: [
        { participant: 'lp-bob', shares: 1 },
        { participant: 'lp-alice', shares: 1 },
      ],
    })
    expect(getExpenseChangedFields(a, b)).toBeNull()

    const change = makeExpense({
      paidFor: [{ participant: 'lp-alice', shares: 2 }],
    })
    const result = getExpenseChangedFields(makeExpense(), change)
    expect(result).toEqual(['split'])
  })

  it('flags documents change when a document is added or removed', () => {
    const a = makeExpense({
      documents: [
        { id: 'doc-1', url: 'https://x/a.png', width: 1, height: 1 },
      ],
    })
    const bWithRemoved = makeExpense({ documents: [] })
    expect(getExpenseChangedFields(a, bWithRemoved)).toEqual(['documents'])

    const bWithAdded = makeExpense({
      documents: [
        { id: 'doc-1', url: 'https://x/a.png', width: 1, height: 1 },
        { id: 'doc-2', url: 'https://x/b.png', width: 1, height: 1 },
      ],
    })
    expect(getExpenseChangedFields(a, bWithAdded)).toEqual(['documents'])
  })

  it('flags itemized item change as `items` (added/removed item or paid-for change)', () => {
    const withItem = makeExpense({
      splitMode: 'ITEMIZED',
      paidFor: [{ participant: 'lp-alice', shares: 1 }],
      items: [item({ id: 'i-1', paidFor: [{ participant: 'lp-alice', shares: 1 }] })],
    })

    // Identical item sets in different insertion order compare equal.
    const reordered = makeExpense({
      splitMode: 'ITEMIZED',
      paidFor: [{ participant: 'lp-alice', shares: 1 }],
      items: [
        item({
          id: 'i-2',
          paidFor: [{ participant: 'lp-alice', shares: 1 }],
        }),
        item({
          id: 'i-1',
          paidFor: [{ participant: 'lp-alice', shares: 1 }],
        }),
      ],
    })
    expect(getExpenseChangedFields(withItem, reordered)).toEqual(['items'])

    // Adding a second item reports `items`.
    const added = makeExpense({
      splitMode: 'ITEMIZED',
      paidFor: [{ participant: 'lp-alice', shares: 1 }],
      items: [
        item({ id: 'i-1', paidFor: [{ participant: 'lp-alice', shares: 1 }] }),
        item({ id: 'i-2', paidFor: [{ participant: 'lp-alice', shares: 1 }] }),
      ],
    })
    expect(getExpenseChangedFields(withItem, added)).toEqual(['items'])

    // Removing an item reports `items`.
    const removed = makeExpense({
      splitMode: 'ITEMIZED',
      paidFor: [{ participant: 'lp-alice', shares: 1 }],
      items: [],
    })
    expect(getExpenseChangedFields(withItem, removed)).toEqual(['items'])

    // Changing paid-for inside an item also reports `items`.
    const changedPaidFor = makeExpense({
      splitMode: 'ITEMIZED',
      paidFor: [{ participant: 'lp-alice', shares: 1 }],
      items: [
        item({
          id: 'i-1',
          paidFor: [
            { participant: 'lp-alice', shares: 1 },
            { participant: 'lp-bob', shares: 1 },
          ],
        }),
      ],
    })
    expect(getExpenseChangedFields(withItem, changedPaidFor)).toEqual(['items'])
  })

  it('reports multiple changed-field groups at once', () => {
    const result = getExpenseChangedFields(
      makeExpense({ title: 'Old', amount: 1000, notes: 'previous' }),
      makeExpense({
        title: 'New',
        amount: 2000,
        notes: 'updated',
      }),
    )
    expect(result).toEqual(expect.arrayContaining(['title', 'amount', 'notes']))
    expect(result).not.toContain('split')
  })

  it('flags the expense year-rollover date change correctly', () => {
    const a = makeExpense({ expenseDate: new Date('2026-12-31T00:00:00Z') })
    const b = makeExpense({ expenseDate: new Date('2027-01-01T00:00:00Z') })
    expect(getExpenseChangedFields(a, b)).toEqual(['date'])
  })
})
