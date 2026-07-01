import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearCurrencyRateCache,
  currencyRateCacheSize,
  CurrencyRateNotFoundError,
  CurrencyRateProviderError,
  getCurrencyRate,
  getCurrencyRates,
  UnsupportedCurrencyError,
} from '../currency-rates'

function makePayload(
  overrides?: Partial<{
    base: string
    date: string
    rates: Record<string, number>
  }>,
) {
  return {
    base: 'EUR',
    date: '2026-06-28',
    rates: { USD: 1.1401, GBP: 0.86253 },
    ...overrides,
  }
}

describe('getCurrencyRate', () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    clearCurrencyRateCache()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    clearCurrencyRateCache()
  })

  it('requests only the target quote from Frankfurter', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => [
        { date: '2026-06-28', base: 'EUR', quote: 'USD', rate: 1.1401 },
      ],
    }))
    globalThis.fetch = fetchMock as never

    const result = await getCurrencyRate({
      date: '2026-06-28',
      base: 'EUR',
      target: 'USD',
    })

    expect(result.rate).toBe(1.1401)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const url = new URL(fetchMock.mock.calls[0][0] as string)
    expect(url.pathname).toBe('/v2/rates')
    expect(url.searchParams.get('date')).toBe('2026-06-28')
    expect(url.searchParams.get('base')).toBe('EUR')
    expect(url.searchParams.get('quotes')).toBe('USD')
  })

  it('fetches from the provider on cache miss and returns the rate', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(makePayload())

    const result = await getCurrencyRate({
      date: '2026-06-28',
      base: 'EUR',
      target: 'USD',
      fetchImpl: fetchImpl as never,
    })

    expect(result).toEqual({
      rate: 1.1401,
      requestedDate: '2026-06-28',
      asOfDate: '2026-06-28',
      base: 'EUR',
      target: 'USD',
    })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(fetchImpl).toHaveBeenCalledWith('2026-06-28', 'EUR', ['USD'])
  })

  it('returns the cached entry on a second call without hitting the provider', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(makePayload())

    const first = await getCurrencyRate({
      date: '2026-06-28',
      base: 'EUR',
      target: 'USD',
      fetchImpl: fetchImpl as never,
    })
    const second = await getCurrencyRate({
      date: '2026-06-28',
      base: 'EUR',
      target: 'USD',
      fetchImpl: fetchImpl as never,
    })

    expect(first).toEqual(second)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(currencyRateCacheSize()).toBe(1)
  })

  it('falls back to the provider latest-available rate for future dates and records the as-of date', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(makePayload({ date: '2026-06-26' }))

    const result = await getCurrencyRate({
      date: '2026-12-31',
      base: 'EUR',
      target: 'USD',
      fetchImpl: fetchImpl as never,
    })

    expect(result.rate).toBe(1.1401)
    expect(result.requestedDate).toBe('2026-12-31')
    expect(result.asOfDate).toBe('2026-06-26')
  })

  it('throws UnsupportedCurrencyError for an unsupported base', async () => {
    const fetchImpl = vi.fn()

    await expect(
      getCurrencyRate({
        date: '2026-06-28',
        base: 'ZZZ',
        target: 'USD',
        fetchImpl: fetchImpl as never,
      }),
    ).rejects.toBeInstanceOf(UnsupportedCurrencyError)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('throws UnsupportedCurrencyError for an unsupported target', async () => {
    const fetchImpl = vi.fn()

    await expect(
      getCurrencyRate({
        date: '2026-06-28',
        base: 'EUR',
        target: 'ZZZ',
        fetchImpl: fetchImpl as never,
      }),
    ).rejects.toBeInstanceOf(UnsupportedCurrencyError)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('throws CurrencyRateNotFoundError when the target is missing from the response', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(makePayload({ rates: { GBP: 0.86253 } }))

    await expect(
      getCurrencyRate({
        date: '2026-06-28',
        base: 'EUR',
        target: 'USD',
        fetchImpl: fetchImpl as never,
      }),
    ).rejects.toBeInstanceOf(CurrencyRateNotFoundError)
  })

  it('throws CurrencyRateProviderError on an invalid date string', async () => {
    const fetchImpl = vi.fn()

    await expect(
      getCurrencyRate({
        date: 'not-a-date',
        base: 'EUR',
        target: 'USD',
        fetchImpl: fetchImpl as never,
      }),
    ).rejects.toBeInstanceOf(CurrencyRateProviderError)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('caches different (base, target, date) triples independently', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(makePayload())

    await getCurrencyRate({
      date: '2026-06-28',
      base: 'EUR',
      target: 'USD',
      fetchImpl: fetchImpl as never,
    })
    await getCurrencyRate({
      date: '2026-06-28',
      base: 'EUR',
      target: 'GBP',
      fetchImpl: fetchImpl as never,
    })
    await getCurrencyRate({
      date: '2026-06-29',
      base: 'EUR',
      target: 'USD',
      fetchImpl: fetchImpl as never,
    })

    expect(fetchImpl).toHaveBeenCalledTimes(3)
    expect(currencyRateCacheSize()).toBe(3)
  })
})

describe('getCurrencyRates', () => {
  beforeEach(() => {
    clearCurrencyRateCache()
  })

  afterEach(() => {
    clearCurrencyRateCache()
  })

  it('resolves each item in the input order, even when some fail', async () => {
    const fetchImpl = vi
      .fn()
      .mockImplementation(async (date: string, base: string) =>
        makePayload({ base, date, rates: { USD: 1.1, GBP: 0.85 } }),
      )

    const results = await getCurrencyRates(
      [
        { date: '2026-06-28', base: 'EUR', target: 'USD' },
        { date: '2026-06-28', base: 'ZZZ', target: 'USD' },
        { date: '2026-06-28', base: 'EUR', target: 'GBP' },
      ],
      { fetchImpl: fetchImpl as never },
    )

    expect(results).toHaveLength(3)
    expect(results[0]).toMatchObject({ ok: true, rate: { rate: 1.1 } })
    expect(results[1]).toMatchObject({
      ok: false,
      error: { code: 'UNSUPPORTED_CURRENCY', currency: 'ZZZ' },
    })
    expect(results[2]).toMatchObject({ ok: true, rate: { rate: 0.85 } })
  })

  it('surfaces a RATE_NOT_FOUND error when the provider omits the target', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(makePayload({ rates: { GBP: 0.85 } }))

    const results = await getCurrencyRates(
      [{ date: '2026-06-28', base: 'EUR', target: 'USD' }],
      { fetchImpl: fetchImpl as never },
    )

    expect(results[0]).toMatchObject({
      ok: false,
      error: { code: 'RATE_NOT_FOUND', target: 'USD' },
    })
  })

  it('shares the underlying fetch across targets on the same (date, base) pair', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(makePayload({ rates: { USD: 1.1, GBP: 0.85 } }))

    await getCurrencyRates(
      [
        { date: '2026-06-28', base: 'EUR', target: 'USD' },
        { date: '2026-06-28', base: 'EUR', target: 'GBP' },
      ],
      { fetchImpl: fetchImpl as never },
    )

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(fetchImpl).toHaveBeenCalledWith('2026-06-28', 'EUR', ['USD', 'GBP'])
    expect(currencyRateCacheSize()).toBe(2)
  })
})
