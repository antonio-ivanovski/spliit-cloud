import { buildImportExpenses } from '@/app/groups/import/import-wizard-state'
import { describe, expect, it } from 'vitest'

describe('buildImportExpenses', () => {
  it('uses ledger amount when originalAmount is not set (same-currency import)', () => {
    const expenses = buildImportExpenses([
      {
        paidBy: 'lp-1',
        amount: 5000,
      } as any,
    ])

    expect(expenses[0].paidByList).toEqual([
      { participant: 'lp-1', shares: 5000 },
    ])
    expect(expenses[0].paidBySplitMode).toBe('BY_AMOUNT')
  })

  it('uses originalAmount when originalCurrency is set (cross-currency import)', () => {
    const expenses = buildImportExpenses([
      {
        paidBy: 'lp-1',
        amount: 4600, // ledger-currency (EUR) cents
        originalAmount: 5000, // original-currency (USD) cents
        originalCurrency: 'USD',
      } as any,
    ])

    expect(expenses[0].paidByList).toEqual([
      { participant: 'lp-1', shares: 5000 },
    ])
    expect(expenses[0].paidBySplitMode).toBe('BY_AMOUNT')
  })

  it('preserves all other batch expense fields', () => {
    const expenses = buildImportExpenses([
      {
        paidBy: 'lp-1',
        amount: 5000,
        originalAmount: 5000,
        originalCurrency: 'USD',
        title: 'Dinner',
        splitMode: 'EVENLY',
        isReimbursement: false,
      } as any,
    ])

    expect(expenses[0]).toMatchObject({
      title: 'Dinner',
      splitMode: 'EVENLY',
      isReimbursement: false,
      originalAmount: 5000,
      originalCurrency: 'USD',
    })
  })
})
