import { z } from 'zod'
import {
  CurrencyRateNotFoundError,
  CurrencyRateProviderError,
  getCurrencyRate,
  UnsupportedCurrencyError,
} from '../../../lib/currency-rates'
import { baseProcedure, createTRPCRouter } from '../../init'

// `YYYY-MM-DD` (no time component). Frankfurter's date is the
// requested date for the rate, not a timestamp.
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

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
   */
  getRate: baseProcedure
    .input(
      z.object({
        date: dateSchema,
        base: z.string().min(3).max(3),
        target: z.string().min(3).max(3),
      }),
    )
    .query(async ({ input }) => {
      try {
        return await getCurrencyRate({
          date: input.date,
          base: input.base.toUpperCase(),
          target: input.target.toUpperCase(),
        })
      } catch (err) {
        if (err instanceof UnsupportedCurrencyError) {
          throw new Error(`Unsupported currency: ${err.message}`)
        }
        if (err instanceof CurrencyRateNotFoundError) {
          throw new Error(err.message)
        }
        if (err instanceof CurrencyRateProviderError) {
          throw new Error(`Failed to fetch exchange rate: ${err.message}`)
        }
        throw err
      }
    }),
})
