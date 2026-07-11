import { describe, expect, it } from 'vitest'
import {
  enforceCurrencyPattern,
  enforceIntegerPattern,
  enforcePercentagePattern,
  formatDate,
  parseCurrencyPaste,
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

describe('formatDate', () => {
  it('returns ISO date string from a Date', () => {
    const result = formatDate(new Date('2025-06-15T12:00:00.000Z'))
    expect(result).toBe('2025-06-15')
  })
})
