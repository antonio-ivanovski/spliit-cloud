import { z } from 'zod'

import { categoryIdSchema } from './categories'
import { type RecurrenceFrequency } from './enums'
import {
  calculateRecurrenceDate,
  recurrenceFrequencySchema,
} from './recurring-expenses'

export const PersonalRecurringEndType = {
  INDEFINITE: 'INDEFINITE',
  COUNT: 'COUNT',
  DATE: 'DATE',
} as const

export type PersonalRecurringEndType =
  (typeof PersonalRecurringEndType)[keyof typeof PersonalRecurringEndType]

const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'invalidDate')
  .refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`)
    return (
      !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
    )
  }, 'invalidDate')

export const personalRecurringFrequencySchema = recurrenceFrequencySchema

export const personalRecurringEndInputSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('INDEFINITE') }),
  z.object({
    type: z.literal('COUNT'),
    count: z.number().int().min(1).max(10_000),
  }),
  z.object({ type: z.literal('DATE'), endDate: isoDateSchema }),
])

export type PersonalRecurringEndInput = z.infer<
  typeof personalRecurringEndInputSchema
>

const titleSchema = z.string().trim().max(200).optional()
const noteSchema = z.string().trim().max(2_000).optional()

function categoryAllowedForKind(
  kind: 'EXPENSE' | 'INCOME',
  categoryId: string,
): boolean {
  if (categoryId === 'settlement') return false
  if (kind === 'EXPENSE' && categoryId === 'income') return false
  return true
}

export const personalRecurringCreateSchema = z
  .object({
    frequency: personalRecurringFrequencySchema,
    interval: z.number().int().min(1).max(99),
    anchorDate: isoDateSchema,
    end: personalRecurringEndInputSchema.default({ type: 'INDEFINITE' }),
    kind: z.enum(['EXPENSE', 'INCOME']).default('EXPENSE'),
    amount: z.number().int().positive().max(2_147_483_647),
    categoryId: categoryIdSchema.default('general'),
    title: titleSchema,
    note: noteSchema,
  })
  .superRefine((value, ctx) => {
    if (!categoryAllowedForKind(value.kind, value.categoryId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['categoryId'],
        message:
          value.categoryId === 'settlement'
            ? 'Settlements cannot be recorded as personal income or expenses'
            : 'The income category is only valid for income entries',
      })
    }
    if (value.end.type === 'DATE' && value.end.endDate < value.anchorDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['end'],
        message: 'recurrence end date must not precede the anchor date',
      })
    }
  })

export type PersonalRecurringCreate = z.infer<
  typeof personalRecurringCreateSchema
>

export const personalRecurringUpdateSchema = z
  .object({
    kind: z.enum(['EXPENSE', 'INCOME']).optional(),
    amount: z.number().int().positive().max(2_147_483_647).optional(),
    categoryId: categoryIdSchema.optional(),
    title: z.string().trim().max(200).nullable().optional(),
    note: z.string().trim().max(2_000).nullable().optional(),
    end: personalRecurringEndInputSchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.categoryId !== undefined) {
      // Without a kind change the stored kind decides; with a kind change the
      // new kind decides. The API passes the effective kind for full checks.
      if (value.categoryId === 'settlement') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['categoryId'],
          message:
            'Settlements cannot be recorded as personal income or expenses',
        })
      }
    }
    if (value.kind === 'EXPENSE' && value.categoryId === 'income') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['categoryId'],
        message: 'The income category is only valid for income entries',
      })
    }
  })

export type PersonalRecurringUpdate = z.infer<
  typeof personalRecurringUpdateSchema
>

export function resolvePersonalRecurringCategory(
  kind: 'EXPENSE' | 'INCOME',
  categoryId: string,
): string {
  if (categoryId === 'settlement') {
    throw new RangeError(
      'Settlements cannot be recorded as personal income or expenses',
    )
  }
  if (kind === 'INCOME') {
    return categoryId === 'general' ? 'income' : categoryId
  }
  if (categoryId === 'income') {
    throw new RangeError('The income category is only valid for income entries')
  }
  return categoryId
}

export function validatePersonalRecurringUpdateCategory(
  effectiveKind: 'EXPENSE' | 'INCOME',
  categoryId: string | undefined,
): void {
  if (categoryId === undefined) return
  resolvePersonalRecurringCategory(effectiveKind, categoryId)
}

export function toPersonalRecurringSeriesFields(
  end: PersonalRecurringEndInput,
  anchorDateIso: string,
  occurrencesCreated = 0,
): {
  endType: (typeof PersonalRecurringEndType)[keyof typeof PersonalRecurringEndType]
  occurrenceLimit: number | null
  endDate: Date | null
} {
  const anchor = new Date(`${anchorDateIso}T00:00:00.000Z`)
  if (Number.isNaN(anchor.getTime()))
    throw new RangeError('invalid anchor date')
  if (end.type === 'COUNT') {
    if (end.count < occurrencesCreated) {
      throw new RangeError(
        'recurrence count must exceed the number of created occurrences',
      )
    }
    return {
      endType: PersonalRecurringEndType.COUNT,
      occurrenceLimit: end.count,
      endDate: null,
    }
  }
  if (end.type === 'DATE') {
    const endDate = new Date(`${end.endDate}T00:00:00.000Z`)
    if (Number.isNaN(endDate.getTime()))
      throw new RangeError('invalid recurrence end date')
    if (endDate.getTime() < anchor.getTime()) {
      throw new RangeError(
        'recurrence end date must not precede the anchor date',
      )
    }
    return {
      endType: PersonalRecurringEndType.DATE,
      occurrenceLimit: null,
      endDate,
    }
  }
  return {
    endType: PersonalRecurringEndType.INDEFINITE,
    occurrenceLimit: null,
    endDate: null,
  }
}

export type PersonalRecurringSeriesLike = {
  anchorDate: Date | string
  frequency: (typeof RecurrenceFrequency)[keyof typeof RecurrenceFrequency]
  interval: number
  endType: (typeof PersonalRecurringEndType)[keyof typeof PersonalRecurringEndType]
  occurrenceLimit: number | null
  endDate: Date | string | null
  nextOccurrenceOrdinal: number
  timeZone: string
  /**
   * Materialized rows so far. `occurrenceLimit` (COUNT) bounds this count, not
   * the slot ordinal: skips advance `nextOccurrenceOrdinal` without consuming
   * COUNT budget.
   */
  occurrencesCreated: number
}

export type PersonalRecurringOccurrence = {
  sequence: number
  date: Date
  dateIso: string
  overdue: boolean
}

function toUtcDateOnly(value: Date | string): Date {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime()))
      throw new RangeError('invalid recurrence date')
    return new Date(
      Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()),
    )
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new RangeError('occurrence date must use YYYY-MM-DD')
  }
  const parsed = new Date(`${value}T00:00:00.000Z`)
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  ) {
    throw new RangeError('invalid recurrence date')
  }
  return parsed
}

function toIsoDay(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function seriesEndDateOnly(series: PersonalRecurringSeriesLike): Date | null {
  if (series.endType !== PersonalRecurringEndType.DATE) return null
  if (series.endDate === null) return null
  return toUtcDateOnly(series.endDate)
}

/**
 * Pure read-only projection of future occurrences. Starts at
 * `nextOccurrenceOrdinal` (the next unwritten slot), walks the anchor with
 * `calculateRecurrenceDate`, and stops at `to`/`limit`/COUNT/DATE bounds.
 * `overdue` compares each date against the series-local today supplied via
 * `dateOnlyInTimeZone`. No Prisma, no writes.
 *
 * COUNT semantics (group parity): `occurrenceLimit` counts materialized rows
 * (`occurrencesCreated`), not calendar slots. Skipped slots advance the ordinal
 * without consuming budget, so the projection emits up to `occurrenceLimit -
 * occurrencesCreated` rows starting from the cursor.
 */
export function projectPersonalRecurringOccurrences(args: {
  series: PersonalRecurringSeriesLike
  from?: Date | string
  to?: Date | string
  limit?: number
  now: Date
  dateOnlyInTimeZone: (now: Date, timeZone: string) => Date
}): PersonalRecurringOccurrence[] {
  const { series, now, dateOnlyInTimeZone } = args
  if (Number.isNaN(now.getTime())) throw new RangeError('invalid now')
  if (
    !Number.isInteger(series.interval) ||
    series.interval < 1 ||
    series.interval > 99
  ) {
    throw new RangeError('recurrence interval must be an integer from 1 to 99')
  }
  if (
    !Number.isInteger(series.nextOccurrenceOrdinal) ||
    series.nextOccurrenceOrdinal < 1
  ) {
    throw new RangeError('recurrence ordinal must be a positive integer')
  }
  const created = (series as { occurrencesCreated?: unknown })
    .occurrencesCreated
  const occurrencesCreated = created === undefined ? 0 : (created as number)
  if (
    created !== undefined &&
    (!Number.isInteger(occurrencesCreated) || occurrencesCreated < 0)
  ) {
    throw new RangeError('created occurrences must be a non-negative integer')
  }
  const limit = args.limit ?? 100
  if (!Number.isInteger(limit) || limit < 1 || limit > 366) {
    throw new RangeError('projection limit must be an integer from 1 to 366')
  }
  const anchor = toUtcDateOnly(series.anchorDate)
  const from = args.from ? toUtcDateOnly(args.from) : null
  const to = args.to ? toUtcDateOnly(args.to) : null
  const endDate = seriesEndDateOnly(series)
  if (
    series.endType === PersonalRecurringEndType.COUNT &&
    series.occurrenceLimit !== null &&
    (!Number.isInteger(series.occurrenceLimit) || series.occurrenceLimit < 1)
  ) {
    throw new RangeError('recurrence count must be a positive integer')
  }
  const todayLocal = toUtcDateOnly(dateOnlyInTimeZone(now, series.timeZone))

  // COUNT bounds materialized rows, not slots.
  if (
    series.endType === PersonalRecurringEndType.COUNT &&
    series.occurrenceLimit !== null &&
    occurrencesCreated >= series.occurrenceLimit
  ) {
    return []
  }
  const countRemaining =
    series.endType === PersonalRecurringEndType.COUNT &&
    series.occurrenceLimit !== null
      ? series.occurrenceLimit - occurrencesCreated
      : null

  const out: PersonalRecurringOccurrence[] = []
  let ordinal = series.nextOccurrenceOrdinal
  // Arithmetic fast-forward for DAILY/WEEKLY: a far-future `from` would
  // otherwise walk one slot at a time and exhaust the iteration cap.
  if (from) {
    const cursorDate = calculateRecurrenceDate(
      anchor,
      series.frequency,
      series.interval,
      ordinal,
    )
    if (cursorDate.getTime() < from.getTime()) {
      const stepDays =
        series.frequency === 'DAILY'
          ? series.interval
          : series.frequency === 'WEEKLY'
            ? series.interval * 7
            : null
      if (stepDays !== null) {
        const diffDays = Math.floor(
          (from.getTime() - cursorDate.getTime()) / 86_400_000,
        )
        const jump = Math.floor(diffDays / stepDays)
        if (jump > 0) ordinal += jump
      }
    }
  }
  // Guard indefinite walks: `limit` already caps output, but `from` skipping
  // must not spin forever when `to` is far away.
  let iterations = 0
  const maxIterations = limit + 366 + 10
  const effectiveLimit =
    countRemaining !== null ? Math.min(limit, countRemaining) : limit
  while (out.length < effectiveLimit && iterations < maxIterations) {
    iterations += 1
    const date = calculateRecurrenceDate(
      anchor,
      series.frequency,
      series.interval,
      ordinal,
    )
    if (endDate && date.getTime() > endDate.getTime()) break
    if (to && date.getTime() > to.getTime()) break
    if (!from || date.getTime() >= from.getTime()) {
      out.push({
        sequence: ordinal,
        date,
        dateIso: toIsoDay(date),
        overdue: date.getTime() <= todayLocal.getTime(),
      })
    }
    ordinal += 1
  }
  return out
}

/**
 * Cursor math for resume/skip-next: move the cursor past every occurrence on or
 * before the series-local `today` (already a UTC-midnight date). Returns the
 * first future ordinal/date plus how many were skipped. Pure and non-mutating;
 * DATE bounds stop the walk so callers can complete the series instead of
 * advancing past its end. COUNT never stops this walk: `occurrenceLimit` counts
 * materialized rows (`occurrencesCreated`), not slots, so skipped slots do not
 * consume budget — callers complete on `occurrencesCreated >= occurrenceLimit`
 * instead.
 */
export function advancePastOverdue(args: {
  anchorDate: Date | string
  frequency: (typeof RecurrenceFrequency)[keyof typeof RecurrenceFrequency]
  interval: number
  nextOccurrenceOrdinal: number
  timeZone: string
  today: Date | string
  endType?: (typeof PersonalRecurringEndType)[keyof typeof PersonalRecurringEndType]
  occurrenceLimit?: number | null
  endDate?: Date | string | null
}): {
  nextOccurrenceOrdinal: number
  nextOccurrenceDate: Date
  skipped: number
} {
  const anchor = toUtcDateOnly(args.anchorDate)
  const today = toUtcDateOnly(args.today)
  if (
    !Number.isInteger(args.interval) ||
    args.interval < 1 ||
    args.interval > 99
  ) {
    throw new RangeError('recurrence interval must be an integer from 1 to 99')
  }
  if (
    !Number.isInteger(args.nextOccurrenceOrdinal) ||
    args.nextOccurrenceOrdinal < 1
  ) {
    throw new RangeError('recurrence ordinal must be a positive integer')
  }
  void args.timeZone
  const endType = args.endType ?? PersonalRecurringEndType.INDEFINITE
  void args.occurrenceLimit
  const endDate =
    endType === PersonalRecurringEndType.DATE && args.endDate
      ? toUtcDateOnly(args.endDate)
      : null

  let ordinal = args.nextOccurrenceOrdinal
  let date = calculateRecurrenceDate(
    anchor,
    args.frequency,
    args.interval,
    ordinal,
  )
  let skipped = 0
  // Arithmetic jump for DAILY/WEEKLY: a years-overdue cursor would otherwise
  // hit the iteration cap and leave the cursor overdue, causing backfill on
  // resume. Jump whole steps so the cursor lands on/after today, then walk
  // the tail (MONTHLY/YEARLY and edge alignment).
  if (date.getTime() < today.getTime()) {
    const stepDays =
      args.frequency === 'DAILY'
        ? args.interval
        : args.frequency === 'WEEKLY'
          ? args.interval * 7
          : null
    if (stepDays !== null) {
      const diffDays = Math.floor(
        (today.getTime() - date.getTime()) / 86_400_000,
      )
      const jump = Math.floor(diffDays / stepDays)
      if (jump > 0) {
        ordinal += jump
        skipped += jump
        date = calculateRecurrenceDate(
          anchor,
          args.frequency,
          args.interval,
          ordinal,
        )
      }
    }
  }
  // Bound the tail walk: daily overdue backlogs could otherwise spin for
  // years. Only dates strictly before `today` are skipped; today's occurrence
  // stays due so resume enqueues it instead of silently dropping a charge
  // owed today.
  let guard = 0
  while (guard < 3_100) {
    guard += 1
    if (endDate && date.getTime() > endDate.getTime()) break
    if (date.getTime() >= today.getTime()) break
    ordinal += 1
    skipped += 1
    date = calculateRecurrenceDate(
      anchor,
      args.frequency,
      args.interval,
      ordinal,
    )
  }
  return { nextOccurrenceOrdinal: ordinal, nextOccurrenceDate: date, skipped }
}
