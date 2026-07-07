import type { Expense } from '@spliit/domain'
import { describe, expect, it } from 'vitest'
import { reimbursementDiffer } from './reimbursement.differ'
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
    isReimbursement: false,
    documents: [],
    recurrenceRule: 'NONE',
    ...overrides,
  } as Expense
}

const ctx: ChangeContext = {
  getParticipantName: (id) => id,
  getCategoryName: (id) => id,
  formatCurrencyCents: (c, cur) => `${cur ?? 'EUR'} ${c / 100}`,
  ledgerCurrencyCode: 'EUR',
}

describe('reimbursementDiffer', () => {
  it('check returns false for identical values', () => {
    expect(
      reimbursementDiffer.check(
        makeExpense({ isReimbursement: false }),
        makeExpense({ isReimbursement: false }),
      ),
    ).toBe(false)

    expect(
      reimbursementDiffer.check(
        makeExpense({ isReimbursement: true }),
        makeExpense({ isReimbursement: true }),
      ),
    ).toBe(false)
  })

  it('check returns true when toggled on', () => {
    expect(
      reimbursementDiffer.check(
        makeExpense({ isReimbursement: false }),
        makeExpense({ isReimbursement: true }),
      ),
    ).toBe(true)
  })

  it('check returns true when toggled off', () => {
    expect(
      reimbursementDiffer.check(
        makeExpense({ isReimbursement: true }),
        makeExpense({ isReimbursement: false }),
      ),
    ).toBe(true)
  })

  it('diff returns null for identical values', () => {
    expect(
      reimbursementDiffer.diff(
        makeExpense({ isReimbursement: false }),
        makeExpense({ isReimbursement: false }),
        ctx,
      ),
    ).toBeNull()
  })

  it('diff labels toggling on as "Expense" → "Reimbursement"', () => {
    const result = reimbursementDiffer.diff(
      makeExpense({ isReimbursement: false }),
      makeExpense({ isReimbursement: true }),
      ctx,
    )
    expect(result).toEqual({
      field: 'reimbursement',
      before: 'Expense',
      after: 'Reimbursement',
    })
  })

  it('diff labels toggling off as "Reimbursement" → "Expense"', () => {
    const result = reimbursementDiffer.diff(
      makeExpense({ isReimbursement: true }),
      makeExpense({ isReimbursement: false }),
      ctx,
    )
    expect(result).toEqual({
      field: 'reimbursement',
      before: 'Reimbursement',
      after: 'Expense',
    })
  })

  it('field is "reimbursement"', () => {
    expect(reimbursementDiffer.field).toBe('reimbursement')
  })
})
