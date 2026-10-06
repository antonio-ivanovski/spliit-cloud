import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { clearCurrencyRateCache } from '../lib/currency-rates'
import type { FrankfurterResponse } from '../lib/fiat-rates'
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
          sources: [{ provider: 'frankfurter', base: 'EUR', target: 'USD' }],
        },
      },
    ])
    expect(fetchImpl).toHaveBeenCalledWith('2026-06-28', 'EUR', ['USD'])
  })
})
