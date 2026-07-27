import { z } from 'zod'

export const currencyRateSchema = z.object({
  rate: z.number(),
  requestedDate: z.string(),
  asOfDate: z.string(),
  base: z.string(),
  target: z.string(),
})

const currencyRateErrorSchema = z.discriminatedUnion('code', [
  z.object({ code: z.literal('UNSUPPORTED_CURRENCY'), currency: z.string() }),
  z.object({ code: z.literal('RATE_NOT_FOUND'), target: z.string() }),
  z.object({ code: z.literal('INVALID_DATE'), date: z.string() }),
  z.object({ code: z.literal('PROVIDER_ERROR'), message: z.string() }),
])

export const currencyRateResultSchema = z.union([
  z.object({
    ok: z.literal(true),
    rate: currencyRateSchema,
  }),
  z.object({
    ok: z.literal(false),
    error: currencyRateErrorSchema,
  }),
])

export const currencyRatesOutputSchema = z.object({
  results: z.array(currencyRateResultSchema),
})
