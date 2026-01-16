import { getCurrency } from './currency'
import { amountAsDecimal, amountAsMinorUnits } from './utils'

describe('getCurrency', () => {
  it('returns currency by code', () => {
    const usd = getCurrency('USD')

    expect(usd.code).toBe('USD')
    expect(typeof usd.decimal_digits).toBe('number')
    expect(Number.isFinite(usd.decimal_digits)).toBe(true)

    expect(typeof usd.name).toBe('string')
    expect(usd.name.length).toBeGreaterThan(0)
  })
})

describe('amountAsDecimal', () => {
  it('converts minor units to decimal major units', () => {
    const usd = getCurrency('USD')
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
