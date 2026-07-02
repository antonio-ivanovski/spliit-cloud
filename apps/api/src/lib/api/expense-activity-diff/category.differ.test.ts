import type { Expense } from '@spliit/domain'
import { describe, expect, it } from 'vitest'
import { categoryDiffer } from './category.differ'
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
  getParticipantName: (id) => id,
  getCategoryName: (id) => {
    const cats: Record<string, string> = {
      general: 'General',
      groceries: 'Groceries',
    }
    return cats[id] ?? id
  },
  formatCurrencyCents: (c, cur) => `${cur ?? 'EUR'} ${c / 100}`,
}

describe('categoryDiffer', () => {
  it('check returns false for identical categories', () => {
    expect(
      categoryDiffer.check(
        makeExpense({ category: 'general' }),
        makeExpense({ category: 'general' }),
      ),
    ).toBe(false)
  })

  it('check returns true for different categories', () => {
    expect(
      categoryDiffer.check(
        makeExpense({ category: 'general' }),
        makeExpense({ category: 'groceries' }),
      ),
    ).toBe(true)
  })

  it('diff returns null for identical categories', () => {
    expect(
      categoryDiffer.diff(
        makeExpense({ category: 'general' }),
        makeExpense({ category: 'general' }),
        ctx,
      ),
    ).toBeNull()
  })

  it('diff formats before/after with category names', () => {
    const result = categoryDiffer.diff(
      makeExpense({ category: 'general' }),
      makeExpense({ category: 'groceries' }),
      ctx,
    )
    expect(result).toEqual({
      field: 'category',
      before: 'General',
      after: 'Groceries',
    })
  })

  it('diff falls back to raw id for unknown categories', () => {
    const result = categoryDiffer.diff(
      makeExpense({ category: 'general' }),
      makeExpense({ category: 'unknown-cat' }),
      ctx,
    )
    expect(result).toEqual({
      field: 'category',
      before: 'General',
      after: 'unknown-cat',
    })
  })

  it('field is "category"', () => {
    expect(categoryDiffer.field).toBe('category')
  })
})
