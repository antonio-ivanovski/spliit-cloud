import type { Expense } from '@spliit/domain'
import { describe, expect, it } from 'vitest'
import { titleDiffer } from './title.differ'

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

describe('titleDiffer', () => {
  it('check returns false for identical titles', () => {
    expect(
      titleDiffer.check(
        makeExpense({ title: 'A' }),
        makeExpense({ title: 'A' }),
      ),
    ).toBe(false)
  })

  it('check returns true for different titles', () => {
    expect(
      titleDiffer.check(
        makeExpense({ title: 'A' }),
        makeExpense({ title: 'B' }),
      ),
    ).toBe(true)
  })

  it('diff returns null when titles are identical', () => {
    expect(
      titleDiffer.diff(
        makeExpense({ title: 'Same' }),
        makeExpense({ title: 'Same' }),
        {} as any,
      ),
    ).toBeNull()
  })

  it('diff includes before/after title strings when changed', () => {
    const result = titleDiffer.diff(
      makeExpense({ title: 'Old' }),
      makeExpense({ title: 'New' }),
      {} as any,
    )
    expect(result).toEqual({ field: 'title', before: 'Old', after: 'New' })
  })

  it('field is "title"', () => {
    expect(titleDiffer.field).toBe('title')
  })
})
