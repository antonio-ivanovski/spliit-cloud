import type { Currency } from './currency'
import {
  cn,
  conversionMinorScale,
  convertMinorUnitsByRate,
  delay,
  expenseIdSeed,
  formatAmountAsDecimal,
  formatCategoryForAIPrompt,
  formatCurrency,
  formatDate,
  formatDateOnly,
  formatFileSize,
  hashStringToSeed,
  normalizeString,
} from './utils'

describe('hashStringToSeed / expenseIdSeed', () => {
  it('is deterministic and non-zero for non-empty strings', () => {
    const a = hashStringToSeed('expense-a')
    const b = hashStringToSeed('expense-b')
    expect(a).toBe(hashStringToSeed('expense-a'))
    expect(a).not.toBe(b)
    expect(Number.isInteger(a)).toBe(true)
    expect(a).toBeGreaterThanOrEqual(0)
    expect(a).toBeLessThan(2 ** 32)
  })

  it('expenseIdSeed falls back to 0 when id is missing', () => {
    expect(expenseIdSeed(undefined)).toBe(0)
    expect(expenseIdSeed(null)).toBe(0)
    expect(expenseIdSeed('')).toBe(0)
    expect(expenseIdSeed('e1')).toBe(hashStringToSeed('e1'))
  })
})

describe('formatCurrency', () => {
  it('supports custom currency symbol when currency code is empty', () => {
    const currency: Currency = {
      symbol: 'CUR',
      code: '',
      rounding: 0,
      decimal_digits: 2,
    }

    const formatted = formatCurrency(currency, 123, 'en-US')
    expect(formatted).toContain(currency.symbol)

    const fractional = formatted.match(/\d+(?:[.,](\d+))?/)?.[1] ?? ''
    expect(fractional.length).toBe(currency.decimal_digits)
  })

  it('supports zero-decimal currencies (JPY)', () => {
    const jpy: Currency = {
      symbol: '¥',
      code: 'JPY',
      rounding: 0,
      decimal_digits: 0,
    }

    const formatted = formatCurrency(jpy, 1000, 'en-US')
    expect(formatted).toContain('¥')
    expect(formatted).not.toMatch(/[.,]\d{2}\s*$/)
  })

  it('formats crypto with trimmed trailing zeros and the symbol', () => {
    const btc: Currency = {
      symbol: '₿',
      code: 'BTC',
      rounding: 0,
      decimal_digits: 8,
      crypto: true,
    }

    expect(formatCurrency(btc, 50_000_000, 'en-US')).toBe('0.5 ₿')
    expect(formatCurrency(btc, 1_000_000, 'en-US')).toBe('0.01 ₿')
    expect(formatCurrency(btc, 100_000_000, 'en-US')).toBe('1 ₿')
    // Negative amounts keep the sign.
    expect(formatCurrency(btc, -50_000_000, 'en-US')).toBe('-0.5 ₿')
  })

  it('formats 4-letter crypto tickers without throwing (DOGE)', () => {
    const doge: Currency = {
      symbol: 'DOGE',
      code: 'DOGE',
      rounding: 0,
      decimal_digits: 2,
      crypto: true,
    }

    expect(formatCurrency(doge, 12_345, 'en-US')).toBe('123.45 DOGE')
  })

  it('formats zero-decimal crypto (SAT) without decimals', () => {
    const sat: Currency = {
      symbol: 'sats',
      code: 'SAT',
      rounding: 0,
      decimal_digits: 0,
      crypto: true,
    }

    expect(formatCurrency(sat, 5_000, 'en-US')).toBe('5,000 sats')
  })

  const currency: Currency = {
    symbol: 'CUR',
    code: '',
    rounding: 0,
    decimal_digits: 2,
  }
  /** For testing decimals */
  const partialAmount = 1.23
  /** For testing small full amounts */
  const smallAmount = 1
  /** For testing large full amounts */
  const largeAmount = 10000

  /** Non-breaking space */
  const nbsp = '\xa0'

  interface variation {
    amount: number
    locale: string
    result: string
  }

  /**
   * Variations to be tested, chosen as follows - `en-US` is a very common i18n
   * fallback - `de-DE` exhibited faulty behavior in previous versions
   */
  const variations: variation[] = [
    {
      amount: partialAmount,
      locale: `en-US`,
      result: `${currency.symbol}1.23`,
    },
    {
      amount: smallAmount,
      locale: `en-US`,
      result: `${currency.symbol}1.00`,
    },
    {
      amount: largeAmount,
      locale: `en-US`,
      result: `${currency.symbol}10,000.00`,
    },
    {
      amount: partialAmount,
      locale: `de-DE`,
      result: `1,23${nbsp}${currency.symbol}`,
    },
    {
      amount: smallAmount,
      locale: `de-DE`,
      result: `1,00${nbsp}${currency.symbol}`,
    },
    {
      amount: largeAmount,
      locale: `de-DE`,
      result: `10.000,00${nbsp}${currency.symbol}`,
    },
  ]

  for (const variation of variations) {
    it(`formats ${variation.amount} in ${variation.locale} without fractions`, () => {
      expect(
        formatCurrency(currency, variation.amount * 100, variation.locale),
      ).toBe(variation.result)
    })
    it(`formats ${variation.amount} in ${variation.locale} with fractions`, () => {
      expect(
        formatCurrency(currency, variation.amount, variation.locale, true),
      ).toBe(variation.result)
    })
  }
})

describe('formatDate', () => {
  it('formats using requested locale', () => {
    const date = new Date(Date.UTC(2025, 0, 2, 3, 4, 5))

    const en = formatDate(date, 'en-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
    })
    expect(en).toContain('2025')

    const fr = formatDate(date, 'fr-FR', {
      dateStyle: 'medium',
      timeStyle: 'short',
    })
    expect(fr).toContain('2025')
  })
})

describe('formatDateOnly', () => {
  it('avoids timezone shifts for DATE fields', () => {
    const dateFromDb = new Date('2025-10-17T00:00:00.000Z')

    const formatted = formatDateOnly(dateFromDb, 'en-US', {
      dateStyle: 'medium',
    })
    expect(formatted).toContain('2025')
    expect(formatted).toContain('17')
  })

  it('handles month boundaries without off-by-one', () => {
    const endOfMonthDb = new Date('2025-03-31T00:00:00.000Z')
    const nextDayDb = new Date('2025-04-01T00:00:00.000Z')

    const formattedEnd = formatDateOnly(endOfMonthDb, 'en-US', {
      dateStyle: 'medium',
    })
    const formattedNext = formatDateOnly(nextDayDb, 'en-US', {
      dateStyle: 'medium',
    })

    expect(formattedEnd).toContain('31')
    expect(formattedNext).toContain('1')
  })
})

describe('normalizeString', () => {
  it('removes accents/diacritics', () => {
    expect(normalizeString('áäåèéę')).toBe('aaaeee')
    expect(normalizeString('Crème brûlée')).toBe('creme brulee')
  })

  it('lowercases', () => {
    expect(normalizeString('HELLO World')).toBe('hello world')
  })
})

describe('formatFileSize', () => {
  it('formats bytes correctly', () => {
    expect(formatFileSize(0, 'en-US')).toBe('0 B')
    expect(formatFileSize(1, 'en-US')).toBe('1 B')
  })

  it('handles GB/MB/KB/B units', () => {
    expect(formatFileSize(1024 + 1, 'en-US')).toContain('kB')
    expect(formatFileSize(1024 ** 2 + 1, 'en-US')).toContain('MB')
    expect(formatFileSize(1024 ** 3 + 1, 'en-US')).toContain('GB')
  })
})

describe('formatCategoryForAIPrompt', () => {
  it('formats correctly', () => {
    const category = {
      id: 5,
      grouping: 'Food',
      name: 'Groceries',
    }

    expect(
      formatCategoryForAIPrompt(
        category as unknown as Parameters<typeof formatCategoryForAIPrompt>[0],
      ),
    ).toBe('"Food/Groceries" (ID: 5)')
  })
})

describe('delay', () => {
  it('resolves after ms', async () => {
    const start = Date.now()
    await delay(50)
    const elapsed = Date.now() - start

    expect(elapsed).toBeGreaterThanOrEqual(45) // Allow small variance
    expect(elapsed).toBeLessThan(100)
  })
})

describe('formatAmountAsDecimal', () => {
  it('formats with correct decimals', () => {
    const usd: Currency = {
      symbol: '$',
      code: 'USD',
      rounding: 0,
      decimal_digits: 2,
    }

    expect(formatAmountAsDecimal(1234, usd)).toBe('12.34')
    expect(formatAmountAsDecimal(100, usd)).toBe('1.00')
    expect(formatAmountAsDecimal(5, usd)).toBe('0.05')

    const jpy: Currency = {
      symbol: '¥',
      code: 'JPY',
      rounding: 0,
      decimal_digits: 0,
    }

    expect(formatAmountAsDecimal(1000, jpy)).toBe('1000')
  })
})

describe('convertMinorUnitsByRate', () => {
  it('is a no-op scale when decimal_digits match', () => {
    expect(conversionMinorScale(1.1, 'EUR', 'USD')).toBe(1.1)
    expect(convertMinorUnitsByRate(10000, 1.1, 'EUR', 'USD')).toBe(11000)
  })

  it('scales USD cents → JPY yen for major-unit rates', () => {
    // $100.00 at 150 JPY/USD → 15_000 yen
    expect(convertMinorUnitsByRate(10000, 150, 'USD', 'JPY')).toBe(15_000)
  })

  it('scales JPY yen → USD cents for major-unit rates', () => {
    expect(convertMinorUnitsByRate(15_000, 1 / 150, 'JPY', 'USD')).toBe(10000)
  })
})

describe('cn', () => {
  it('merges class names', () => {
    expect(cn('px-2', 'py-1')).toBe('px-2 py-1')
  })

  it('handles conditional classes', () => {
    const showHidden = false
    expect(cn('base', showHidden && 'hidden', 'active')).toBe('base active')
  })

  it('merges conflicting Tailwind classes so the last one wins', () => {
    expect(cn('px-2', 'px-4')).toBe('px-4')
  })
})
