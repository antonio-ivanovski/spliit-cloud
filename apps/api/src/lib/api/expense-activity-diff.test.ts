import type { Expense, ExpenseApiItem } from '@spliit/domain'
import { describe, expect, it } from 'vitest'
import {
  getAffectedParticipantIds,
  getExpenseChangedFields,
  getExpenseChangeSummary,
  type ChangeContext,
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
    expect(ids).toEqual(new Set(['lp-alice', 'lp-bob', 'lp-carol']))
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
    expect(ids).toEqual(new Set(['lp-alice', 'lp-bob', 'lp-carol', 'lp-dave']))
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
      documents: [{ id: 'doc-1', url: 'https://x/a.png', width: 1, height: 1 }],
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
      items: [
        item({ id: 'i-1', paidFor: [{ participant: 'lp-alice', shares: 1 }] }),
      ],
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

  it('does NOT flag payers when only amount changes with same single payer (BY_AMOUNT)', () => {
    // Amount increases 4500 -> 5000, Alice still pays 100%.
    // Shares change from 4500 to 5000 but that is derived from total.
    const old = makeExpense({
      amount: 4500,
      paidBySplitMode: 'BY_AMOUNT',
      paidByList: [{ participant: 'lp-alice', shares: 4500 }],
    })
    const updated = makeExpense({
      amount: 5000,
      paidBySplitMode: 'BY_AMOUNT',
      paidByList: [{ participant: 'lp-alice', shares: 5000 }],
    })
    const result = getExpenseChangedFields(old, updated)
    expect(result).not.toContain('payers')
    expect(result).toContain('amount')
  })

  it('does NOT flag payers when amount changes with same multi-payer BY_PERCENTAGE split', () => {
    // Amount goes 1000 -> 2000, same 50/50 percentage, shares still 5000/5000.
    const old = makeExpense({
      amount: 1000,
      paidBySplitMode: 'BY_PERCENTAGE',
      paidByList: [
        { participant: 'lp-alice', shares: 5000 },
        { participant: 'lp-bob', shares: 5000 },
      ],
    })
    const updated = makeExpense({
      amount: 2000,
      paidBySplitMode: 'BY_PERCENTAGE',
      paidByList: [
        { participant: 'lp-alice', shares: 5000 },
        { participant: 'lp-bob', shares: 5000 },
      ],
    })
    const result = getExpenseChangedFields(old, updated)
    expect(result).not.toContain('payers')
    expect(result).toContain('amount')
  })

  it('flags payers when BY_PERCENTAGE split shares change (real config change)', () => {
    const old = makeExpense({
      paidBySplitMode: 'BY_PERCENTAGE',
      paidByList: [
        { participant: 'lp-alice', shares: 7000 },
        { participant: 'lp-bob', shares: 3000 },
      ],
    })
    const updated = makeExpense({
      paidBySplitMode: 'BY_PERCENTAGE',
      paidByList: [
        { participant: 'lp-alice', shares: 5000 },
        { participant: 'lp-bob', shares: 5000 },
      ],
    })
    const result = getExpenseChangedFields(old, updated)
    expect(result).toContain('payers')
  })

  it('flags payers when BY_SHARES split changes', () => {
    const old = makeExpense({
      paidBySplitMode: 'BY_SHARES',
      paidByList: [
        { participant: 'lp-alice', shares: 1 },
        { participant: 'lp-bob', shares: 1 },
      ],
    })
    const updated = makeExpense({
      paidBySplitMode: 'BY_SHARES',
      paidByList: [
        { participant: 'lp-alice', shares: 2 },
        { participant: 'lp-bob', shares: 1 },
      ],
    })
    const result = getExpenseChangedFields(old, updated)
    expect(result).toContain('payers')
  })
})

// ---------------------------------------------------------------------------
// getExpenseChangeSummary
// ---------------------------------------------------------------------------

const testCtx: ChangeContext = {
  getParticipantName: (id) => {
    const names: Record<string, string> = {
      'lp-alice': 'Alice',
      'lp-bob': 'Bob',
      'lp-carol': 'Carol',
    }
    return names[id] ?? id
  },
  getCategoryName: (id) => {
    const cats: Record<string, string> = {
      general: 'General',
      groceries: 'Groceries',
      entertainment: 'Entertainment',
    }
    return cats[id] ?? id
  },
  formatCurrencyCents: (cents, currency) => {
    const code = currency ?? 'EUR'
    const whole = Math.floor(Math.abs(cents) / 100)
    const frac = Math.abs(cents) % 100
    const sign = cents < 0 ? '-' : ''
    return `${sign}${code} ${whole}.${frac.toString().padStart(2, '0')}`
  },
}

describe('getExpenseChangeSummary', () => {
  it('returns null for identical expenses', () => {
    const a = makeExpense()
    const b = makeExpense()
    expect(getExpenseChangeSummary(a, b, testCtx)).toBeNull()
  })

  it('produces amount before/after row and does NOT include payers', () => {
    const old = makeExpense({
      amount: 1200,
      paidBySplitMode: 'BY_AMOUNT',
      paidByList: [{ participant: 'lp-alice', shares: 1200 }],
    })
    const updated = makeExpense({
      amount: 1500,
      paidBySplitMode: 'BY_AMOUNT',
      paidByList: [{ participant: 'lp-alice', shares: 1500 }],
      originalCurrency: 'EUR',
    })
    const result = getExpenseChangeSummary(old, updated, testCtx)
    expect(result).not.toBeNull()
    expect(result!.changedFields).toEqual(['amount'])
    expect(result!.changes).toHaveLength(1)
    expect(result!.changes[0]).toEqual({
      field: 'amount',
      before: 'EUR 12.00',
      after: 'EUR 15.00',
    })
  })

  it('formats amount before/after with each side currency when currency changes', () => {
    const old = makeExpense({
      amount: 4500,
      originalAmount: undefined,
      originalCurrency: undefined,
      paidBySplitMode: 'BY_AMOUNT',
      paidByList: [{ participant: 'lp-alice', shares: 4500 }],
    })
    const updated = makeExpense({
      amount: 4140,
      originalAmount: 4500,
      originalCurrency: 'USD',
      conversionRate: 0.92,
      paidBySplitMode: 'BY_AMOUNT',
      paidByList: [{ participant: 'lp-alice', shares: 4500 }],
    })

    const result = getExpenseChangeSummary(old, updated, testCtx)

    expect(result).not.toBeNull()
    expect(result!.changedFields).toEqual(['amount'])
    expect(result!.changes[0]).toEqual({
      field: 'amount',
      before: 'EUR 45.00',
      after: 'USD 45.00',
    })
  })

  it('includes payers change row when payer participant changes', () => {
    const old = makeExpense({
      paidByList: [{ participant: 'lp-alice', shares: 4500 }],
    })
    const updated = makeExpense({
      paidByList: [{ participant: 'lp-bob', shares: 4500 }],
    })
    const result = getExpenseChangeSummary(old, updated, testCtx)
    expect(result).not.toBeNull()
    expect(result!.changedFields).toEqual(['payers'])
    const payerChange = result!.changes.find((c) => c.field === 'payers')
    expect(payerChange).toEqual({
      field: 'payers',
      before: 'Alice',
      after: 'Bob',
    })
  })

  it('produces before/after rows for title and date changes', () => {
    const old = makeExpense({
      title: 'Lunch',
      expenseDate: new Date('2026-01-15T00:00:00Z'),
    })
    const updated = makeExpense({
      title: 'Dinner',
      expenseDate: new Date('2026-01-16T00:00:00Z'),
    })
    const result = getExpenseChangeSummary(old, updated, testCtx)
    expect(result).not.toBeNull()
    expect(result!.changedFields).toEqual(
      expect.arrayContaining(['title', 'date']),
    )
    expect(result!.changes).toEqual(
      expect.arrayContaining([
        { field: 'title', before: 'Lunch', after: 'Dinner' },
        { field: 'date', before: '2026-01-15', after: '2026-01-16' },
      ]),
    )
  })

  it('produces category change row', () => {
    const result = getExpenseChangeSummary(
      makeExpense({ category: 'general' }),
      makeExpense({ category: 'groceries' }),
      testCtx,
    )
    expect(result).not.toBeNull()
    const cat = result!.changes.find((c) => c.field === 'category')
    expect(cat).toEqual({
      field: 'category',
      before: 'General',
      after: 'Groceries',
    })
  })

  it('produces split change row', () => {
    const old = makeExpense({
      splitMode: 'EVENLY',
      paidFor: [
        { participant: 'lp-alice', shares: 1 },
        { participant: 'lp-bob', shares: 1 },
      ],
    })
    const updated = makeExpense({
      splitMode: 'BY_PERCENTAGE',
      paidFor: [
        { participant: 'lp-alice', shares: 7000 },
        { participant: 'lp-bob', shares: 3000 },
      ],
    })
    const result = getExpenseChangeSummary(old, updated, testCtx)
    expect(result).not.toBeNull()
    expect(result!.changedFields).toContain('split')
    const splitChange = result!.changes.find((c) => c.field === 'split')
    expect(splitChange?.before).toBe('Equal split: Alice, Bob')
    expect(splitChange?.after).toBe('Custom split: Alice 70%, Bob 30%')
  })

  it('produces document count change row', () => {
    const old = makeExpense({
      documents: [{ id: 'doc-1', url: 'https://x/a.png', width: 1, height: 1 }],
    })
    const updated = makeExpense({
      documents: [
        { id: 'doc-1', url: 'https://x/a.png', width: 1, height: 1 },
        { id: 'doc-2', url: 'https://x/b.png', width: 1, height: 1 },
      ],
    })
    const result = getExpenseChangeSummary(old, updated, testCtx)
    expect(result).not.toBeNull()
    const docChange = result!.changes.find((c) => c.field === 'documents')
    expect(docChange).toEqual({ field: 'documents', before: '1', after: '2' })
  })

  it('returns null for no meaningful change', () => {
    const result = getExpenseChangeSummary(
      makeExpense(),
      makeExpense(),
      testCtx,
    )
    expect(result).toBeNull()
  })
})
