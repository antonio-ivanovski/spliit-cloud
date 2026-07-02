import type { Expense } from '@spliit/domain'
import { describe, expect, it } from 'vitest'
import { payersDiffer } from './payers.differ'
import type { ChangeContext } from './types'

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

const ctx: ChangeContext = {
  getParticipantName: (id) => {
    const m: Record<string, string> = {
      'lp-alice': 'Alice',
      'lp-bob': 'Bob',
      'lp-carol': 'Carol',
    }
    return m[id] ?? id
  },
  getCategoryName: (id) => id,
  formatCurrencyCents: (c, cur) => `${cur ?? 'EUR'} ${c / 100}`,
}

describe('payersDiffer', () => {
  it('check returns false when payers are identical', () => {
    expect(
      payersDiffer.check(
        makeExpense({
          paidByList: [{ participant: 'lp-alice', shares: 4500 }],
        }),
        makeExpense({
          paidByList: [{ participant: 'lp-alice', shares: 4500 }],
        }),
      ),
    ).toBe(false)
  })

  it('check returns true when payer participant changes', () => {
    expect(
      payersDiffer.check(
        makeExpense({
          paidByList: [{ participant: 'lp-alice', shares: 4500 }],
        }),
        makeExpense({ paidByList: [{ participant: 'lp-bob', shares: 4500 }] }),
      ),
    ).toBe(true)
  })

  it('BY_AMOUNT: does NOT flag when shares change due to amount change (false-positive avoidance)', () => {
    const old = makeExpense({
      amount: 4500,
      paidBySplitMode: 'BY_AMOUNT',
      paidByList: [{ participant: 'lp-alice', shares: 4500 }],
    })
    const upd = makeExpense({
      amount: 5000,
      paidBySplitMode: 'BY_AMOUNT',
      paidByList: [{ participant: 'lp-alice', shares: 5000 }],
    })
    expect(payersDiffer.check(old, upd)).toBe(false)
  })

  it('BY_AMOUNT multi-payer: does NOT flag when shares change due to amount', () => {
    const old = makeExpense({
      amount: 1000,
      paidBySplitMode: 'BY_AMOUNT',
      paidByList: [
        { participant: 'lp-alice', shares: 600 },
        { participant: 'lp-bob', shares: 400 },
      ],
    })
    const upd = makeExpense({
      amount: 2000,
      paidBySplitMode: 'BY_AMOUNT',
      paidByList: [
        { participant: 'lp-alice', shares: 1200 },
        { participant: 'lp-bob', shares: 800 },
      ],
    })
    expect(payersDiffer.check(old, upd)).toBe(false)
  })

  it('BY_PERCENTAGE: does NOT flag when shares unchanged (same %)', () => {
    const old = makeExpense({
      paidBySplitMode: 'BY_PERCENTAGE',
      paidByList: [
        { participant: 'lp-alice', shares: 5000 },
        { participant: 'lp-bob', shares: 5000 },
      ],
    })
    const upd = makeExpense({
      paidBySplitMode: 'BY_PERCENTAGE',
      paidByList: [
        { participant: 'lp-alice', shares: 5000 },
        { participant: 'lp-bob', shares: 5000 },
      ],
    })
    expect(payersDiffer.check(old, upd)).toBe(false)
  })

  it('BY_PERCENTAGE: flags when percentage splits change', () => {
    const old = makeExpense({
      paidBySplitMode: 'BY_PERCENTAGE',
      paidByList: [
        { participant: 'lp-alice', shares: 7000 },
        { participant: 'lp-bob', shares: 3000 },
      ],
    })
    const upd = makeExpense({
      paidBySplitMode: 'BY_PERCENTAGE',
      paidByList: [
        { participant: 'lp-alice', shares: 5000 },
        { participant: 'lp-bob', shares: 5000 },
      ],
    })
    expect(payersDiffer.check(old, upd)).toBe(true)
  })

  it('BY_SHARES: flags when shares change', () => {
    const old = makeExpense({
      paidBySplitMode: 'BY_SHARES',
      paidByList: [
        { participant: 'lp-alice', shares: 1 },
        { participant: 'lp-bob', shares: 1 },
      ],
    })
    const upd = makeExpense({
      paidBySplitMode: 'BY_SHARES',
      paidByList: [
        { participant: 'lp-alice', shares: 2 },
        { participant: 'lp-bob', shares: 1 },
      ],
    })
    expect(payersDiffer.check(old, upd)).toBe(true)
  })

  it('diff returns null when payers are identical', () => {
    expect(
      payersDiffer.diff(
        makeExpense({
          paidByList: [{ participant: 'lp-alice', shares: 4500 }],
        }),
        makeExpense({
          paidByList: [{ participant: 'lp-alice', shares: 4500 }],
        }),
        ctx,
      ),
    ).toBeNull()
  })

  it('diff formats before/after with participant names', () => {
    const result = payersDiffer.diff(
      makeExpense({ paidByList: [{ participant: 'lp-alice', shares: 4500 }] }),
      makeExpense({ paidByList: [{ participant: 'lp-bob', shares: 4500 }] }),
      ctx,
    )
    expect(result).toEqual({ field: 'payers', before: 'Alice', after: 'Bob' })
  })

  it('field is "payers"', () => {
    expect(payersDiffer.field).toBe('payers')
  })
})
