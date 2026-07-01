import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearCurrencyRateCache,
  type FrankfurterResponse,
} from '../lib/currency-rates'
import { postCurrencyRates } from './currency-rates'

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/currency/rates', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

function providerFixture(
  payload: FrankfurterResponse,
): (
  date: string,
  base: string,
  quotes?: string[],
) => Promise<FrankfurterResponse> {
  return vi.fn(async () => payload) as never
}

describe('postCurrencyRates', () => {
  beforeEach(() => {
    clearCurrencyRateCache()
  })

  afterEach(() => {
    clearCurrencyRateCache()
  })

  it('returns 400 when the body is not valid JSON', async () => {
    const response = await postCurrencyRates(makeRequest('not-json'))

    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.error).toBe('Invalid JSON body')
  })

  it('returns 400 when the body is missing the items array', async () => {
    const response = await postCurrencyRates(makeRequest({}))

    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.error).toBe('Invalid request')
    expect(Array.isArray(body.issues)).toBe(true)
  })

  it('returns 400 when items is an empty array', async () => {
    const response = await postCurrencyRates(makeRequest({ items: [] }))

    expect(response.status).toBe(400)
  })

  it('returns 400 when items exceeds the 500-item cap', async () => {
    const items = Array.from({ length: 501 }, () => ({
      date: '2026-06-28',
      base: 'EUR',
      target: 'USD',
    }))
    const response = await postCurrencyRates(makeRequest({ items }))

    expect(response.status).toBe(400)
  })

  it('returns 400 when a date is not in YYYY-MM-DD form', async () => {
    const response = await postCurrencyRates(
      makeRequest({
        items: [{ date: '06/28/2026', base: 'EUR', target: 'USD' }],
      }),
    )

    expect(response.status).toBe(400)
  })

  it('returns 400 when a currency code is shorter than 3 letters', async () => {
    const response = await postCurrencyRates(
      makeRequest({
        items: [{ date: '2026-06-28', base: 'EU', target: 'USD' }],
      }),
    )

    expect(response.status).toBe(400)
  })

  it('returns 400 when a currency code is longer than 3 letters', async () => {
    const response = await postCurrencyRates(
      makeRequest({
        items: [{ date: '2026-06-28', base: 'EURO', target: 'USD' }],
      }),
    )

    expect(response.status).toBe(400)
  })

  it('returns the parsed result for a valid single-item batch', async () => {
    const fetchImpl = providerFixture({
      base: 'EUR',
      date: '2026-06-28',
      rates: { USD: 1.1401 },
    })

    const response = await postCurrencyRates(
      makeRequest({
        items: [{ date: '2026-06-28', base: 'EUR', target: 'usd' }],
      }),
      { fetchImpl },
    )

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.results).toEqual([
      {
        ok: true,
        rate: {
          rate: 1.1401,
          requestedDate: '2026-06-28',
          asOfDate: '2026-06-28',
          base: 'EUR',
          target: 'USD',
        },
      },
    ])
    expect(fetchImpl).toHaveBeenCalledWith('2026-06-28', 'EUR', ['USD'])
  })

  it('surfaces a RATE_NOT_FOUND error for an item the provider omits', async () => {
    const fetchImpl = providerFixture({
      base: 'EUR',
      date: '2026-06-28',
      rates: { GBP: 0.86253 },
    })

    const response = await postCurrencyRates(
      makeRequest({
        items: [{ date: '2026-06-28', base: 'EUR', target: 'USD' }],
      }),
      { fetchImpl },
    )

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.results).toEqual([
      {
        ok: false,
        error: { code: 'RATE_NOT_FOUND', target: 'USD' },
      },
    ])
  })
})
