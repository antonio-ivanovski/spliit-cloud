import type { Expense } from '@spliit/domain'
import { describe, expect, it } from 'vitest'
import { recurrenceDiffer } from './recurrence.differ'

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

describe('recurrenceDiffer', () => {
  it('check returns false for identical rules', () => {
    expect(
      recurrenceDiffer.check(
        makeExpense({ recurrenceRule: 'NONE' }),
        makeExpense({ recurrenceRule: 'NONE' }),
      ),
    ).toBe(false)
  })

  it('check returns true for different rules', () => {
    expect(
      recurrenceDiffer.check(
        makeExpense({ recurrenceRule: 'NONE' }),
        makeExpense({ recurrenceRule: 'WEEKLY' }),
      ),
    ).toBe(true)
  })

  it('diff returns null for identical rules', () => {
    expect(
      recurrenceDiffer.diff(
        makeExpense({ recurrenceRule: 'NONE' }),
        makeExpense({ recurrenceRule: 'NONE' }),
        {} as any,
      ),
    ).toBeNull()
  })

  it('diff maps NONE → "Not recurring"', () => {
    const result = recurrenceDiffer.diff(
      makeExpense({ recurrenceRule: 'NONE' }),
      makeExpense({ recurrenceRule: 'WEEKLY' }),
      {} as any,
    )
    expect(result).toEqual({
      field: 'recurrence',
      before: 'Not recurring',
      after: 'Weekly',
    })
  })

  it('diff maps DAILY → "Daily"', () => {
    const result = recurrenceDiffer.diff(
      makeExpense({ recurrenceRule: 'NONE' }),
      makeExpense({ recurrenceRule: 'DAILY' }),
      {} as any,
    )
    expect(result!.after).toBe('Daily')
  })

  it('diff maps MONTHLY → "Monthly"', () => {
    const result = recurrenceDiffer.diff(
      makeExpense({ recurrenceRule: 'NONE' }),
      makeExpense({ recurrenceRule: 'MONTHLY' }),
      {} as any,
    )
    expect(result!.after).toBe('Monthly')
  })

  it('diff returns raw string for unknown recurrence values', () => {
    const result = recurrenceDiffer.diff(
      makeExpense({ recurrenceRule: 'NONE' }),
      makeExpense({ recurrenceRule: 'HOURLY' }),
      {} as any,
    )
    expect(result!.after).toBe('HOURLY')
  })

  it('field is "recurrence"', () => {
    expect(recurrenceDiffer.field).toBe('recurrence')
  })
})
