import dayjs from 'dayjs'
import timezone from 'dayjs/plugin/timezone'
import utc from 'dayjs/plugin/utc'
import { z } from 'zod'

dayjs.extend(utc)
dayjs.extend(timezone)

export function isValidTimeZone(value: string): boolean {
  if (value.length === 0) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format()
    return true
  } catch {
    return false
  }
}

export const timeZoneSchema = z
  .string()
  .refine(isValidTimeZone, 'invalidTimeZone')

/**
 * Convert a date-only recurrence occurrence to 15:00 wall-clock time in an IANA
 * timezone, returned as an absolute UTC instant.
 *
 * Prisma DATE values are represented as Date objects at UTC midnight, so Date
 * inputs deliberately use their UTC calendar components rather than the
 * process-local timezone.
 */
export function occurrenceDateToUtcRunAt(
  occurrenceDate: Date | string,
  timeZone: string,
): Date {
  const dateOnly = normalizeDateOnly(occurrenceDate)
  const parsedTimeZone = timeZoneSchema.parse(timeZone)
  return dayjs.tz(`${dateOnly}T15:00:00`, parsedTimeZone).utc().toDate()
}

/**
 * Return the calendar date containing an instant in the requested timezone,
 * represented as a UTC-midnight Date suitable for Prisma DATE fields.
 */
export function dateOnlyInTimeZone(now: Date, timeZone: string): Date {
  if (Number.isNaN(now.getTime())) throw new RangeError('invalid instant')
  const parsedTimeZone = timeZoneSchema.parse(timeZone)
  const dateOnly = dayjs(now).tz(parsedTimeZone).format('YYYY-MM-DD')
  return new Date(`${dateOnly}T00:00:00.000Z`)
}

function normalizeDateOnly(value: Date | string): string {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime()))
      throw new RangeError('invalid occurrence date')
    return [
      value.getUTCFullYear().toString().padStart(4, '0'),
      (value.getUTCMonth() + 1).toString().padStart(2, '0'),
      value.getUTCDate().toString().padStart(2, '0'),
    ].join('-')
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new RangeError('occurrence date must use YYYY-MM-DD')
  }
  const parsed = new Date(`${value}T00:00:00.000Z`)
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  ) {
    throw new RangeError('invalid occurrence date')
  }
  return value
}
