import { Effect } from 'effect'

import {
  computeSwapRateKeys,
  planSwapRows,
  type PlannedSwapRow,
  type SwapExpenseInput,
  type SwapRateModes,
} from '@spliit/domain'

import { FxRateService } from '../fx/service'
import { SwapRateError, SwapValidationError } from './errors'

export type SwapPlanOptions = {
  oldCode: string
  newCode: string
  /** Per-pair modes keyed by `BASE|TARGET`; absent pair = perDate default. */
  modes?: SwapRateModes
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

const validatePlanOptionsEffect = (
  options: SwapPlanOptions,
): Effect.Effect<void, SwapValidationError> =>
  Effect.gen(function* () {
    const oldCode = options.oldCode.toUpperCase()
    const newCode = options.newCode.toUpperCase()
    if (!oldCode || !newCode) {
      return yield* new SwapValidationError({
        reason: 'Both current and target currencies are required',
      })
    }
    if (oldCode === newCode) {
      return yield* new SwapValidationError({
        reason: 'Target currency must differ from the current group currency',
      })
    }
    for (const [pair, mode] of Object.entries(options.modes ?? {})) {
      if (mode.mode === 'fixed') {
        if (!ISO_DATE_RE.test(mode.date)) {
          return yield* new SwapValidationError({
            reason: `Invalid fixed-rate date for pair ${pair}`,
          })
        }
        if (
          mode.override !== undefined &&
          !(mode.override > 0 && Number.isFinite(mode.override))
        ) {
          return yield* new SwapValidationError({
            reason: `Fixed-rate override for pair ${pair} must be positive`,
          })
        }
      }
    }
  })

/**
 * Batch-fetch the provider rates for a swap plan through `FxRateService`.
 * Whole-batch transport failures retry per the FX policy; per-key misses
 * resolve as absent map entries so `planSwapRows` marks rows with
 * `missing-rate` instead of failing the whole preview.
 */
export const fetchSwapRatesEffect = Effect.fnUntraced(function* (
  keys: Array<{ date: string; base: string; target: string }>,
): Effect.fn.Return<
  { rates: Record<string, number>; fallbackKeys: string[] },
  SwapRateError,
  FxRateService
> {
  if (keys.length === 0) return { rates: {}, fallbackKeys: [] }
  const fx = yield* FxRateService
  const { rates, fallbackKeys } = yield* fx.getRates(keys).pipe(
    Effect.mapError(
      (cause) =>
        new SwapRateError({
          reason: cause.message,
          missingKeys: keys.map((k) => `${k.date}|${k.base}|${k.target}`),
        }),
    ),
  )
  return { rates, fallbackKeys }
})

export type SwapPreview = {
  oldCode: string
  newCode: string
  rows: PlannedSwapRow[]
  missingRateCount: number
  sumOld: number
  sumNew: number
}

/**
 * Pure planning step shared by preview and execute: validate, fetch the batch
 * rates once through the FX service, then plan every row with the domain
 * `planSwapRows`. Runs once at the tRPC boundary via `Effect.runPromise` with
 * `FxLive` provided; the procedure maps tagged errors to stable TRPC codes.
 */
export const planSwapPreviewEffect = Effect.fnUntraced(function* (
  expenses: SwapExpenseInput[],
  options: SwapPlanOptions,
): Effect.fn.Return<
  SwapPreview,
  SwapValidationError | SwapRateError,
  FxRateService
> {
  yield* validatePlanOptionsEffect(options)
  const oldCode = options.oldCode.toUpperCase()
  const newCode = options.newCode.toUpperCase()

  const keys = computeSwapRateKeys(expenses, oldCode, newCode, options.modes)
  const { rates: ratesByKey, fallbackKeys } = yield* fetchSwapRatesEffect(keys)
  const rows = planSwapRows(
    expenses,
    oldCode,
    newCode,
    options.modes,
    ratesByKey,
    new Set(fallbackKeys),
  )
  const { sumOld, sumNew, missingRateCount } = rows.reduce(
    (acc, row) => ({
      sumOld: acc.sumOld + row.oldAmount,
      sumNew: acc.sumNew + row.newAmount,
      missingRateCount:
        acc.missingRateCount + (row.warning === 'missing-rate' ? 1 : 0),
    }),
    { sumOld: 0, sumNew: 0, missingRateCount: 0 },
  )
  return { oldCode, newCode, rows, missingRateCount, sumOld, sumNew }
})

export function toSwapExpenseInput(row: {
  id: string
  expenseDate: Date | string
  amount: number
  originalAmount: number | null
  originalCurrency: string | null
  conversionRate: number | null
  conversionSource: 'EXCHANGE' | 'CUSTOM' | 'EXACT' | null
}): SwapExpenseInput {
  // Invalid Dates must never throw here (RangeError from toISOString) and
  // never become bogus lookup keys: empty dates resolve as provider misses
  // and surface as `missing-rate` rows downstream.
  const date =
    row.expenseDate instanceof Date
      ? Number.isNaN(row.expenseDate.getTime())
        ? ''
        : row.expenseDate.toISOString().slice(0, 10)
      : String(row.expenseDate ?? '').slice(0, 10)
  return {
    id: row.id,
    expenseDate: date,
    amount: row.amount,
    originalAmount: row.originalAmount,
    originalCurrency: row.originalCurrency,
    conversionRate: row.conversionRate,
    conversionSource: row.conversionSource,
  }
}
