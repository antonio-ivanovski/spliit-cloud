import { z } from 'zod'

export const currencyRateProviderSchema = z.enum(['frankfurter', 'coinbase'])

export const currencyRateSourceSchema = z.object({
  provider: currencyRateProviderSchema,
  base: z.string(),
  target: z.string(),
})

export const currencyRateSchema = z.object({
  rate: z.number(),
  requestedDate: z.string(),
  asOfDate: z.string(),
  base: z.string(),
  target: z.string(),
  sources: z.array(currencyRateSourceSchema),
  via: z.array(z.string()).optional(),
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
