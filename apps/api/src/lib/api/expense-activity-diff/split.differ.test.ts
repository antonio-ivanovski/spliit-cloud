import type { Expense } from '@spliit/domain'
import { describe, expect, it } from 'vitest'
import { splitDiffer } from './split.differ'
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

describe('splitDiffer', () => {
  it('check returns false for identical splits', () => {
    expect(splitDiffer.check(makeExpense(), makeExpense())).toBe(false)
  })

  it('check returns true when paidFor shares change', () => {
    expect(
      splitDiffer.check(
        makeExpense(),
        makeExpense({ paidFor: [{ participant: 'lp-alice', shares: 2 }] }),
      ),
    ).toBe(true)
  })

  it('check returns false for reordered paidFor rows (order-independent)', () => {
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
    expect(splitDiffer.check(a, b)).toBe(false)
  })

  it('check returns true when splitMode changes', () => {
    expect(
      splitDiffer.check(
        makeExpense({ splitMode: 'EVENLY' }),
        makeExpense({ splitMode: 'BY_PERCENTAGE' }),
      ),
    ).toBe(true)
  })

  it('check returns true when itemizedRemainder differs', () => {
    const old = makeExpense({ itemizedRemainder: undefined })
    const upd = makeExpense({
      itemizedRemainder: {
        splitMode: 'EVENLY',
        paidFor: [{ participant: 'lp-alice', shares: 1 }],
      },
    })
    expect(splitDiffer.check(old, upd)).toBe(true)
  })

  it('check returns false when itemizedRemainder is identical', () => {
    const rem = {
      splitMode: 'EVENLY' as const,
      paidFor: [{ participant: 'lp-alice', shares: 1 }],
    }
    expect(
      splitDiffer.check(
        makeExpense({ itemizedRemainder: rem }),
        makeExpense({ itemizedRemainder: rem }),
      ),
    ).toBe(false)
  })

  it('diff returns null for identical splits', () => {
    expect(splitDiffer.diff(makeExpense(), makeExpense(), ctx)).toBeNull()
  })

  it('diff formats EVENLY → BY_PERCENTAGE', () => {
    const result = splitDiffer.diff(
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
    expect(result!.before).toBe('Equal split: Alice, Bob')
    expect(result!.after).toBe('Custom split: Alice 70%, Bob 30%')
  })

  it('field is "split"', () => {
    expect(splitDiffer.field).toBe('split')
  })
})
