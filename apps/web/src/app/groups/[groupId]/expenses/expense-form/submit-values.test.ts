import type { ExpenseFormInputValues } from '@spliit/domain'
import { getCurrency } from '@spliit/domain'
import { describe, expect, it } from 'vitest'
import { buildSubmitValues } from './submit-values'

const baseValues: ExpenseFormInputValues = {
  expenseDate: new Date('2026-06-30T10:45:49.956Z'),
  title: 'Receipt',
  category: 'general',
  amount: 150,
  originalCurrency: 'ARS',
  conversionRate: 0.00059,
  paidBySplitMode: 'BY_AMOUNT',
  paidByList: [{ participant: 'p1', shares: 15000 }],
  splitMode: 'ITEMIZED',
  paidFor: [
    { participant: 'p1', shares: 1 },
    { participant: 'p2', shares: 1 },
  ],
  isMultiPayer: false,
  saveDefaultSplittingOptions: true,
  isReimbursement: false,
  documents: [],
  notes: '',
  recurrenceRule: 'NONE',
  items: [
    {
      id: 'beer',
      title: 'beer',
      unitPrice: 10,
      quantity: 10,
      splitMode: 'BY_PERCENTAGE',
      paidFor: [
        { participant: 'p1', shares: 50 },
        { participant: 'p2', shares: 50 },
      ],
    },
    {
      id: 'pizza',
      title: 'pizza',
      unitPrice: 10,
      quantity: 2,
      splitMode: 'BY_SHARES',
      paidFor: [
        { participant: 'p1', shares: 2 },
        { participant: 'p2', shares: 1 },
      ],
    },
    {
      id: 'third',
      title: 'third',
      unitPrice: 30,
      quantity: 1,
      splitMode: 'EVENLY',
      paidFor: [
        { participant: 'p1', shares: 1 },
        { participant: 'p2', shares: 1 },
      ],
    },
  ],
  itemizedRemainder: {
    splitMode: 'BY_SHARES',
    paidFor: [
      { participant: 'p1', shares: 1 },
      { participant: 'p2', shares: 2 },
    ],
  },
}

describe('buildSubmitValues', () => {
  it('keeps itemized item totals in the selected expense currency', () => {
    const result = buildSubmitValues(baseValues, {
      groupCurrency: getCurrency('USD')!,
      conversionRequired: true,
    })

    expect(result.amount).toBe(9)
    expect(result.originalAmount).toBe(15000)
    expect(result.saveDefaultSplittingOptions).toBe(false)
    expect(result.items?.map((item) => item.amount)).toEqual([
      10000, 2000, 3000,
    ])
    expect(result.items?.map((item) => item.unitPrice)).toEqual([
      1000, 1000, 3000,
    ])
    expect(result.items?.every((item) => item.unitPrice > 0)).toBe(true)
    expect(result.items?.reduce((sum, item) => sum + item.amount, 0)).toBe(
      result.originalAmount,
    )
  })

  it('clears stale conversion metadata when conversion is not required', () => {
    const result = buildSubmitValues(baseValues, {
      groupCurrency: getCurrency('ARS')!,
      conversionRequired: false,
    })

    expect(result.originalAmount).toBeUndefined()
    expect(result.originalCurrency).toBeUndefined()
    expect(result.conversionRate).toBeUndefined()
  })

  it('rejects converted expenses without a positive conversion rate', () => {
    expect(() =>
      buildSubmitValues(
        { ...baseValues, conversionRate: undefined },
        {
          groupCurrency: getCurrency('USD')!,
          conversionRequired: true,
        },
      ),
    ).toThrow('A positive conversion rate is required.')
  })
})
