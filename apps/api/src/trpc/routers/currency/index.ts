import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import {
  getCurrencyRates,
  type BatchRateResult,
} from '../../../lib/currency-rates'
import { baseProcedure, createTRPCRouter } from '../../init'

// `YYYY-MM-DD` (no time component). Frankfurter's date is the
// requested date for the rate, not a timestamp.
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const currencyCodeSchema = z.string().min(3).max(3)

const singleRateInput = z.object({
  date: dateSchema,
  base: currencyCodeSchema,
  target: currencyCodeSchema,
})

/**
 * Translate a `BatchRateResult` error into a tRPC error with a stable code
 * the client can switch on. The shape is preserved so the caller can
 * decide whether to surface `currency`/`target`/`date` to the user.
 */
function raiseBatchError(
  err: Extract<BatchRateResult, { ok: false }>['error'],
) {
  switch (err.code) {
    case 'UNSUPPORTED_CURRENCY':
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Unsupported currency code: ${err.currency}`,
      })
    case 'RATE_NOT_FOUND':
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: `No rate available for target ${err.target}`,
      })
    case 'INVALID_DATE':
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Invalid date: ${err.date}`,
      })
    case 'PROVIDER_ERROR':
      throw new TRPCError({
        code: 'BAD_GATEWAY',
        message: err.message,
      })
  }
}

export const currencyRouter = createTRPCRouter({
  /**
   * Preview exchange rate for the expense form. The API fetches the rate
   * from Frankfurter server-side and caches it in-memory, which lets the
   * browser keep making direct XHR calls (no CORS dance with the
   * upstream) and avoids hammering the provider for repeated form
   * interactions.
   *
   * Returns the rate and both the requested and as-of dates so the
   * client can show a warning when the as-of differs from the
   * requested date (e.g. weekend or future date fallback).
   *
   * Bulk lookups for the import wizard are handled by the POST
   * `/currency/rates` endpoint rather than this tRPC procedure — the
   * superjson-enveloped batch URL blew past 8 KB on large imports and
   * tripped HTTP 431.
   */
  getRate: baseProcedure.input(singleRateInput).query(async ({ input }) => {
    const [result] = await getCurrencyRates([
      {
        date: input.date,
        base: input.base.toUpperCase(),
        target: input.target.toUpperCase(),
      },
    ])
    // Result is always present (one input → one result). Treat both
    // the success and the impossible `undefined` branches as success
    // for type-narrowing purposes; failures throw.
    if (!result || result.ok) {
      return result?.rate
    }
    raiseBatchError(result.error)
  }),
})
