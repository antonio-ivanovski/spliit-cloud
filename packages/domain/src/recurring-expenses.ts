import { z } from 'zod'
import {
  RecurrenceFrequency,
  RecurrenceRule,
  type RecurrenceFrequency as RecurrenceFrequencyType,
  type RecurrenceRule as RecurrenceRuleType,
} from './enums'

export const recurrenceFrequencySchema = z.enum([
  RecurrenceFrequency.DAILY,
  RecurrenceFrequency.WEEKLY,
  RecurrenceFrequency.MONTHLY,
  RecurrenceFrequency.YEARLY,
])

export const recurrenceEndSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('INDEFINITE') }),
  z.object({
    type: z.literal('COUNT'),
    count: z.number().int().min(1),
  }),
  z.object({
    type: z.literal('DATE'),
    endDate: z.coerce.date(),
  }),
])

export type RecurrenceEnd = z.infer<typeof recurrenceEndSchema>

export const recurrenceConfigSchema = z.object({
  frequency: recurrenceFrequencySchema,
  interval: z.number().int().min(1).max(99),
  end: recurrenceEndSchema,
})

export type RecurrenceConfig = z.infer<typeof recurrenceConfigSchema>

/** The JSON-safe shape persisted on a series for creating future occurrences. */
export type RecurringExpenseTemplate = {
  title: string
  categoryId: string
  amount: number
  originalAmount: number | null
  originalCurrency: string | null
  conversionRate: number | null
  conversionSource: 'EXCHANGE' | 'CUSTOM' | null
  paidBySplitMode: string
  paidByList: Array<{ ledgerParticipantId: string; shares: number }>
  paidFor: Array<{ ledgerParticipantId: string; shares: number }>
  splitMode: string
  isReimbursement: boolean
  notes: string | null
  items: Array<{
    title: string
    unitPrice: number
    quantity: number
    amount: number
    splitMode: string
    paidFor: Array<{ ledgerParticipantId: string; shares: number }>
  }>
  itemizedRemainder: {
    splitMode: string
    paidFor: Array<{ ledgerParticipantId: string; shares: number }>
  } | null
}

/**
 * Validate a recurrence config against its anchor. Date termination is
 * inclusive, so an end date equal to the anchor is valid and creates one row.
 */
export function validateRecurrenceConfig(
  config: RecurrenceConfig,
  anchorDate?: Date,
): RecurrenceConfig {
  const parsed = recurrenceConfigSchema.parse(config)
  if (anchorDate && parsed.end.type === 'DATE') {
    const anchor = toUtcDate(anchorDate).getTime()
    const end = toUtcDate(parsed.end.endDate).getTime()
    if (end < anchor) {
      throw new RangeError(
        'recurrence end date must not precede the anchor date',
      )
    }
  }
  return parsed
}

/**
 * Return the date for a 1-based occurrence number. Calendar recurrences are
 * anchored to the original date, so a clamped February does not move a March
 * occurrence away from the 31st.
 */
export function calculateRecurrenceDate(
  anchorDate: Date,
  frequency: RecurrenceFrequencyType,
  interval: number,
  occurrence: number,
): Date {
  if (!Number.isInteger(interval) || interval < 1 || interval > 99) {
    throw new RangeError('recurrence interval must be an integer from 1 to 99')
  }
  if (!Number.isInteger(occurrence) || occurrence < 1) {
    throw new RangeError('recurrence occurrence must be a positive integer')
  }

  const anchor = toUtcDate(anchorDate)
  const offset = occurrence - 1
  switch (frequency) {
    case RecurrenceFrequency.DAILY:
      anchor.setUTCDate(anchor.getUTCDate() + offset * interval)
      return anchor
    case RecurrenceFrequency.WEEKLY:
      anchor.setUTCDate(anchor.getUTCDate() + offset * interval * 7)
      return anchor
    case RecurrenceFrequency.MONTHLY:
      return addCalendarMonths(anchor, offset * interval, anchor.getUTCDate())
    case RecurrenceFrequency.YEARLY:
      return addCalendarYears(
        anchor,
        offset * interval,
        anchor.getUTCMonth(),
        anchor.getUTCDate(),
      )
  }
}

/** Return the first occurrence after `occurrence`, preserving the series anchor. */
export function calculateNextOccurrenceDate(
  anchorDate: Date,
  frequency: RecurrenceFrequencyType,
  interval: number,
  occurrence: number,
): Date {
  return calculateRecurrenceDate(
    anchorDate,
    frequency,
    interval,
    occurrence + 1,
  )
}

/**
 * Legacy helper retained while import compatibility is being removed. New
 * callers should use calculateRecurrenceDate with an explicit anchor/index.
 */
export function calculateNextDate(
  recurrenceRule: RecurrenceRuleType,
  priorDateToNextRecurrence: Date,
): Date {
  if (recurrenceRule === RecurrenceRule.NONE) {
    return new Date(priorDateToNextRecurrence)
  }
  return addOneInterval(priorDateToNextRecurrence, recurrenceRule)
}

function addOneInterval(date: Date, frequency: RecurrenceRuleType): Date {
  const normalized = toUtcDate(date)
  switch (frequency) {
    case RecurrenceRule.DAILY:
      normalized.setUTCDate(normalized.getUTCDate() + 1)
      return normalized
    case RecurrenceRule.WEEKLY:
      normalized.setUTCDate(normalized.getUTCDate() + 7)
      return normalized
    case RecurrenceRule.MONTHLY:
      return addCalendarMonths(normalized, 1, normalized.getUTCDate())
    case RecurrenceRule.YEARLY:
      return addCalendarYears(
        normalized,
        1,
        normalized.getUTCMonth(),
        normalized.getUTCDate(),
      )
    case RecurrenceRule.NONE:
      return normalized
  }
}

function toUtcDate(date: Date): Date {
  if (Number.isNaN(date.getTime()))
    throw new RangeError('invalid recurrence date')
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  )
}

function addCalendarMonths(
  anchor: Date,
  monthOffset: number,
  day: number,
): Date {
  const monthIndex = anchor.getUTCMonth() + monthOffset
  const year = anchor.getUTCFullYear() + Math.floor(monthIndex / 12)
  const month = ((monthIndex % 12) + 12) % 12
  return new Date(
    Date.UTC(year, month, Math.min(day, daysInMonth(year, month))),
  )
}

function addCalendarYears(
  anchor: Date,
  yearOffset: number,
  month: number,
  day: number,
): Date {
  const year = anchor.getUTCFullYear() + yearOffset
  return new Date(
    Date.UTC(year, month, Math.min(day, daysInMonth(year, month))),
  )
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
}
