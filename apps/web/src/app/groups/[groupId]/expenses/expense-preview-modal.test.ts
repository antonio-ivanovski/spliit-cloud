import { describe, expect, it } from 'vitest'

import { expenseShareRatioLabel } from './expense-share-ratio-label'

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
