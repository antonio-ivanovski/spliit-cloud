import { describe, expect, it } from 'vitest'

import { MAX_DISPLAY_SHARES } from '@spliit/domain'

import {
  enforceCurrencyPattern,
  enforceIntegerPattern,
  enforcePercentagePattern,
  enforceSharePattern,
  formatDate,
  nextShareRowsFromInput,
  parseCurrencyPaste,
  stepDisplayShares,
} from './currency-utils'

const currencies = [
  { code: 'USD', symbol: '$' },
  { code: 'CAD', symbol: '$' },
  { code: 'EUR', symbol: '€' },
  { code: 'GBP', symbol: '£' },
  { code: 'JPY', symbol: '¥' },
]

describe('parseCurrencyPaste', () => {
  it.each([
    ['-$1,659.84', '1659.84', 'USD'],
    ['-€1.659,84', '1659.84', 'EUR'],
    ['1,234,567.89', '1234567.89', undefined],
    ['1.234.567,89', '1234567.89', undefined],
    ['1,234', '1234', undefined],
  ])('parses %s', (input, amount, currencyCode) => {
    expect(parseCurrencyPaste(input, currencies)).toEqual({
      amount,
      ...(currencyCode ? { currencyCode } : {}),
    })
  })

  it('recognizes explicit ISO codes and suffixes', () => {
    expect(parseCurrencyPaste('USD 1,659.84', currencies)).toEqual({
      amount: '1659.84',
      currencyCode: 'USD',
    })
    expect(parseCurrencyPaste('1.659,84 EUR', currencies)).toEqual({
      amount: '1659.84',
      currencyCode: 'EUR',
    })
  })

  it('supports accounting parentheses and grouping spaces', () => {
    expect(parseCurrencyPaste('(€ 1\u00a0659,84)', currencies)).toEqual({
      amount: '1659.84',
      currencyCode: 'EUR',
    })
  })

  it('rejects malformed or competing values', () => {
    expect(parseCurrencyPaste('total 12 and 34', currencies)).toBeNull()
    expect(parseCurrencyPaste('$1,234)', currencies)).toBeNull()
  })
})

describe('enforceCurrencyPattern', () => {
  it('passes through simple integer', () => {
    expect(enforceCurrencyPattern('10')).toBe('10')
  })

  it('preserves decimal with dot', () => {
    expect(enforceCurrencyPattern('1.5')).toBe('1.5')
  })

  it('normalizes comma to dot', () => {
    expect(enforceCurrencyPattern('1,5')).toBe('1.5')
  })

  it('handles European thousands separator', () => {
    expect(enforceCurrencyPattern('1.234,56')).toBe('1.23456')
  })

  it('preserves leading minus', () => {
    expect(enforceCurrencyPattern('-10')).toBe('-10')
  })

  it('strips non-numeric characters', () => {
    expect(enforceCurrencyPattern('abc123')).toBe('123')
  })

  it('keeps only first decimal point', () => {
    expect(enforceCurrencyPattern('1.2.3')).toBe('1.23')
  })

  it('returns empty string unchanged', () => {
    expect(enforceCurrencyPattern('')).toBe('')
  })
})

describe('enforcePercentagePattern', () => {
  it('passes through simple integer', () => {
    expect(enforcePercentagePattern('25')).toBe('25')
  })

  it('preserves one decimal place', () => {
    expect(enforcePercentagePattern('25.5')).toBe('25.5')
  })

  it('truncates to two decimal places', () => {
    expect(enforcePercentagePattern('25.555')).toBe('25.55')
  })

  it('normalizes comma to dot', () => {
    expect(enforcePercentagePattern('100,00')).toBe('100.00')
  })

  it('preserves leading minus', () => {
    expect(enforcePercentagePattern('-5')).toBe('-5')
  })

  it('strips non-numeric characters', () => {
    expect(enforcePercentagePattern('abc25')).toBe('')
  })

  it('returns empty string unchanged', () => {
    expect(enforcePercentagePattern('')).toBe('')
  })

  it('truncates long decimals', () => {
    expect(enforcePercentagePattern('100.123456')).toBe('100.12')
  })

  it('preserves exactly two decimals', () => {
    expect(enforcePercentagePattern('33.34')).toBe('33.34')
  })
})

describe('enforceIntegerPattern', () => {
  it('passes through simple digit', () => {
    expect(enforceIntegerPattern('5')).toBe('5')
  })

  it('passes through multi-digit integer', () => {
    expect(enforceIntegerPattern('100')).toBe('100')
  })

  it('returns empty string unchanged', () => {
    expect(enforceIntegerPattern('')).toBe('')
  })

  it('strips letters', () => {
    expect(enforceIntegerPattern('abc123')).toBe('123')
  })

  it('strips decimal point', () => {
    expect(enforceIntegerPattern('1.5')).toBe('15')
  })

  it('strips minus sign', () => {
    expect(enforceIntegerPattern('-5')).toBe('5')
  })

  it('strips exponent letter', () => {
    expect(enforceIntegerPattern('1e5')).toBe('15')
  })
})

describe('enforceSharePattern', () => {
  it('accepts whole share values unchanged', () => {
    expect(enforceSharePattern('1')).toBe('1')
    expect(enforceSharePattern('25')).toBe('25')
  })

  it('accepts up to two decimal places', () => {
    expect(enforceSharePattern('0.5')).toBe('0.5')
    expect(enforceSharePattern('1.1')).toBe('1.1')
    expect(enforceSharePattern('25.75')).toBe('25.75')
  })

  it('preserves a trailing dot so the user can finish typing', () => {
    expect(enforceSharePattern('1.')).toBe('1.')
    expect(enforceSharePattern('0.')).toBe('0.')
  })

  it('truncates to two decimal places', () => {
    expect(enforceSharePattern('0.123')).toBe('0.12')
    expect(enforceSharePattern('25.999')).toBe('25.99')
  })

  it('normalizes comma separators to dot', () => {
    expect(enforceSharePattern('1,5')).toBe('1.5')
  })

  it('strips letters and other non-numeric characters', () => {
    expect(enforceSharePattern('abc123')).toBe('123')
    expect(enforceSharePattern('1e5')).toBe('15')
  })

  it('normalizes a leading separator to 0.5 so sequential typing from empty stays complete', () => {
    expect(enforceSharePattern('.5')).toBe('0.5')
    expect(enforceSharePattern('.05')).toBe('0.05')
  })

  it('returns empty string unchanged', () => {
    expect(enforceSharePattern('')).toBe('')
  })

  it('keeps only the first separator in the fractional part', () => {
    expect(enforceSharePattern('1.2.3')).toBe('1.23')
  })
})

describe('enforceSharePattern canonicalizes leading zeros', () => {
  it.each([
    ['0', '0'],
    ['00', '0'],
    ['00000', '0'],
    ['04', '4'],
    ['004', '4'],
    ['00000.1', '0.1'],
    ['000.10', '0.10'],
    ['.5', '0.5'],
    ['0.', '0.'],
    ['-004', '-4'],
    ['', ''],
  ])('%s -> %s', (input, expected) => {
    expect(enforceSharePattern(input)).toBe(expected)
  })
})

describe('stepDisplayShares', () => {
  it.each([
    [undefined, 1, 1, 'plus from an empty row selects the participant at 1'],
    ['0', 1, 1, 'plus from zero selects at 1'],
    ['0.5', 1, 0.6, '0.5 + -> 0.6'],
    ['0.6', -1, 0.5, '0.6 - -> 0.5'],
    ['0.9', 1, 1, '0.9 + -> 1'],
    ['1.1', 1, 1.2, '1.1 + -> 1.2'],
    ['1.5', 1, 1.6, '1.5 + -> 1.6 (fractional values step by 0.1)'],
    ['1.5', -1, 1.4, '1.5 - -> 1.4'],
    ['2.75', 1, 2.85, '2.75 + -> 2.85'],
    ['1.9', 1, 2, '1.9 + -> 2'],
    [1, 1, 2, 'whole value steps by 1'],
    ['1.0', 1, 2, 'numerically whole 1.0 steps by 1'],
    ['2', 1, 3, '2 + -> 3'],
    ['0.1', -1, 0, 'decrement to zero'],
    [
      MAX_DISPLAY_SHARES,
      1,
      MAX_DISPLAY_SHARES,
      'increase clamps at the maximum',
    ],
    [0.05, -1, 0, '0.05 - -> 0 (fractional values step by 0.1)'],
  ])('%s %s %s (%s)', (value, direction, expected, _description) => {
    expect(stepDisplayShares(value, direction as 1 | -1)).toBe(expected)
  })
})

describe('nextShareRowsFromInput', () => {
  const rows = [
    { participant: 'lp-1', shares: '1' },
    { participant: 'lp-2', shares: '1' },
  ]

  it('preserves every non-empty sanitized string, including "0"', () => {
    expect(nextShareRowsFromInput(rows, 'lp-1', '0')).toEqual([
      { participant: 'lp-2', shares: '1' },
      { participant: 'lp-1', shares: '0' },
    ])
    expect(nextShareRowsFromInput(rows, 'lp-1', '0.')).toEqual([
      { participant: 'lp-2', shares: '1' },
      { participant: 'lp-1', shares: '0.' },
    ])
    expect(nextShareRowsFromInput(rows, 'lp-1', '0.5')).toEqual([
      { participant: 'lp-2', shares: '1' },
      { participant: 'lp-1', shares: '0.5' },
    ])
  })

  it('keeps an already-empty participant out of the list', () => {
    const withoutLp1 = rows.filter((row) => row.participant !== 'lp-1')
    expect(nextShareRowsFromInput(withoutLp1, 'lp-1', '')).toEqual(withoutLp1)
  })

  it('removes the row when the value is explicitly cleared', () => {
    expect(nextShareRowsFromInput(rows, 'lp-1', '')).toEqual([
      { participant: 'lp-2', shares: '1' },
    ])
  })

  it('leaves unrelated rows untouched', () => {
    const result = nextShareRowsFromInput(rows, 'lp-1', '0.5')
    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({ participant: 'lp-2', shares: '1' })
  })
})

describe('formatDate', () => {
  it('returns ISO date string from a Date', () => {
    const result = formatDate(new Date('2025-06-15T12:00:00.000Z'))
    expect(result).toBe('2025-06-15')
  })
})
