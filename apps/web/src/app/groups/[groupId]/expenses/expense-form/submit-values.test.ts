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
  conversionType: 'CUSTOM',
  paidBySplitMode: 'BY_AMOUNT',
  paidByList: [{ participant: 'p1', shares: 15000 }],
  splitMode: 'ITEMIZED',
  paidFor: [
    { participant: 'p1', shares: 1 },
    { participant: 'p2', shares: 1 },
  ],
  isMultiPayer: false,
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

    expect(result.amount).toBe(15000)
    expect(result.conversion).toEqual({
      type: 'custom',
      currency: 'ARS',
      rate: 0.00059,
    })
    expect(result.items?.map((item) => item.amount)).toEqual([
      10000, 2000, 3000,
    ])
    expect(result.items?.map((item) => item.unitPrice)).toEqual([
      1000, 1000, 3000,
    ])
    expect(result.items?.every((item) => item.unitPrice > 0)).toBe(true)
    expect(result.items?.reduce((sum, item) => sum + item.amount, 0)).toBe(
      result.amount,
    )
  })

  it('clears conversion when conversion is not required', () => {
    const result = buildSubmitValues(baseValues, {
      groupCurrency: getCurrency('ARS')!,
      conversionRequired: false,
    })

    expect(result.conversion).toBeUndefined()
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

  // Regression: the form always builds a default `itemizedRemainder`
  // value, but the remainder is only meaningful for ITEMIZED expenses.
  // Sending it through for other split modes used to create orphan DB
  // rows and trip a false-positive activity-log diff on the first edit.
  it('omits itemizedRemainder from the payload for non-ITEMIZED split modes', () => {
    const result = buildSubmitValues(
      { ...baseValues, splitMode: 'EVENLY' as const },
      {
        groupCurrency: getCurrency('USD')!,
        conversionRequired: false,
      },
    )
    expect(result.itemizedRemainder).toBeUndefined()
  })

  it('includes itemizedRemainder in the payload for ITEMIZED split modes', () => {
    const result = buildSubmitValues(baseValues, {
      groupCurrency: getCurrency('USD')!,
      conversionRequired: false,
    })
    expect(result.itemizedRemainder).toEqual({
      splitMode: 'BY_SHARES',
      paidFor: [
        { participant: 'p1', shares: 1 },
        { participant: 'p2', shares: 2 },
      ],
    })
  })
})
