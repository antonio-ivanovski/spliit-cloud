import { Currency, defaultCurrencyList, getCurrency } from './currency'
import {
  amountAsDecimal,
  amountAsMinorUnits,
  getCurrencyFromGroup,
} from './utils'

describe('getCurrency', () => {
  it('returns currency by code', () => {
    const usd = getCurrency('USD')

    expect(usd.code).toBe('USD')
    expect(typeof usd.decimal_digits).toBe('number')
    expect(Number.isFinite(usd.decimal_digits)).toBe(true)

    expect(typeof usd.name).toBe('string')
    expect(usd.name.length).toBeGreaterThan(0)
  })

  it('handles locale variations by falling back to en-US', () => {
    const usd = getCurrency('USD', 'en-GB' as any)
    expect(usd.code).toBe('USD')
    expect(typeof usd.name).toBe('string')
    expect(usd.name.length).toBeGreaterThan(0)

    const unknown = getCurrency('USD', 'xx-XX' as any)
    expect(unknown.code).toBe('USD')
    expect(typeof unknown.name).toBe('string')
    expect(unknown.name.length).toBeGreaterThan(0)
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
    expect(currency.symbol_native).toBe('ƃ')
    expect(currency.decimal_digits).toBe(2)
  })

  it('extracts currency by code when currencyCode exists', () => {
    const currency = getCurrencyFromGroup({
      currency: '$',
      currencyCode: 'USD',
    })
    expect(currency.code).toBe('USD')
    expect(typeof currency.name).toBe('string')
    expect(currency.name.length).toBeGreaterThan(0)
  })
})

describe('defaultCurrencyList', () => {
  it('includes custom currency choice when provided', () => {
    const list = defaultCurrencyList('en-US', 'My Currency')
    expect(list[0]?.code).toBe('')
    expect(list[0]?.name).toBe('My Currency')
    expect(list[0]?.name_plural).toBe('My Currency')

    const hasUsd = list.some((c: Currency) => c.code === 'USD')
    expect(hasUsd).toBe(true)
  })
})

describe('amountAsDecimal', () => {
  it('converts minor units to decimal major units', () => {
    const usd = getCurrency('USD')

    expect(amountAsDecimal(0, usd)).toBe(0)
    expect(amountAsDecimal(1, usd)).toBe(0.01)
    expect(amountAsDecimal(1050, usd)).toBe(10.5)
    expect(amountAsDecimal(1234, usd)).toBe(12.34)
  })

  it('handles negative and large inputs', () => {
    const usd = getCurrency('USD')
    expect(amountAsDecimal(-1, usd)).toBe(-0.01)
    expect(amountAsDecimal(999_999_999, usd)).toBe(9_999_999.99)
  })

  it('respects currencies with 0 decimal digits', () => {
    const jpy = getCurrency('JPY')
    expect(amountAsDecimal(1000, jpy)).toBe(1000)
  })
})

describe('amountAsMinorUnits', () => {
  it('converts decimal major units to minor units', () => {
    const usd = getCurrency('USD')
    expect(amountAsMinorUnits(10, usd)).toBe(1000)
  })

  it('rounds safely for common floating point cases', () => {
    const usd = getCurrency('USD')
    expect(amountAsMinorUnits(10.01, usd)).toBe(1001)
  })

  it('respects currencies with 0 decimal digits', () => {
    const jpy = getCurrency('JPY')
    expect(amountAsMinorUnits(1000, jpy)).toBe(1000)
  })
})
