import {
  type Currency,
  currencyList,
  getCurrency,
  getCurrencyFromGroup,
  supportedCurrencyCodes,
} from './currency'
import {
  amountAsDecimal,
  amountAsMinorUnits,
  formatAmountAsDecimal,
} from './utils'

describe('getCurrency', () => {
  it('returns currency by code', () => {
    const usd = getCurrency('USD')

    expect(usd?.code).toBe('USD')
    expect(typeof usd?.decimal_digits).toBe('number')
    expect(Number.isFinite(usd!.decimal_digits)).toBe(true)
  })

  it('returns undefined for unknown code', () => {
    expect(getCurrency('XXX')).toBeUndefined()
  })
})

describe('getCurrencyFromGroup', () => {
  it('extracts custom currency symbol when no currencyCode', () => {
    const currency = getCurrencyFromGroup({
      currency: 'ƃ',
      currencyCode: null,
    })
    expect(currency.code).toBe('')
    expect(currency.symbol).toBe('ƃ')
    expect(currency.decimal_digits).toBe(2)
  })

  it('extracts currency by code when currencyCode exists', () => {
    const currency = getCurrencyFromGroup({
      currency: '$',
      currencyCode: 'USD',
    })
    expect(currency.code).toBe('USD')
  })

  it('falls back to synthetic entry for unknown currencyCode', () => {
    const currency = getCurrencyFromGroup({
      currency: 'X',
      currencyCode: 'XXX',
    })
    expect(currency.code).toBe('XXX')
    expect(currency.symbol).toBe('X')
    expect(currency.decimal_digits).toBe(2)
  })
})

describe('amountAsDecimal', () => {
  it('converts minor units to decimal major units', () => {
    const usd = getCurrency('USD')!

    expect(amountAsDecimal(0, usd)).toBe(0)
    expect(amountAsDecimal(1, usd)).toBe(0.01)
    expect(amountAsDecimal(1050, usd)).toBe(10.5)
    expect(amountAsDecimal(1234, usd)).toBe(12.34)
  })

  it('handles negative and large inputs', () => {
    const usd = getCurrency('USD')!
    expect(amountAsDecimal(-1, usd)).toBe(-0.01)
    expect(amountAsDecimal(999_999_999, usd)).toBe(9_999_999.99)
  })

  it('respects currencies with 0 decimal digits', () => {
    const jpy = getCurrency('JPY')!
    expect(amountAsDecimal(1000, jpy)).toBe(1000)
  })
})

describe('amountAsMinorUnits', () => {
  it('converts decimal major units to minor units', () => {
    const usd = getCurrency('USD')!
    expect(amountAsMinorUnits(10, usd)).toBe(1000)
  })

  it('rounds safely for common floating point cases', () => {
    const usd = getCurrency('USD')!
    expect(amountAsMinorUnits(10.01, usd)).toBe(1001)
  })

  it('respects currencies with 0 decimal digits', () => {
    const jpy = getCurrency('JPY')!
    expect(amountAsMinorUnits(1000, jpy)).toBe(1000)
  })
})

describe('formatAmountAsDecimal', () => {
  it('formats with correct decimals for 2-digit currency', () => {
    const usd = getCurrency('USD')!
    expect(formatAmountAsDecimal(0, usd)).toBe('0.00')
    expect(formatAmountAsDecimal(1, usd)).toBe('0.01')
    expect(formatAmountAsDecimal(1050, usd)).toBe('10.50')
    expect(formatAmountAsDecimal(1234, usd)).toBe('12.34')
  })

  it('formats with correct decimals for 0-digit currency', () => {
    const jpy = getCurrency('JPY')!
    expect(formatAmountAsDecimal(1000, jpy)).toBe('1000')
    expect(formatAmountAsDecimal(1, jpy)).toBe('1')
  })

  it('handles negative amounts', () => {
    const usd = getCurrency('USD')!
    expect(formatAmountAsDecimal(-1, usd)).toBe('-0.01')
    expect(formatAmountAsDecimal(-1050, usd)).toBe('-10.50')
  })
})

// Sanity check on the canonical list — every supported code must be present.
describe('currencyList', () => {
  it('contains every supported currency code', () => {
    const codes = new Set(currencyList.map((c: Currency) => c.code))
    for (const code of supportedCurrencyCodes) {
      expect(codes.has(code)).toBe(true)
    }
  })
})
