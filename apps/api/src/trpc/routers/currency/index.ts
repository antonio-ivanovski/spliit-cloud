import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import {
  getCurrencyRates,
  type BatchRateRequest,
  type BatchRateResult,
} from '../../../lib/currency-rates'
import { baseProcedure, createTRPCRouter, protectedProcedure } from '../../init'
import {
  currencyRateSchema,
  currencyRatesOutputSchema,
} from '../../outputs/currency'

// `YYYY-MM-DD` (no time component). Frankfurter's date is the
// requested date for the rate, not a timestamp.
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const currencyCodeSchema = z.string().min(3).max(3)

const singleRateInput = z.object({
  date: dateSchema,
  base: currencyCodeSchema,
  target: currencyCodeSchema,
})

const batchRateItemInput = z.object({
  date: dateSchema,
  base: currencyCodeSchema,
  target: currencyCodeSchema,
})

const batchRateInput = z.object({
  items: z.array(batchRateItemInput).min(1).max(500),
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
  /** Public: single FX rate for a date from the Frankfurter provider. */
  getRate: baseProcedure
    .input(singleRateInput)
    .output(currencyRateSchema.optional())
    .query(async ({ input }) => {
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

  /** Bulk-fetch up to 500 FX rates in one call. */
  rates: protectedProcedure
    .input(batchRateInput)
    .output(currencyRatesOutputSchema)
    .mutation(async ({ input }) => {
      const items: BatchRateRequest[] = input.items.map((item) => ({
        date: item.date,
        base: item.base.toUpperCase(),
        target: item.target.toUpperCase(),
      }))
      const results = await getCurrencyRates(items)
      return { results }
    }),
})
