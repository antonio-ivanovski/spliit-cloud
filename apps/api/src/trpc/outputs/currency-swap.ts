import { z } from 'zod'

export const swapRateModeSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('historic') }),
  z.object({ type: z.literal('custom'), rate: z.number().positive() }),
])

/**
 * Per-pair rate mode, mirroring the group-import conversion step: each distinct
 * currency pair resolves rates per expense date, or at one fixed date (fetched)
 * with an optional typed override. Keyed by `BASE|TARGET`; absent pairs default
 * to perDate.
 */
export const swapPairModeSchema = z.union([
  z.object({ mode: z.literal('perDate') }),
  z.object({
    mode: z.literal('fixed'),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    override: z.number().positive().optional(),
  }),
])

export const swapRateModesSchema = z
  .record(z.string(), swapPairModeSchema)
  .default({})

export const swapPairSchema = z.object({
  base: z.string(),
  target: z.string(),
  dates: z.array(z.string()),
  expenseCount: z.number().int(),
})

export const swapPairsOutputSchema = z.object({
  oldCode: z.string(),
  newCode: z.string(),
  expenseCount: z.number().int(),
  pairs: z.array(swapPairSchema),
})

export const swapPreviewRowSchema = z.object({
  id: z.string(),
  expenseId: z.string(),
  title: z.string(),
  expenseDate: z.string(),
  kind: z.enum(['simple', 'cleared', 'fresh', 'bridged']),
  oldAmount: z.number().int(),
  newAmount: z.number().int(),
  newOriginalAmount: z.number().int().nullable(),
  newOriginalCurrency: z.string().nullable(),
  newConversionRate: z.number().nullable(),
  newConversionSource: z.enum(['EXCHANGE', 'CUSTOM', 'EXACT']).nullable(),
  rateUsed: z.number().nullable(),
  rateDate: z.string().nullable(),
  warning: z.string().optional(),
})

export const swapPreviewOutputSchema = z.object({
  oldCode: z.string(),
  newCode: z.string(),
  expenseCount: z.number().int(),
  truncated: z.boolean(),
  rows: z.array(swapPreviewRowSchema),
  missingRateCount: z.number().int(),
  sumOld: z.number().int(),
  sumNew: z.number().int(),
  budgetCount: z.number().int().default(0),
  activeRecurringCount: z.number().int().default(0),
  warnings: z.array(z.string()).default([]),
})

export const swapExecuteOutputSchema = z.object({
  updated: z.number().int(),
  newCode: z.string(),
})
