import type { Expense } from '@spliit/domain'
import { describe, expect, it } from 'vitest'
import { dateDiffer } from './date.differ'

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

describe('dateDiffer', () => {
  it('check returns false for identical dates', () => {
    expect(
      dateDiffer.check(
        makeExpense({ expenseDate: new Date('2026-01-01') }),
        makeExpense({ expenseDate: new Date('2026-01-01') }),
      ),
    ).toBe(false)
  })

  it('check returns true for different dates', () => {
    expect(
      dateDiffer.check(
        makeExpense({ expenseDate: new Date('2026-01-01') }),
        makeExpense({ expenseDate: new Date('2026-01-02') }),
      ),
    ).toBe(true)
  })

  it('check treats Date and ISO-string of same instant as identical', () => {
    expect(
      dateDiffer.check(
        makeExpense({ expenseDate: new Date('2026-01-01T00:00:00.000Z') }),
        makeExpense({
          expenseDate: '2026-01-01T00:00:00.000Z' as unknown as Date,
        }),
      ),
    ).toBe(false)
  })

  it('check handles year-rollover', () => {
    expect(
      dateDiffer.check(
        makeExpense({ expenseDate: new Date('2026-12-31T00:00:00Z') }),
        makeExpense({ expenseDate: new Date('2027-01-01T00:00:00Z') }),
      ),
    ).toBe(true)
  })

  it('diff returns null for identical dates', () => {
    expect(dateDiffer.diff(makeExpense(), makeExpense(), {} as any)).toBeNull()
  })

  it('diff formats before/after as ISO date strings', () => {
    const result = dateDiffer.diff(
      makeExpense({ expenseDate: new Date('2026-01-15T00:00:00Z') }),
      makeExpense({ expenseDate: new Date('2026-01-16T00:00:00Z') }),
      {} as any,
    )
    expect(result).toEqual({
      field: 'date',
      before: '2026-01-15',
      after: '2026-01-16',
    })
  })

  it('field is "date"', () => {
    expect(dateDiffer.field).toBe('date')
  })
})
