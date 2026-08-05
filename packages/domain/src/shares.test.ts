import {
  formatDisplayShares,
  getDisplayShareErrorKey,
  isValidDisplayShare,
  MAX_DISPLAY_SHARES,
  MAX_STORED_SHARES,
  sharesAsDecimal,
  sharesAsFixedUnits,
  SHARE_DECIMAL_PLACES,
  SHARE_SCALE,
} from './shares'

describe('sharesAsFixedUnits', () => {
  it('round-trips representative display values', () => {
    expect(sharesAsFixedUnits(0.01)).toBe(1)
    expect(sharesAsFixedUnits(0.5)).toBe(50)
    expect(sharesAsFixedUnits(1)).toBe(100)
    expect(sharesAsFixedUnits(1.1)).toBe(110)
    expect(sharesAsFixedUnits(25.75)).toBe(2575)
    expect(sharesAsFixedUnits(MAX_DISPLAY_SHARES)).toBe(MAX_STORED_SHARES)
  })

  it('tolerates representation noise for 0.1 + 0.2 type cases', () => {
    // 0.1 + 0.2 ≈ 0.30000000000000004
    expect(sharesAsFixedUnits(0.1 + 0.2)).toBe(30)
    // 0.7 is stored as 0.6999999…; the epsilon check accepts it.
    expect(sharesAsFixedUnits(0.7)).toBe(70)
  })

  it('rejects values with more than two decimal places', () => {
    expect(() => sharesAsFixedUnits(1.001)).toThrow(/decimal places/)
    expect(() => sharesAsFixedUnits(0.123)).toThrow(/decimal places/)
  })

  it('rejects zero, negative, and non-finite values', () => {
    expect(() => sharesAsFixedUnits(0)).toThrow(
      /0\.01|no zero\/negative shares/,
    )
    expect(() => sharesAsFixedUnits(-1)).toThrow(
      /0\.01|no zero\/negative shares/,
    )
    expect(() => sharesAsFixedUnits(Number.POSITIVE_INFINITY)).toThrow(/finite/)
    expect(() => sharesAsFixedUnits(Number.NaN)).toThrow(/finite/)
  })

  it('rejects values above the new product maximum', () => {
    expect(() => sharesAsFixedUnits(MAX_DISPLAY_SHARES + 1)).toThrow(
      /display share must be ≤/,
    )
  })
})

describe('sharesAsDecimal', () => {
  it('divides stored fixed units by SHARE_SCALE', () => {
    expect(sharesAsDecimal(1)).toBe(0.01)
    expect(sharesAsDecimal(50)).toBe(0.5)
    expect(sharesAsDecimal(100)).toBe(1)
    expect(sharesAsDecimal(110)).toBe(1.1)
    expect(sharesAsDecimal(2575)).toBe(25.75)
  })

  it('preserves the literal scale (no extra rounding)', () => {
    // Valid stored values are already exact hundredths.
    expect(sharesAsDecimal(0.01 * SHARE_SCALE)).toBe(0.01)
  })
})

describe('isValidDisplayShare', () => {
  it('accepts values inside the display range with at most two decimals', () => {
    expect(isValidDisplayShare(0.01)).toBe(true)
    expect(isValidDisplayShare(0.5)).toBe(true)
    expect(isValidDisplayShare(1)).toBe(true)
    expect(isValidDisplayShare(1.1)).toBe(true)
    expect(isValidDisplayShare(25.75)).toBe(true)
    expect(isValidDisplayShare(MAX_DISPLAY_SHARES)).toBe(true)
  })

  it('rejects out-of-range and non-finite values', () => {
    expect(isValidDisplayShare(0)).toBe(false)
    expect(isValidDisplayShare(-0.01)).toBe(false)
    expect(isValidDisplayShare(MAX_DISPLAY_SHARES + 1)).toBe(false)
    expect(isValidDisplayShare(Number.NaN)).toBe(false)
    expect(isValidDisplayShare('1')).toBe(false)
  })

  it('rejects values with more than two decimal places', () => {
    expect(isValidDisplayShare(1.001)).toBe(false)
    expect(isValidDisplayShare(0.123)).toBe(false)
  })
})

describe('formatDisplayShares', () => {
  it('trims trailing zeros and never shows more than two decimals', () => {
    expect(formatDisplayShares(1)).toBe('1')
    expect(formatDisplayShares(1.1)).toBe('1.1')
    expect(formatDisplayShares(0.5)).toBe('0.5')
    expect(formatDisplayShares(25.75)).toBe('25.75')
  })

  it('respects the locale grouping preference (no grouping by default)', () => {
    expect(formatDisplayShares(1234.5)).toBe('1234.5')
    expect(formatDisplayShares(1234.5, 'de-DE')).toBe('1234,5')
  })

  it('never exposes more than two fraction digits', () => {
    expect(formatDisplayShares(0.123)).toBe('0.12')
    expect(formatDisplayShares(1.234)).toBe('1.23')
  })
})

describe('constants', () => {
  it('SHARE_SCALE is 100 with two decimal places of precision', () => {
    expect(SHARE_SCALE).toBe(100)
    expect(SHARE_DECIMAL_PLACES).toBe(2)
  })

  it('MAX_STORED_SHARES is the product of MAX_DISPLAY_SHARES and SHARE_SCALE', () => {
    expect(MAX_STORED_SHARES).toBe(MAX_DISPLAY_SHARES * SHARE_SCALE)
    // Fits comfortably within PostgreSQL INTEGER.
    expect(MAX_STORED_SHARES).toBeLessThan(Number.MAX_SAFE_INTEGER)
  })
})

describe('getDisplayShareErrorKey', () => {
  it('accepts valid positive shares in every non-BY_SHARES mode', () => {
    expect(getDisplayShareErrorKey(10, 'BY_AMOUNT')).toBeNull()
    expect(getDisplayShareErrorKey(75.5, 'BY_PERCENTAGE')).toBeNull()
  })

  it('rejects NaN shares as invalidNumber (partial inputs like "-")', () => {
    expect(getDisplayShareErrorKey(Number('-'), 'BY_AMOUNT')).toBe(
      'invalidNumber',
    )
    expect(getDisplayShareErrorKey(Number('-'), 'BY_PERCENTAGE')).toBe(
      'invalidNumber',
    )
    expect(getDisplayShareErrorKey(Number('12.5x'), 'BY_SHARES')).toBe(
      'invalidNumber',
    )
  })

  it('rejects positive and negative Infinity as invalidNumber', () => {
    expect(getDisplayShareErrorKey(Number.POSITIVE_INFINITY, 'BY_AMOUNT')).toBe(
      'invalidNumber',
    )
    expect(
      getDisplayShareErrorKey(Number.POSITIVE_INFINITY, 'BY_PERCENTAGE'),
    ).toBe('invalidNumber')
    expect(getDisplayShareErrorKey(Number.NEGATIVE_INFINITY, 'BY_AMOUNT')).toBe(
      'invalidNumber',
    )
    expect(getDisplayShareErrorKey(Number.NEGATIVE_INFINITY, 'BY_SHARES')).toBe(
      'invalidNumber',
    )
  })

  it('flags zero shares as noZeroShares in every mode', () => {
    expect(getDisplayShareErrorKey(0, 'BY_AMOUNT')).toBe('noZeroShares')
    expect(getDisplayShareErrorKey(0, 'BY_PERCENTAGE')).toBe('noZeroShares')
    expect(getDisplayShareErrorKey(0, 'BY_SHARES')).toBe('sharesInvalid')
  })

  it('flags negative shares as noZeroShares unless allowNegative', () => {
    expect(getDisplayShareErrorKey(-5, 'BY_AMOUNT')).toBe('noZeroShares')
    expect(
      getDisplayShareErrorKey(-5, 'BY_AMOUNT', { allowNegative: true }),
    ).toBeNull()
    expect(getDisplayShareErrorKey(-5, 'BY_PERCENTAGE')).toBe('noZeroShares')
    expect(
      getDisplayShareErrorKey(-5, 'BY_PERCENTAGE', { allowNegative: true }),
    ).toBeNull()
  })

  it('enforces the BY_SHARES range and precision contract', () => {
    expect(getDisplayShareErrorKey(0.5, 'BY_SHARES')).toBeNull()
    expect(getDisplayShareErrorKey(1, 'BY_SHARES')).toBeNull()
    expect(getDisplayShareErrorKey(1.001, 'BY_SHARES')).toBe('sharesInvalid')
    expect(getDisplayShareErrorKey(-1, 'BY_SHARES')).toBe('sharesInvalid')
  })
})
