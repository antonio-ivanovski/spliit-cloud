import type { Expense, ExpenseApiItem } from '@spliit/domain'
import { describe, expect, it } from 'vitest'
import {
  getAffectedParticipantIds,
  getExpenseChangeSummary,
  getExpenseChangedFields,
} from './index'
import type { ChangeContext } from './types'

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeExpense(overrides: Partial<Expense> = {}): Expense {
  return {
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
    ...overrides,
  } as Expense
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

const ctx: ChangeContext = {
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

// ---------------------------------------------------------------------------
// getAffectedParticipantIds
// ---------------------------------------------------------------------------

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
    expect(getAffectedParticipantIds({ newExpense: expense })).toEqual(
      new Set(['lp-alice', 'lp-bob', 'lp-carol']),
    )
  })

  it('unions old and new participant ids (update case)', () => {
    const old = makeExpense({
      paidByList: [{ participant: 'lp-alice', shares: 4500 }],
      paidFor: [
        { participant: 'lp-alice', shares: 1 },
        { participant: 'lp-bob', shares: 1 },
      ],
    })
    const upd = makeExpense({
      paidByList: [{ participant: 'lp-alice', shares: 4500 }],
      paidFor: [
        { participant: 'lp-alice', shares: 1 },
        { participant: 'lp-carol', shares: 1 },
      ],
    })
    expect(
      getAffectedParticipantIds({ oldExpense: old, newExpense: upd }),
    ).toEqual(new Set(['lp-alice', 'lp-bob', 'lp-carol']))
  })

  it('tolerates undefined oldExpense (create)', () => {
    const ids = getAffectedParticipantIds({ newExpense: makeExpense() })
    expect(ids.has('lp-alice')).toBe(true)
    expect(ids.has('lp-bob')).toBe(true)
  })

  it('tolerates undefined newExpense (delete)', () => {
    const ids = getAffectedParticipantIds({ oldExpense: makeExpense() })
    expect(ids.has('lp-alice')).toBe(true)
    expect(ids.has('lp-bob')).toBe(true)
  })

  it('collects from items and itemized remainder', () => {
    const old = makeExpense({
      splitMode: 'ITEMIZED',
      paidFor: [{ participant: 'lp-alice', shares: 1 }],
      items: [
        item({ id: 'i-1', paidFor: [{ participant: 'lp-alice', shares: 1 }] }),
      ],
    })
    const upd = makeExpense({
      splitMode: 'ITEMIZED',
      paidFor: [{ participant: 'lp-alice', shares: 1 }],
      items: [
        item({ id: 'i-1', paidFor: [{ participant: 'lp-alice', shares: 1 }] }),
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
    expect(
      getAffectedParticipantIds({ oldExpense: old, newExpense: upd }),
    ).toEqual(new Set(['lp-alice', 'lp-bob', 'lp-carol', 'lp-dave']))
  })
})

// ---------------------------------------------------------------------------
// getExpenseChangedFields — backward-compat smoke tests
// ---------------------------------------------------------------------------

describe('getExpenseChangedFields (backward-compat)', () => {
  it('returns null for identical expenses', () => {
    expect(getExpenseChangedFields(makeExpense(), makeExpense())).toBeNull()
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
    expect(
      getExpenseChangedFields(
        makeExpense({ category: 'general' }),
        makeExpense({ category: 'groceries' }),
      ),
    ).toEqual(['category'])
    expect(
      getExpenseChangedFields(
        makeExpense({ notes: undefined }),
        makeExpense({ notes: 'added' }),
      ),
    ).toEqual(['notes'])
    expect(
      getExpenseChangedFields(
        makeExpense({ recurrenceRule: 'NONE' }),
        makeExpense({ recurrenceRule: 'WEEKLY' }),
      ),
    ).toEqual(['recurrence'])
  })

  it('Date vs ISO-string of same instant reports null', () => {
    expect(
      getExpenseChangedFields(
        makeExpense({ expenseDate: new Date('2026-01-01T00:00:00.000Z') }),
        makeExpense({ expenseDate: new Date('2026-01-01T00:00:00.000Z') }),
      ),
    ).toBeNull()
  })

  it('does NOT flag payers when BY_AMOUNT shares change (only amount flagged)', () => {
    const result = getExpenseChangedFields(
      makeExpense({
        amount: 4500,
        paidByList: [{ participant: 'lp-alice', shares: 4500 }],
      }),
      makeExpense({
        amount: 5000,
        paidByList: [{ participant: 'lp-alice', shares: 5000 }],
      }),
    )
    expect(result).not.toContain('payers')
    expect(result).toContain('amount')
  })

  it('flags payers when BY_PERCENTAGE shares change', () => {
    const result = getExpenseChangedFields(
      makeExpense({
        paidBySplitMode: 'BY_PERCENTAGE',
        paidByList: [
          { participant: 'lp-alice', shares: 7000 },
          { participant: 'lp-bob', shares: 3000 },
        ],
      }),
      makeExpense({
        paidBySplitMode: 'BY_PERCENTAGE',
        paidByList: [
          { participant: 'lp-alice', shares: 5000 },
          { participant: 'lp-bob', shares: 5000 },
        ],
      }),
    )
    expect(result).toContain('payers')
  })

  it('flags payers when BY_SHARES splits change', () => {
    const result = getExpenseChangedFields(
      makeExpense({
        paidBySplitMode: 'BY_SHARES',
        paidByList: [
          { participant: 'lp-alice', shares: 1 },
          { participant: 'lp-bob', shares: 1 },
        ],
      }),
      makeExpense({
        paidBySplitMode: 'BY_SHARES',
        paidByList: [
          { participant: 'lp-alice', shares: 2 },
          { participant: 'lp-bob', shares: 1 },
        ],
      }),
    )
    expect(result).toContain('payers')
  })

  it('split reorder is a no-op (order-independent)', () => {
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
  })

  it('detects actual split change', () => {
    expect(
      getExpenseChangedFields(
        makeExpense(),
        makeExpense({ paidFor: [{ participant: 'lp-alice', shares: 2 }] }),
      ),
    ).toEqual(['split'])
  })

  it('detects items and documents changes', () => {
    expect(
      getExpenseChangedFields(
        makeExpense({ items: [item({ id: 'i-1' })] }),
        makeExpense({ items: [item({ id: 'i-1' }), item({ id: 'i-2' })] }),
      ),
    ).toEqual(['items'])

    const doc1 = { id: 'doc-1', url: 'https://x/a.png', width: 1, height: 1 }
    const doc2 = { id: 'doc-2', url: 'https://x/b.png', width: 1, height: 1 }
    expect(
      getExpenseChangedFields(
        makeExpense({ documents: [doc1] }),
        makeExpense({ documents: [doc1, doc2] }),
      ),
    ).toEqual(['documents'])
  })

  it('reports multiple changed fields at once', () => {
    const result = getExpenseChangedFields(
      makeExpense({ title: 'Old', amount: 1000, notes: 'old' }),
      makeExpense({ title: 'New', amount: 2000, notes: 'new' }),
    )
    expect(result).toEqual(expect.arrayContaining(['title', 'amount', 'notes']))
    expect(result).not.toContain('split')
  })

  it('handles year-rollover date change', () => {
    expect(
      getExpenseChangedFields(
        makeExpense({ expenseDate: new Date('2026-12-31T00:00:00Z') }),
        makeExpense({ expenseDate: new Date('2027-01-01T00:00:00Z') }),
      ),
    ).toEqual(['date'])
  })
})

// ---------------------------------------------------------------------------
// getExpenseChangeSummary — backward-compat smoke tests
// ---------------------------------------------------------------------------

describe('getExpenseChangeSummary (backward-compat)', () => {
  it('returns null for identical expenses', () => {
    expect(
      getExpenseChangeSummary(makeExpense(), makeExpense(), ctx),
    ).toBeNull()
  })

  it('produces amount before/after and excludes payers (BY_AMOUNT noise suppression)', () => {
    const result = getExpenseChangeSummary(
      makeExpense({
        amount: 1200,
        paidByList: [{ participant: 'lp-alice', shares: 1200 }],
      }),
      makeExpense({
        amount: 1500,
        paidByList: [{ participant: 'lp-alice', shares: 1500 }],
      }),
      ctx,
    )
    expect(result).not.toBeNull()
    expect(result!.changedFields).toEqual(['amount'])
    expect(result!.changes).toHaveLength(1)
    expect(result!.changes[0]).toEqual({
      field: 'amount',
      before: 'EUR 12.00',
      after: 'EUR 15.00',
    })
  })

  it('formats amount with each side currency', () => {
    const result = getExpenseChangeSummary(
      makeExpense({
        amount: 4500,
        originalAmount: undefined,
        originalCurrency: undefined,
      }),
      makeExpense({
        amount: 4140,
        originalAmount: 4500,
        originalCurrency: 'USD',
        conversionRate: 0.92,
      }),
      ctx,
    )
    expect(result).not.toBeNull()
    expect(result!.changes[0]).toEqual({
      field: 'amount',
      before: 'EUR 45.00',
      after: 'USD 45.00',
    })
  })

  it('includes payers change when participant differs', () => {
    const result = getExpenseChangeSummary(
      makeExpense({ paidByList: [{ participant: 'lp-alice', shares: 4500 }] }),
      makeExpense({ paidByList: [{ participant: 'lp-bob', shares: 4500 }] }),
      ctx,
    )
    expect(result).not.toBeNull()
    expect(result!.changes.find((c) => c.field === 'payers')).toEqual({
      field: 'payers',
      before: 'Alice',
      after: 'Bob',
    })
  })

  it('produces title and date changes', () => {
    const result = getExpenseChangeSummary(
      makeExpense({
        title: 'Lunch',
        expenseDate: new Date('2026-01-15T00:00:00Z'),
      }),
      makeExpense({
        title: 'Dinner',
        expenseDate: new Date('2026-01-16T00:00:00Z'),
      }),
      ctx,
    )
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

  it('produces category change', () => {
    const result = getExpenseChangeSummary(
      makeExpense({ category: 'general' }),
      makeExpense({ category: 'groceries' }),
      ctx,
    )
    expect(result).not.toBeNull()
    expect(result!.changes.find((c) => c.field === 'category')).toEqual({
      field: 'category',
      before: 'General',
      after: 'Groceries',
    })
  })

  it('produces split change row', () => {
    const result = getExpenseChangeSummary(
      makeExpense({
        splitMode: 'EVENLY',
        paidFor: [
          { participant: 'lp-alice', shares: 1 },
          { participant: 'lp-bob', shares: 1 },
        ],
      }),
      makeExpense({
        splitMode: 'BY_PERCENTAGE',
        paidFor: [
          { participant: 'lp-alice', shares: 7000 },
          { participant: 'lp-bob', shares: 3000 },
        ],
      }),
      ctx,
    )
    expect(result).not.toBeNull()
    expect(result!.changedFields).toContain('split')
    const sc = result!.changes.find((c) => c.field === 'split')
    expect(sc?.before).toBe('Equal split: Alice, Bob')
    expect(sc?.after).toBe('Custom split: Alice 70%, Bob 30%')
  })

  it('produces document count change', () => {
    const d1 = { id: 'doc-1', url: 'https://x/a.png', width: 1, height: 1 }
    const d2 = { id: 'doc-2', url: 'https://x/b.png', width: 1, height: 1 }
    const result = getExpenseChangeSummary(
      makeExpense({ documents: [d1] }),
      makeExpense({ documents: [d1, d2] }),
      ctx,
    )
    expect(result).not.toBeNull()
    expect(result!.changes.find((c) => c.field === 'documents')).toEqual({
      field: 'documents',
      before: '1 attachment',
      after: '2 attachments',
    })
  })

  it('shows null for zero documents', () => {
    const d1 = { id: 'doc-1', url: 'https://x/a.png', width: 1, height: 1 }
    const result = getExpenseChangeSummary(
      makeExpense({ documents: [d1] }),
      makeExpense({ documents: [] }),
      ctx,
    )
    expect(result).not.toBeNull()
    expect(result!.changes.find((c) => c.field === 'documents')).toEqual({
      field: 'documents',
      before: '1 attachment',
      after: null,
    })
  })

  it('uses semantic labels for notes (Added/Removed/Present)', () => {
    const added = getExpenseChangeSummary(
      makeExpense({ notes: undefined }),
      makeExpense({ notes: 'x' }),
      ctx,
    )
    expect(added!.changes.find((c) => c.field === 'notes')).toEqual({
      field: 'notes',
      before: null,
      after: 'Added',
    })

    const removed = getExpenseChangeSummary(
      makeExpense({ notes: 'x' }),
      makeExpense({ notes: undefined }),
      ctx,
    )
    expect(removed!.changes.find((c) => c.field === 'notes')).toEqual({
      field: 'notes',
      before: 'Removed',
      after: null,
    })

    const mod = getExpenseChangeSummary(
      makeExpense({ notes: 'a' }),
      makeExpense({ notes: 'b' }),
      ctx,
    )
    expect(mod!.changes.find((c) => c.field === 'notes')).toEqual({
      field: 'notes',
      before: 'Present',
      after: 'Present',
    })
  })

  it('shows item counts', () => {
    const result = getExpenseChangeSummary(
      makeExpense({ splitMode: 'ITEMIZED' }),
      makeExpense({
        items: [item({ id: 'i-1' }), item({ id: 'i-2' })],
        splitMode: 'ITEMIZED',
      }),
      ctx,
    )
    expect(result).not.toBeNull()
    expect(result!.changes.find((c) => c.field === 'items')).toEqual({
      field: 'items',
      before: null,
      after: '2',
    })
  })

  it('produces friendly recurrence labels', () => {
    const result = getExpenseChangeSummary(
      makeExpense({ recurrenceRule: 'NONE' }),
      makeExpense({ recurrenceRule: 'WEEKLY' }),
      ctx,
    )
    expect(result).not.toBeNull()
    expect(result!.changes.find((c) => c.field === 'recurrence')).toEqual({
      field: 'recurrence',
      before: 'Not recurring',
      after: 'Weekly',
    })
  })
})

// ---------------------------------------------------------------------------
// Full pipeline smoke test
// ---------------------------------------------------------------------------

describe('Full pipeline (smoke)', () => {
  it('detects and formats all 10 field types in a single diff', () => {
    const doc1 = { id: 'doc-1', url: 'https://x/a.png', width: 1, height: 1 }
    const old = makeExpense({
      title: 'Lunch',
      amount: 1000,
      expenseDate: new Date('2026-01-01T00:00:00Z'),
      category: 'general',
      notes: 'old notes',
      recurrenceRule: 'NONE',
      paidByList: [{ participant: 'lp-alice', shares: 1000 }],
      paidFor: [
        { participant: 'lp-alice', shares: 1 },
        { participant: 'lp-bob', shares: 1 },
      ],
      splitMode: 'EVENLY',
      documents: [doc1],
      items: [item({ id: 'i-1' })],
    })
    const upd = makeExpense({
      title: 'Dinner',
      amount: 2000,
      expenseDate: new Date('2026-02-01T00:00:00Z'),
      category: 'groceries',
      notes: undefined,
      recurrenceRule: 'WEEKLY',
      paidByList: [{ participant: 'lp-bob', shares: 2000 }],
      paidFor: [{ participant: 'lp-bob', shares: 1 }],
      splitMode: 'BY_PERCENTAGE',
      documents: [],
      items: [],
    })
    const result = getExpenseChangeSummary(old, upd, ctx)
    expect(result).not.toBeNull()
    expect(result!.changedFields).toHaveLength(10)
    expect(result!.changes).toHaveLength(10)
  })

  it('returns null when no field has meaningfully changed', () => {
    expect(
      getExpenseChangeSummary(makeExpense(), makeExpense(), ctx),
    ).toBeNull()
    expect(getExpenseChangedFields(makeExpense(), makeExpense())).toBeNull()
  })
})
