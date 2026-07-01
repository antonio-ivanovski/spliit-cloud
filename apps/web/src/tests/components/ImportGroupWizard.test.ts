import { buildImportExpenses } from '@/app/groups/import/import-wizard-state'
import { describe, expect, it } from 'vitest'

describe('buildImportExpenses', () => {
  it('passes through expenses with paidByList and paidBySplitMode unchanged', () => {
    const input = [
      {
        paidByList: [{ participant: 'lp-1', shares: 5000 }],
        paidBySplitMode: 'BY_AMOUNT' as const,
        amount: 5000,
        title: 'Dinner',
        splitMode: 'EVENLY',
      },
    ]
    const expenses = buildImportExpenses(input)

    expect(expenses[0].paidByList).toEqual([
      { participant: 'lp-1', shares: 5000 },
    ])
    expect(expenses[0].paidBySplitMode).toBe('BY_AMOUNT')
  })

  it('passes through with originalAmount/originalCurrency when already set', () => {
    const input = [
      {
        paidByList: [{ participant: 'lp-1', shares: 5000 }],
        paidBySplitMode: 'BY_AMOUNT' as const,
        amount: 4600,
        originalAmount: 5000,
        originalCurrency: 'USD',
        title: 'Dinner',
      },
    ]
    const expenses = buildImportExpenses(input)

    expect(expenses[0].paidByList).toEqual([
      { participant: 'lp-1', shares: 5000 },
    ])
    expect(expenses[0].paidBySplitMode).toBe('BY_AMOUNT')
    expect(expenses[0].originalAmount).toBe(5000)
    expect(expenses[0].originalCurrency).toBe('USD')
  })

  it('preserves all other batch expense fields', () => {
    const input = [
      {
        paidByList: [{ participant: 'lp-1', shares: 5000 }],
        paidBySplitMode: 'BY_AMOUNT' as const,
        amount: 5000,
        originalAmount: 5000,
        originalCurrency: 'USD',
        title: 'Dinner',
        splitMode: 'EVENLY',
        isReimbursement: false,
      },
    ]
    const expenses = buildImportExpenses(input)

    expect(expenses[0]).toMatchObject({
      title: 'Dinner',
      splitMode: 'EVENLY',
      isReimbursement: false,
      originalAmount: 5000,
      originalCurrency: 'USD',
    })
  })
})
