import {
  formatCurrency,
  formatDateOnly,
  amountAsDecimal,
  amountAsMinorUnits,
  getCurrencyFromGroup,
} from '@/lib/utils'
import type { Currency } from '@spliit/domain/currency'
import { describe, it, expect } from 'vitest'

// ── Fixtures ───────────────────────────────────────────────────────────

const eur: Currency = {
  code: 'EUR',
  symbol: '€',
  rounding: 0,
  decimal_digits: 2,
}

const usd: Currency = {
  code: 'USD',
  symbol: '$',
  rounding: 0,
  decimal_digits: 2,
}

const jpy: Currency = {
  code: 'JPY',
  symbol: '¥',
  rounding: 0,
  decimal_digits: 0,
}

const custom: Currency = {
  code: '',
  symbol: 'CUR',
  rounding: 0,
  decimal_digits: 2,
}

// ── formatCurrency ─────────────────────────────────────────────────────

describe('formatCurrency', () => {
  it('formats EUR in en-US locale', () => {
    // 100 cents = €1.00
    const result = formatCurrency(eur, 100, 'en-US')
    expect(result).toBe('€1.00')
  })

  it('formats USD in en-US locale with comma separators', () => {
    const result = formatCurrency(usd, 123456, 'en-US')
    expect(result).toBe('$1,234.56')
  })

  it('formats EUR in de-DE locale', () => {
    // de-DE places the symbol after the amount with a non-breaking space
    const result = formatCurrency(eur, 123, 'de-DE')
    expect(result).toContain('1,23')
    expect(result).toContain('€')
  })

  it('uses fractions parameter when fractions=true', () => {
    // When fractions=true, amount is already in major units (e.g. 1.23)
    const result = formatCurrency(eur, 1.23, 'en-US', true)
    expect(result).toBe('€1.23')
  })

  it('formats zero-decimal currency (JPY)', () => {
    const result = formatCurrency(jpy, 1000, 'en-US')
    expect(result).toBe('¥1,000')
    expect(result).not.toContain('.')
  })

  it('supports custom currency symbol when currency code is empty', () => {
    const result = formatCurrency(custom, 123, 'en-US')
    expect(result).toContain('CUR')
    expect(result).toContain('1.23')
  })
})

// ── formatDateOnly ─────────────────────────────────────────────────────

describe('formatDateOnly', () => {
  it('formats a date in en-US with medium dateStyle', () => {
    const date = new Date('2025-10-17T00:00:00.000Z')
    const result = formatDateOnly(date, 'en-US', { dateStyle: 'medium' })
    expect(result).toContain('Oct')
    expect(result).toContain('17')
    expect(result).toContain('2025')
  })

  it('formats a date in fr-FR with medium dateStyle', () => {
    const date = new Date('2025-10-17T00:00:00.000Z')
    const result = formatDateOnly(date, 'fr-FR', { dateStyle: 'medium' })
    expect(result).toContain('2025')
    expect(result).toContain('17')
  })

  it('formats with long dateStyle', () => {
    const date = new Date('2025-03-31T00:00:00.000Z')
    const result = formatDateOnly(date, 'en-US', { dateStyle: 'long' })
    expect(result).toContain('March')
    expect(result).toContain('31')
    expect(result).toContain('2025')
  })

  it('avoids timezone off-by-one for DATE fields', () => {
    // Database DATE values arrive as UTC midnight
    const date = new Date('2025-10-17T00:00:00.000Z')
    const result = formatDateOnly(date, 'en-US', { dateStyle: 'medium' })
    // Should show 17, not 16 (which would happen with timezone shift)
    expect(result).toContain('17')
  })
})

// ── amountAsDecimal ────────────────────────────────────────────────────

describe('amountAsDecimal', () => {
  it('converts cents to decimal string', () => {
    expect(amountAsDecimal(100, eur)).toBe(1)
    expect(amountAsDecimal(150, eur)).toBe(1.5)
    expect(amountAsDecimal(1234, usd)).toBe(12.34)
    expect(amountAsDecimal(5, usd)).toBe(0.05)
  })

  it('handles zero-decimal currencies', () => {
    expect(amountAsDecimal(1000, jpy)).toBe(1000)
    expect(amountAsDecimal(500, jpy)).toBe(500)
  })

  it('rounds when round=true', () => {
    expect(amountAsDecimal(156, eur, true)).toBe(1.56)
  })
})

// ── amountAsMinorUnits ─────────────────────────────────────────────────

describe('amountAsMinorUnits', () => {
  it('converts decimal to cents', () => {
    expect(amountAsMinorUnits(1, eur)).toBe(100)
    expect(amountAsMinorUnits(1.5, eur)).toBe(150)
    expect(amountAsMinorUnits(12.34, usd)).toBe(1234)
    expect(amountAsMinorUnits(0.05, usd)).toBe(5)
  })

  it('handles zero-decimal currencies', () => {
    expect(amountAsMinorUnits(1000, jpy)).toBe(1000)
    expect(amountAsMinorUnits(500, jpy)).toBe(500)
  })
})

// ── getCurrencyFromGroup ────────────────────────────────────────────────

describe('getCurrencyFromGroup', () => {
  it('extracts currency from group with known currencyCode', () => {
    const group = { currency: '$', currencyCode: 'USD' }
    const result = getCurrencyFromGroup(group)
    expect(result.code).toBe('USD')
    expect(result.symbol).toBe('$')
    expect(result.decimal_digits).toBe(2)
  })

  it('returns custom currency when currencyCode is null', () => {
    const group = { currency: 'MyCoin', currencyCode: null }
    const result = getCurrencyFromGroup(group)
    expect(result.code).toBe('')
    expect(result.symbol).toBe('MyCoin')
    expect(result.decimal_digits).toBe(2)
  })

  it('returns custom currency when currencyCode is undefined', () => {
    const group = { currency: 'CUR' }
    const result = getCurrencyFromGroup(group)
    expect(result.code).toBe('')
    expect(result.symbol).toBe('CUR')
  })
})
