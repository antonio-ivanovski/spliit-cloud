import { z } from 'zod'

import { getCurrencyRates, type BatchRateResult } from '../lib/currency-rates'
import type { FrankfurterResponse } from '../lib/fiat-rates'

// `YYYY-MM-DD` (no time component). Frankfurter's date is the
// requested date for the rate, not a timestamp.
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
// ISO 4217 codes are 3 chars; crypto tickers can be 4 (e.g. DOGE).
const currencyCodeSchema = z.string().min(3).max(4)

const batchRateItem = z.object({
  date: dateSchema,
  base: currencyCodeSchema,
  target: currencyCodeSchema,
})

// POST keeps the payload out of the URL: a 500-item batch with the tRPC
// superjson envelope blows past typical 8 KB browser/server URL limits and
// trips HTTP 431 on Apache/Hono's default config.
const batchRateInput = z.object({
  items: z.array(batchRateItem).min(1).max(500),
})

/**
 * JSON shape returned to the client. Mirrors the previous tRPC
 * `currency.getRates` payload so callers can swap transports without changing
 * how they read the response.
 */
export type CurrencyRatesResponse = Array<
  | {
      ok: true
      rate: {
        rate: number
        requestedDate: string
        asOfDate: string
        base: string
        target: string
        sources: Array<{
          provider: 'frankfurter' | 'coinbase'
          base: string
          target: string
        }>
        via?: string[]
      }
    }
  | {
      ok: false
      error: Extract<BatchRateResult, { ok: false }>['error']
    }
>

function toResponse(results: BatchRateResult[]): CurrencyRatesResponse {
  return results.map((result) => {
    if (result.ok) {
      return { ok: true as const, rate: result.rate }
    }
    return { ok: false as const, error: result.error }
  })
}

/**
 * Bulk FX lookup. Accepts POST so the request body can carry up to 500 (date,
 * base, target) triples without hitting the URL length limit. Per-item failures
 * are returned alongside successes so the caller can block on a specific
 * offending expense without aborting the batch — the same contract the old tRPC
 * `currency.getRates` exposed.
 *
 * `fetchImpl`/`cryptoFetchImpl` are test-only and default to the live
 * providers; they let unit tests swap in a stub for the upstream calls.
 */
export async function postCurrencyRates(
  request: Request,
  options: {
    fetchImpl?: (
      date: string,
      base: string,
      quotes?: string[],
    ) => Promise<FrankfurterResponse>
    cryptoFetchImpl?: (
      date: string,
      base: string,
      target: string,
    ) => Promise<number | null>
  } = {},
) {
  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = batchRateInput.safeParse(raw)
  if (!parsed.success) {
    return Response.json(
      { error: 'Invalid request', issues: parsed.error.issues },
      { status: 400 },
    )
  }

  const results = await getCurrencyRates(
    parsed.data.items.map((item) => ({
      date: item.date,
      base: item.base.toUpperCase(),
      target: item.target.toUpperCase(),
    })),
    options.fetchImpl || options.cryptoFetchImpl
      ? {
          ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
          ...(options.cryptoFetchImpl
            ? { cryptoFetchImpl: options.cryptoFetchImpl }
            : {}),
        }
      : {},
  )

  return Response.json({ results: toResponse(results) })
}
