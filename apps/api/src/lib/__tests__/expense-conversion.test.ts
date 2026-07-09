import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CurrencyRate } from '../currency-rates'
import { ConversionError, resolveConversion } from '../expense-conversion'

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
