import { Schema } from 'effect'

import {
  type Currency,
  type FixedConversionReason,
  currencyList,
  dayBeforeIso,
  fixedConversionFor,
  getCurrency,
  getCurrencyFromGroup,
  getCurrencyRateWarning,
  intermediaryCurrenciesFor,
  isCryptoCurrency,
  lastAvailableDateBeforeFixed,
  resolveCurrencyCode,
  roundingGapMinor,
  supportedCurrencyCodes,
  withdrawnDetailsFor,
} from './currency'
import { CurrencyListSchema } from './currency'
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

describe('resolveCurrencyCode', () => {
  it('resolves an ISO code regardless of case', () => {
    expect(resolveCurrencyCode('usd')).toBe('USD')
  })

  it('resolves an unambiguous supported symbol', () => {
    expect(resolveCurrencyCode('€')).toBe('EUR')
  })

  it('resolves the catalog symbol for RUB', () => {
    expect(resolveCurrencyCode('₽')).toBe('RUB')
  })

  it('resolves aliases stored on the currency record', () => {
    expect(resolveCurrencyCode('￥')).toBe('JPY')
    expect(resolveCurrencyCode('МКД')).toBe('MKD')
    expect(resolveCurrencyCode('₺')).toBe('TRY')
    expect(resolveCurrencyCode('US$')).toBe('USD')
  })

  it('does not guess when an alias is shared by multiple currencies', () => {
    expect(resolveCurrencyCode('leu')).toBeNull()
    expect(resolveCurrencyCode('Rs')).toBeNull()
    expect(resolveCurrencyCode('Rs.')).toBeNull()
    expect(resolveCurrencyCode('元')).toBeNull()
  })

  it('keeps ISO codes and canonical symbols out of aliases', () => {
    for (const currency of currencyList) {
      for (const alias of currency.aliases ?? []) {
        expect(alias.toLowerCase()).not.toBe(currency.code.toLowerCase())
        expect(alias.toLowerCase()).not.toBe(currency.symbol.toLowerCase())
      }
    }
  })

  it('returns null for unrecognized custom text', () => {
    expect(resolveCurrencyCode('gold coins')).toBeNull()
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

  it('carries an explicit researched rounding threshold on every entry', () => {
    for (const currency of currencyList) {
      expect(
        Number.isInteger(currency.rounding_gap_minor) &&
          (currency.rounding_gap_minor as number) >= 1,
      ).toBe(true)
    }
  })
})

describe('roundingGapMinor', () => {
  it('returns the researched per-currency threshold', () => {
    expect(roundingGapMinor(getCurrency('USD')!)).toBe(51)
    expect(roundingGapMinor(getCurrency('EUR')!)).toBe(51)
    expect(roundingGapMinor(getCurrency('CHF')!)).toBe(3)
    expect(roundingGapMinor(getCurrency('CAD')!)).toBe(3)
    expect(roundingGapMinor(getCurrency('NZD')!)).toBe(6)
    expect(roundingGapMinor(getCurrency('AED')!)).toBe(13)
    expect(roundingGapMinor(getCurrency('DKK')!)).toBe(26)
    expect(roundingGapMinor(getCurrency('JPY')!)).toBe(1)
    expect(roundingGapMinor(getCurrency('KRW')!)).toBe(1)
    expect(roundingGapMinor(getCurrency('BHD')!)).toBe(3)
    expect(roundingGapMinor(getCurrency('KWD')!)).toBe(3)
    expect(roundingGapMinor(getCurrency('BTC')!)).toBe(1)
  })

  it('falls back to the digit-based default without a researched value', () => {
    expect(
      roundingGapMinor({
        code: '',
        symbol: 'X',
        rounding: 0,
        decimal_digits: 2,
      }),
    ).toBe(51)
    expect(
      roundingGapMinor({
        code: '',
        symbol: 'Y',
        rounding: 0,
        decimal_digits: 0,
      }),
    ).toBe(1)
    expect(
      roundingGapMinor({
        code: '',
        symbol: 'Z',
        rounding: 0,
        decimal_digits: 3,
      }),
    ).toBe(3)
  })
})

describe('fixed conversions', () => {
  it('records the euro-adoption rates for BGN and HRK', () => {
    expect(fixedConversionFor('BGN')).toEqual({
      anchor: 'EUR',
      unitsPerAnchor: 1.95583,
      effectiveFrom: '2026-01-01',
      reason: 'euro-adoption',
      referenceUrl:
        'https://www.ecb.europa.eu/euro/changeover/html/index.en.html',
    })
    expect(fixedConversionFor('HRK')).toEqual({
      anchor: 'EUR',
      unitsPerAnchor: 7.5345,
      effectiveFrom: '2023-01-01',
      reason: 'euro-adoption',
      referenceUrl:
        'https://www.ecb.europa.eu/euro/changeover/html/index.en.html',
    })
  })

  it('returns undefined for live and unknown codes', () => {
    expect(fixedConversionFor('EUR')).toBeUndefined()
    expect(fixedConversionFor('USD')).toBeUndefined()
    expect(fixedConversionFor('XXX')).toBeUndefined()
  })

  it('resolves the last quoted date before withdrawal', () => {
    expect(lastAvailableDateBeforeFixed('BGN')).toBe('2025-12-31')
    expect(lastAvailableDateBeforeFixed('HRK')).toBe('2022-12-31')
    expect(lastAvailableDateBeforeFixed('EUR')).toBeNull()
    expect(lastAvailableDateBeforeFixed('XXX')).toBeNull()
  })

  it('steps one calendar day back across month and year boundaries', () => {
    expect(dayBeforeIso('2026-01-01')).toBe('2025-12-31')
    expect(dayBeforeIso('2026-03-01')).toBe('2026-02-28')
    expect(dayBeforeIso('2024-03-01')).toBe('2024-02-29')
    expect(() => dayBeforeIso('not-a-date')).toThrow()
  })

  it('keeps every fixed conversion internally consistent', () => {
    const reasons: FixedConversionReason[] = [
      'euro-adoption',
      'redenomination',
      'replacement',
      'withdrawn',
    ]
    for (const currency of currencyList) {
      const fixed = currency.fixedConversion
      if (!fixed) continue
      expect(fixed.anchor).not.toBe(currency.code)
      expect(getCurrency(fixed.anchor)).toBeDefined()
      expect(fixedConversionFor(fixed.anchor)).toBeUndefined()
      expect(fixed.unitsPerAnchor).toBeGreaterThan(0)
      expect(fixed.effectiveFrom).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(reasons).toContain(fixed.reason)
      if (fixed.referenceUrl !== undefined) {
        expect(() => new URL(fixed.referenceUrl!)).not.toThrow()
      }
    }
  })

  it('validates the catalog through the Effect Schema', () => {
    const decoded = Schema.decodeUnknownSync(CurrencyListSchema)(currencyList)
    expect(decoded.length).toBe(currencyList.length)
    expect(() =>
      Schema.decodeUnknownSync(CurrencyListSchema)([
        {
          code: 'XXX',
          symbol: 'X',
          rounding: 0,
          decimal_digits: 2,
          fixedConversion: {
            anchor: 'EUR',
            unitsPerAnchor: -1,
            effectiveFrom: 'not-a-date',
            reason: 'annexation',
          },
        },
      ]),
    ).toThrow()
  })
})

describe('currency rate warnings', () => {
  it('flags a frozen end-of-life quote with no fixed legs', () => {
    expect(
      getCurrencyRateWarning({
        base: 'BGN',
        target: 'JPY',
        requestedDate: '2026-06-15',
        asOfDate: '2025-12-31',
        sources: [{ provider: 'frankfurter', base: 'BGN', target: 'JPY' }],
      }),
    ).toEqual({
      kind: 'frozen-eol',
      codes: ['BGN'],
      details: [
        {
          code: 'BGN',
          anchor: 'EUR',
          unitsPerAnchor: 1.95583,
          effectiveFrom: '2026-01-01',
          reason: 'euro-adoption',
          referenceUrl:
            'https://www.ecb.europa.eu/euro/changeover/html/index.en.html',
        },
      ],
      frozenDate: '2025-12-31',
    })
  })

  it('flags a purely statutory rate', () => {
    expect(
      getCurrencyRateWarning({
        base: 'BGN',
        target: 'EUR',
        requestedDate: '2026-06-15',
        asOfDate: '2026-06-15',
        sources: [{ provider: 'fixed', base: 'BGN', target: 'EUR' }],
      })?.kind,
    ).toBe('statutory-fixed')
  })

  it('flags a triangulated fixed-plus-live rate', () => {
    const warning = getCurrencyRateWarning({
      base: 'BGN',
      target: 'USD',
      requestedDate: '2026-06-15',
      asOfDate: '2026-06-15',
      sources: [
        { provider: 'fixed', base: 'BGN', target: 'EUR' },
        { provider: 'frankfurter', base: 'EUR', target: 'USD' },
      ],
    })
    expect(warning?.kind).toBe('triangulated-fixed')
    expect(warning?.codes).toEqual(['BGN'])
  })

  it('stays silent for live pairs and empty sources', () => {
    expect(
      getCurrencyRateWarning({
        base: 'EUR',
        target: 'USD',
        requestedDate: '2026-06-15',
        asOfDate: '2026-06-15',
        sources: [{ provider: 'frankfurter', base: 'EUR', target: 'USD' }],
      }),
    ).toBeNull()
    expect(
      getCurrencyRateWarning({
        base: 'BGN',
        target: 'EUR',
        requestedDate: '2026-06-15',
        asOfDate: '2026-06-15',
        sources: [],
      }),
    ).toBeNull()
  })

  it('lists withdrawal details for withdrawn codes in a pair', () => {
    expect(withdrawnDetailsFor(['EUR', 'USD'])).toEqual([])
    const details = withdrawnDetailsFor(['BGN', 'JPY'])
    expect(details.map((detail) => detail.code)).toEqual(['BGN'])
    expect(details[0]).toMatchObject({
      anchor: 'EUR',
      unitsPerAnchor: 1.95583,
      effectiveFrom: '2026-01-01',
      reason: 'euro-adoption',
    })
  })
})

describe('crypto currencies', () => {
  it('marks the supported crypto assets', () => {
    for (const code of ['BTC', 'DOGE', 'ETH', 'LTC', 'SAT', 'SOL', 'XRP']) {
      expect(isCryptoCurrency(code)).toBe(true)
      expect(getCurrency(code)?.decimal_digits).toBeGreaterThanOrEqual(0)
    }
  })

  it('does not mark fiat currencies as crypto', () => {
    for (const code of ['USD', 'EUR', 'MKD', 'JPY']) {
      expect(isCryptoCurrency(code)).toBe(false)
    }
  })

  it('gives SAT an alias scale of 1e-8 BTC', () => {
    const sat = getCurrency('SAT')
    expect(sat?.aliasOf).toBe('BTC')
    expect(sat?.aliasScale).toBe(0.00000001)
    expect(sat?.decimal_digits).toBe(0)
  })

  it('uses the default intermediary order when no list is defined', () => {
    expect(intermediaryCurrenciesFor('BTC')).toEqual(['EUR', 'USD'])
    expect(intermediaryCurrenciesFor('USD')).toEqual(['EUR', 'USD'])
  })

  it('uses the same default bridge order for fiat currencies', () => {
    expect(intermediaryCurrenciesFor('MKD')).toEqual(['EUR', 'USD'])
    expect(intermediaryCurrenciesFor('BGN')).toEqual(['EUR', 'USD'])
  })

  it('resolves crypto codes and symbols via the catalog', () => {
    expect(resolveCurrencyCode('btc')).toBe('BTC')
    expect(resolveCurrencyCode('₿')).toBe('BTC')
    expect(resolveCurrencyCode('sats')).toBe('SAT')
    expect(resolveCurrencyCode('DOGE')).toBe('DOGE')
  })
})
