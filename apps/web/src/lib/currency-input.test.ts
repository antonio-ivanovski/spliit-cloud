import { describe, expect, it } from 'vitest'

import { enforceCurrencyPattern } from './currency-input'

describe('enforceCurrencyPattern (shared sanitizer)', () => {
  it('sanitizes separators and truncates decimals', () => {
    expect(enforceCurrencyPattern('1.234,56')).toBe('1.23456')
    expect(enforceCurrencyPattern('1.23456', 2)).toBe('1.23')
    expect(enforceCurrencyPattern('1.5', 0)).toBe('1')
  })

  it('does not canonicalize leading zeros — budgets and the currency converter keep the raw typed digits', () => {
    expect(enforceCurrencyPattern('004')).toBe('004')
    expect(enforceCurrencyPattern('00.5')).toBe('00.5')
    expect(enforceCurrencyPattern('0000')).toBe('0000')
  })
})
