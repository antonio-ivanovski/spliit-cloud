import { describe, expect, it } from 'vitest'

import { enforceCurrencyPattern, localizeCurrencyInput } from './currency-input'

describe('enforceCurrencyPattern (shared sanitizer)', () => {
  it('sanitizes separators and truncates decimals', () => {
    expect(enforceCurrencyPattern('1.234,56')).toBe('1234.56')
    expect(enforceCurrencyPattern('1.23456', 2)).toBe('1.23')
    expect(enforceCurrencyPattern('1.5', 0)).toBe('1')
  })

  it('does not canonicalize leading zeros — budgets and the currency converter keep the raw typed digits', () => {
    expect(enforceCurrencyPattern('004')).toBe('004')
    expect(enforceCurrencyPattern('00.5')).toBe('00.5')
    expect(enforceCurrencyPattern('0000')).toBe('0000')
  })

  it('accepts native locale digits and separators', () => {
    expect(enforceCurrencyPattern('١٬٢٣٤٫٥٦', 2, 'ar-SA')).toBe('1234.56')
    expect(enforceCurrencyPattern('1 234,56', 2, 'fr-FR')).toBe('1234.56')
    expect(enforceCurrencyPattern('12,34,567.89', 2, 'hi-IN')).toBe(
      '1234567.89',
    )
    expect(enforceCurrencyPattern('12,34,567', 2, 'hi-IN')).toBe('1234567')
  })

  it('keeps the editing string localized while canonical state remains ASCII', () => {
    expect(localizeCurrencyInput('1.50', 'de-DE')).toBe('1,50')
    expect(localizeCurrencyInput('1.', 'de-DE')).toBe('1,')
    expect(localizeCurrencyInput('1234.50', 'ar-SA')).toBe('١٢٣٤٫٥٠')
    expect(enforceCurrencyPattern('١٢٣٤٫٥٠', 2, 'ar-SA')).toBe('1234.50')
  })
})
