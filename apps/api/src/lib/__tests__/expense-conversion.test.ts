import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { CurrencyRate } from '../currency-rates'
import {
  ConversionError,
  exchangeLookupDateForExpenseDate,
  preservedExchangeFromStored,
  resolveConversion,
} from '../expense-conversion'

function futureDateIso(daysAhead: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + daysAhead)
  return d.toISOString().slice(0, 10)
}

function pastDateIso(daysAgo: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - daysAgo)
  return d.toISOString().slice(0, 10)
}

function isoDate(input: string): Date {
  return new Date(`${input}T00:00:00.000Z`)
}

function makeFetch(
  impl: (params: {
    date: string
    base: string
    target: string
  }) => CurrencyRate | Promise<CurrencyRate>,
) {
  return async (params: { date: string; base: string; target: string }) =>
    impl(params)
}

describe('resolveConversion', () => {
  beforeEach(() => {
    vi.useRealTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('none: same-currency returns ledger = input, no rate', async () => {
    const result = await resolveConversion(
      { amount: 5000 },
      {
        ledgerCurrency: 'USD',
        expenseDate: isoDate(pastDateIso(1)),
      },
    )
    expect(result.conversionSource).toBeNull()
    expect(result.ledgerAmountMinor).toBe(5000)
    expect(result.conversionRate).toBeNull()
    expect(result.originalAmount).toBeNull()
  })

  it('custom: multiplies by client rate', async () => {
    const result = await resolveConversion(
      {
        amount: 10000,
        conversion: { type: 'custom', currency: 'EUR', rate: 1.1 },
      },
      {
        ledgerCurrency: 'USD',
        expenseDate: isoDate(pastDateIso(1)),
      },
    )
    expect(result.conversionSource).toBe('CUSTOM')
    expect(result.ledgerAmountMinor).toBe(11000)
    expect(result.originalAmount).toBe(10000)
    expect(result.originalCurrency).toBe('EUR')
    expect(result.conversionRate).toBe(1.1)
  })

  it('exact: preserves the authoritative ledger amount and derives the rate', async () => {
    const fetchImpl = vi.fn()
    const result = await resolveConversion(
      {
        amount: 10000,
        conversion: { type: 'exact', currency: 'USD', amount: 9347 },
      },
      {
        ledgerCurrency: 'EUR',
        expenseDate: isoDate(pastDateIso(1)),
      },
      { fetchImpl },
    )

    expect(fetchImpl).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      conversionSource: 'EXACT',
      ledgerAmountMinor: 9347,
      originalAmount: 10000,
      originalCurrency: 'USD',
      conversionRate: 0.9347,
    })
  })

  it('exact: derives a major-unit rate across different currency precisions', async () => {
    const result = await resolveConversion(
      {
        amount: 10000,
        conversion: { type: 'exact', currency: 'USD', amount: 15000 },
      },
      { ledgerCurrency: 'JPY', expenseDate: isoDate(pastDateIso(1)) },
    )

    expect(result.ledgerAmountMinor).toBe(15000)
    expect(result.conversionRate).toBe(150)
  })

  it('exact: accepts matching negative amounts and rejects mismatched signs', async () => {
    const income = await resolveConversion(
      {
        amount: -10000,
        conversion: { type: 'exact', currency: 'USD', amount: -9347 },
      },
      { ledgerCurrency: 'EUR', expenseDate: isoDate(pastDateIso(1)) },
    )
    expect(income.ledgerAmountMinor).toBe(-9347)

    await expect(
      resolveConversion(
        {
          amount: 10000,
          conversion: { type: 'exact', currency: 'USD', amount: -9347 },
        },
        { ledgerCurrency: 'EUR', expenseDate: isoDate(pastDateIso(1)) },
      ),
    ).rejects.toMatchObject({ code: 'AMOUNT_SIGN_MISMATCH' })
  })

  it('custom: scales minor units when decimal_digits differ (USD→JPY)', async () => {
    // $100.00 = 10000¢; 1 USD = 150 JPY → 15_000 yen (not 1_500_000)
    const result = await resolveConversion(
      {
        amount: 10000,
        conversion: { type: 'custom', currency: 'USD', rate: 150 },
      },
      {
        ledgerCurrency: 'JPY',
        expenseDate: isoDate(pastDateIso(1)),
      },
    )
    expect(result.ledgerAmountMinor).toBe(15_000)
    expect(result.originalAmount).toBe(10000)
  })

  it('custom: scales minor units when decimal_digits differ (JPY→USD)', async () => {
    // 15_000 yen; 1 JPY = 1/150 USD → $100.00 = 10000¢
    const result = await resolveConversion(
      {
        amount: 15_000,
        conversion: { type: 'custom', currency: 'JPY', rate: 1 / 150 },
      },
      {
        ledgerCurrency: 'USD',
        expenseDate: isoDate(pastDateIso(1)),
      },
    )
    expect(result.ledgerAmountMinor).toBe(10000)
  })

  it('custom: rejects non-positive rate', async () => {
    await expect(
      resolveConversion(
        {
          amount: 1000,
          conversion: { type: 'custom', currency: 'EUR', rate: 0 },
        },
        {
          ledgerCurrency: 'USD',
          expenseDate: isoDate(pastDateIso(1)),
        },
      ),
    ).rejects.toMatchObject({ code: 'RATE_NOT_POSITIVE' })
  })

  it('exchange: past date uses expense date', async () => {
    const date = pastDateIso(5)
    const fetchImpl = makeFetch(({ date: d, base, target }) => {
      expect(d).toBe(date)
      expect(base).toBe('EUR')
      expect(target).toBe('USD')
      return {
        rate: 1.08,
        requestedDate: d,
        asOfDate: d,
        base,
        target,
      }
    })
    const result = await resolveConversion(
      {
        amount: 10000,
        conversion: { type: 'exchange', currency: 'EUR' },
      },
      {
        ledgerCurrency: 'USD',
        expenseDate: isoDate(date),
      },
      { fetchImpl },
    )
    expect(result.conversionSource).toBe('EXCHANGE')
    expect(result.ledgerAmountMinor).toBe(10800)
    expect(result.conversionRate).toBe(1.08)
  })

  it('exchange: scales minor units when decimal_digits differ', async () => {
    const date = pastDateIso(2)
    const fetchImpl = makeFetch(() => ({
      rate: 150,
      requestedDate: date,
      asOfDate: date,
      base: 'USD',
      target: 'JPY',
    }))
    const result = await resolveConversion(
      {
        amount: 10000,
        conversion: { type: 'exchange', currency: 'USD' },
      },
      {
        ledgerCurrency: 'JPY',
        expenseDate: isoDate(date),
      },
      { fetchImpl },
    )
    expect(result.ledgerAmountMinor).toBe(15_000)
  })

  it('exchange: future date uses today', async () => {
    const future = futureDateIso(10)
    const today = new Date().toISOString().slice(0, 10)
    const fetchImpl = makeFetch(({ date: d }) => {
      expect(d).toBe(today)
      return {
        rate: 1.2,
        requestedDate: d,
        asOfDate: d,
        base: 'EUR',
        target: 'USD',
      }
    })
    const result = await resolveConversion(
      {
        amount: 1000,
        conversion: { type: 'exchange', currency: 'EUR' },
      },
      {
        ledgerCurrency: 'USD',
        expenseDate: isoDate(future),
      },
      { fetchImpl },
    )
    expect(result.conversionSource).toBe('EXCHANGE')
    expect(result.ledgerAmountMinor).toBe(1200)
  })

  it('exchange: rejects custom/unsupported currency', async () => {
    await expect(
      resolveConversion(
        {
          amount: 1000,
          conversion: { type: 'exchange', currency: 'POINTS' },
        },
        {
          ledgerCurrency: 'USD',
          expenseDate: isoDate(pastDateIso(1)),
        },
      ),
    ).rejects.toMatchObject({ code: 'INVALID_SOURCE_FOR_CURRENCY' })
  })

  it('exchange: provider failure surfaces as PROVIDER_UNAVAILABLE', async () => {
    const fetchImpl = makeFetch(() => {
      throw new Error('network down')
    })
    await expect(
      resolveConversion(
        {
          amount: 1000,
          conversion: { type: 'exchange', currency: 'EUR' },
        },
        {
          ledgerCurrency: 'USD',
          expenseDate: isoDate(pastDateIso(1)),
        },
        { fetchImpl },
      ),
    ).rejects.toBeInstanceOf(ConversionError)
  })

  it('returns zero amount untouched', async () => {
    const result = await resolveConversion(
      { amount: 0, conversion: { type: 'exchange', currency: 'EUR' } },
      {
        ledgerCurrency: 'USD',
        expenseDate: isoDate(pastDateIso(1)),
      },
    )
    expect(result.ledgerAmountMinor).toBe(0)
    expect(result.conversionSource).toBeNull()
  })
})

describe('resolveConversion — EXCHANGE preservation (issue #155)', () => {
  it('reuses the stored rate when currency + lookup date are unchanged', async () => {
    const date = pastDateIso(5)
    const fetchImpl = vi.fn()
    const preserve = preservedExchangeFromStored(
      {
        originalCurrency: 'EUR',
        conversionRate: 1.1,
        expenseDate: isoDate(date),
      },
      'USD',
    )
    expect(preserve).toBeDefined()
    const result = await resolveConversion(
      { amount: 10000, conversion: { type: 'exchange', currency: 'EUR' } },
      { ledgerCurrency: 'USD', expenseDate: isoDate(date) },
      { fetchImpl, preserveExchange: preserve },
    )
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      conversionSource: 'EXCHANGE',
      conversionRate: 1.1,
      originalAmount: 10000,
      originalCurrency: 'EUR',
      ledgerAmountMinor: 11000,
    })
  })

  it('rescales the ledger total with the stored rate when only the amount changes', async () => {
    const date = pastDateIso(5)
    const fetchImpl = vi.fn()
    const preserve = preservedExchangeFromStored(
      {
        originalCurrency: 'EUR',
        conversionRate: 1.1,
        expenseDate: isoDate(date),
      },
      'USD',
    )
    const result = await resolveConversion(
      { amount: 20000, conversion: { type: 'exchange', currency: 'EUR' } },
      { ledgerCurrency: 'USD', expenseDate: isoDate(date) },
      { fetchImpl, preserveExchange: preserve },
    )
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(result.conversionRate).toBe(1.1)
    expect(result.ledgerAmountMinor).toBe(22000)
  })

  it('re-fetches when the expense date changes the lookup date', async () => {
    const oldDate = pastDateIso(5)
    const newDate = pastDateIso(2)
    const fetchImpl = makeFetch(({ date: d }) => ({
      rate: 1.25,
      requestedDate: d,
      asOfDate: d,
      base: 'EUR',
      target: 'USD',
    }))
    const spy = vi.fn(fetchImpl)
    const preserve = preservedExchangeFromStored(
      {
        originalCurrency: 'EUR',
        conversionRate: 1.1,
        expenseDate: isoDate(oldDate),
      },
      'USD',
    )
    const result = await resolveConversion(
      { amount: 10000, conversion: { type: 'exchange', currency: 'EUR' } },
      { ledgerCurrency: 'USD', expenseDate: isoDate(newDate) },
      { fetchImpl: spy, preserveExchange: preserve },
    )
    expect(spy).toHaveBeenCalledTimes(1)
    expect(result.conversionRate).toBe(1.25)
    expect(result.ledgerAmountMinor).toBe(12500)
  })

  it('re-fetches when the currency changes', async () => {
    const date = pastDateIso(5)
    const fetchImpl = makeFetch(({ date: d }) => ({
      rate: 0.9,
      requestedDate: d,
      asOfDate: d,
      base: 'GBP',
      target: 'USD',
    }))
    const spy = vi.fn(fetchImpl)
    const preserve = preservedExchangeFromStored(
      {
        originalCurrency: 'EUR',
        conversionRate: 1.1,
        expenseDate: isoDate(date),
      },
      'USD',
    )
    const result = await resolveConversion(
      { amount: 10000, conversion: { type: 'exchange', currency: 'GBP' } },
      { ledgerCurrency: 'USD', expenseDate: isoDate(date) },
      { fetchImpl: spy, preserveExchange: preserve },
    )
    expect(spy).toHaveBeenCalledTimes(1)
    expect(result.originalCurrency).toBe('GBP')
    expect(result.conversionRate).toBe(0.9)
  })

  it('re-fetches when the ledger currency changes', async () => {
    const date = pastDateIso(5)
    const fetchImpl = makeFetch(({ date: d }) => ({
      rate: 160,
      requestedDate: d,
      asOfDate: d,
      base: 'EUR',
      target: 'JPY',
    }))
    const spy = vi.fn(fetchImpl)
    const preserve = preservedExchangeFromStored(
      {
        originalCurrency: 'EUR',
        conversionRate: 1.1,
        expenseDate: isoDate(date),
      },
      'USD',
    )
    const result = await resolveConversion(
      { amount: 10000, conversion: { type: 'exchange', currency: 'EUR' } },
      { ledgerCurrency: 'JPY', expenseDate: isoDate(date) },
      { fetchImpl: spy, preserveExchange: preserve },
    )
    expect(spy).toHaveBeenCalledTimes(1)
    expect(result.conversionRate).toBe(160)
  })

  it('falls back to fetch when the stored rate is missing or invalid', async () => {
    const date = pastDateIso(5)
    const fetchImpl = makeFetch(({ date: d }) => ({
      rate: 1.3,
      requestedDate: d,
      asOfDate: d,
      base: 'EUR',
      target: 'USD',
    }))
    const spy = vi.fn(fetchImpl)
    const preserve = preservedExchangeFromStored(
      {
        originalCurrency: 'EUR',
        conversionRate: null,
        expenseDate: isoDate(date),
      },
      'USD',
    )
    expect(preserve).toBeUndefined()
    const result = await resolveConversion(
      { amount: 10000, conversion: { type: 'exchange', currency: 'EUR' } },
      { ledgerCurrency: 'USD', expenseDate: isoDate(date) },
      { fetchImpl: spy, preserveExchange: preserve },
    )
    expect(spy).toHaveBeenCalledTimes(1)
    expect(result.conversionRate).toBe(1.3)
  })

  it('exchangeLookupDateForExpenseDate clamps future dates to today', () => {
    const today = new Date().toISOString().slice(0, 10)
    expect(exchangeLookupDateForExpenseDate(isoDate(futureDateIso(10)))).toBe(
      today,
    )
  })
})

describe('resolveConversion — same currency (absent conversion)', () => {
  it('treats missing conversion as same-currency', async () => {
    const result = await resolveConversion(
      { amount: 1000 },
      {
        ledgerCurrency: 'USD',
        expenseDate: isoDate(pastDateIso(1)),
      },
    )
    expect(result.conversionSource).toBeNull()
    expect(result.ledgerAmountMinor).toBe(1000)
  })
})
