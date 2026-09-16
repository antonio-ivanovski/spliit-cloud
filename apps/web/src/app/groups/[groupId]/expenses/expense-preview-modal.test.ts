import { describe, expect, it } from 'vitest'

import { getCurrency } from '@/lib/currency'

import { formatExpenseConversionDetails } from './expense-preview-modal'
import { expenseShareRatioLabel } from './expense-share-ratio-label'

describe('formatExpenseConversionDetails', () => {
  const usd = getCurrency('USD')!

  it.each(['EXCHANGE', 'CUSTOM', 'EXACT'] as const)(
    'formats compact details for %s conversions',
    (conversionSource) => {
      expect(
        formatExpenseConversionDetails(
          {
            originalAmount: 10000,
            originalCurrency: 'EUR',
            conversionRate: 0.9347,
            conversionSource,
          },
          usd,
          'en-US',
        ),
      ).toEqual({
        original: 'EUR 100.00',
        source: 'EUR',
        target: 'USD',
        rate: '0.9347',
      })
    },
  )

  it('formats negative original amounts without changing the positive rate', () => {
    expect(
      formatExpenseConversionDetails(
        {
          originalAmount: -10000,
          originalCurrency: 'EUR',
          conversionRate: 0.9347,
          conversionSource: 'EXACT',
        },
        usd,
        'en-US',
      ),
    ).toMatchObject({ original: 'EUR -100.00', rate: '0.9347' })
  })

  it('keeps the original amount for legacy conversions without a rate', () => {
    expect(
      formatExpenseConversionDetails(
        {
          originalAmount: 100,
          originalCurrency: 'JPY',
          conversionRate: null,
          conversionSource: null,
        },
        usd,
        'en-US',
      ),
    ).toEqual({
      original: 'JPY 100',
      source: 'JPY',
      target: 'USD',
      rate: null,
    })
  })

  it('omits details when the original and group currencies match', () => {
    expect(
      formatExpenseConversionDetails(
        {
          originalAmount: 10000,
          originalCurrency: 'USD',
          conversionRate: 1,
          conversionSource: 'CUSTOM',
        },
        usd,
        'en-US',
      ),
    ).toBeNull()
  })
})

describe('expenseShareRatioLabel', () => {
  const rows = (values: number[]) =>
    values.map((shares, i) => ({
      ledgerParticipantId: `p${i}`,
      shares,
    }))

  it('renders literal unreduced display ratios for BY_SHARES — never 50/200 or 1/4', () => {
    const sourceRows = rows([50, 150])
    expect(expenseShareRatioLabel('BY_SHARES', sourceRows, 'p0')).toBe('0.5/2')
    expect(expenseShareRatioLabel('BY_SHARES', sourceRows, 'p1')).toBe('1.5/2')
  })

  it('renders 1.1/3, 0.9/3 and 1/3 for mixed decimal stored rows', () => {
    const sourceRows = rows([110, 90, 100])
    expect(expenseShareRatioLabel('BY_SHARES', sourceRows, 'p0')).toBe('1.1/3')
    expect(expenseShareRatioLabel('BY_SHARES', sourceRows, 'p1')).toBe('0.9/3')
    expect(expenseShareRatioLabel('BY_SHARES', sourceRows, 'p2')).toBe('1/3')
  })

  it('renders whole stored shares without trailing decimals', () => {
    const sourceRows = rows([100, 100])
    expect(expenseShareRatioLabel('BY_SHARES', sourceRows, 'p0')).toBe('1/2')
    expect(expenseShareRatioLabel('BY_SHARES', sourceRows, 'p1')).toBe('1/2')
  })

  it('keeps EVENLY as 1/N and leaves amount/itemized rows without labels', () => {
    const sourceRows = rows([1, 1, 1])
    expect(expenseShareRatioLabel('EVENLY', sourceRows, 'p0')).toBe('1/3')
    expect(
      expenseShareRatioLabel('BY_AMOUNT', sourceRows, 'p0'),
    ).toBeUndefined()
    expect(expenseShareRatioLabel('ITEMIZED', sourceRows, 'p0')).toBeUndefined()
    expect(expenseShareRatioLabel('BY_SHARES', sourceRows, 'unknown')).toBe(
      undefined,
    )
  })

  it('formats BY_PERCENTAGE basis points as percentages', () => {
    const sourceRows = rows([5000, 5000])
    expect(expenseShareRatioLabel('BY_PERCENTAGE', sourceRows, 'p0')).toBe(
      '50%',
    )
  })
})
