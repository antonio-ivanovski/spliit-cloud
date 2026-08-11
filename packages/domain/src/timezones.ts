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

export const timeMinutesSchema = z.number().int().min(0).max(1439)

export function wallTimeToUtc(
  dateIso: string,
  timeMinutes: number,
  timeZone: string,
): Date {
  const dateOnly = normalizeDateOnly(dateIso)
  if (!Number.isInteger(timeMinutes) || timeMinutes < 0 || timeMinutes > 1439) {
    throw new RangeError('timeMinutes must be an integer 0..1439')
  }
  const parsedTimeZone = timeZoneSchema.parse(timeZone)
  const hh = String(Math.floor(timeMinutes / 60)).padStart(2, '0')
  const mm = String(timeMinutes % 60).padStart(2, '0')
  const candidate = dayjs.tz(`${dateOnly}T${hh}:${mm}:00`, parsedTimeZone)
  if (!isValidWallTime(dateIso, timeMinutes, timeZone)) {
    throw new RangeError(
      `Time ${hh}:${mm} does not exist on ${dateOnly} in ${parsedTimeZone}`,
    )
  }
  return candidate.utc().toDate()
}

/**
 * Convert a recurring wall time to an instant using timezone-compatible DST
 * disambiguation. Valid wall times are identical to `wallTimeToUtc`; a time in
 * a spring-forward gap is shifted forward by the size of that gap for this
 * occurrence only. The stored recurrence anchor remains unchanged.
 */
export function recurringWallTimeToUtc(
  dateIso: string,
  timeMinutes: number,
  timeZone: string,
): Date {
  const dateOnly = normalizeDateOnly(dateIso)
  if (!Number.isInteger(timeMinutes) || timeMinutes < 0 || timeMinutes > 1439) {
    throw new RangeError('timeMinutes must be an integer 0..1439')
  }
  const parsedTimeZone = timeZoneSchema.parse(timeZone)
  const hh = String(Math.floor(timeMinutes / 60)).padStart(2, '0')
  const mm = String(timeMinutes % 60).padStart(2, '0')
  return dayjs.tz(`${dateOnly}T${hh}:${mm}:00`, parsedTimeZone).utc().toDate()
}

export function utcToWallTime(
  instant: Date,
  timeZone: string,
): { dateIso: string; timeMinutes: number } {
  if (Number.isNaN(instant.getTime())) throw new RangeError('invalid instant')
  const parsedTimeZone = timeZoneSchema.parse(timeZone)
  const zoned = dayjs(instant).tz(parsedTimeZone)
  const dateIso = zoned.format('YYYY-MM-DD')
  const timeMinutes = zoned.hour() * 60 + zoned.minute()
  return { dateIso, timeMinutes }
}

export function formatTimeMinutes(timeMinutes: number): string {
  if (!Number.isInteger(timeMinutes) || timeMinutes < 0 || timeMinutes > 1439) {
    throw new RangeError('timeMinutes must be an integer 0..1439')
  }
  const hh = String(Math.floor(timeMinutes / 60)).padStart(2, '0')
  const mm = String(timeMinutes % 60).padStart(2, '0')
  return `${hh}:${mm}`
}

export function parseTimeMinutes(value: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim())
  if (!m) throw new RangeError('time must be HH:mm')
  const h = Number(m[1])
  const min = Number(m[2])
  if (h < 0 || h > 23 || min < 0 || min > 59)
    throw new RangeError('invalid time')
  return h * 60 + min
}

export function isValidWallTime(
  dateIso: string,
  timeMinutes: number,
  timeZone: string,
): boolean {
  const dateOnly = normalizeDateOnly(dateIso)
  if (!Number.isInteger(timeMinutes) || timeMinutes < 0 || timeMinutes > 1439)
    return false
  if (!isValidTimeZone(timeZone)) return false
  const hh = String(Math.floor(timeMinutes / 60)).padStart(2, '0')
  const mm = String(timeMinutes % 60).padStart(2, '0')
  const zoned = dayjs.tz(`${dateOnly}T${hh}:${mm}:00`, timeZone)
  return (
    zoned.format('YYYY-MM-DD') === dateOnly &&
    zoned.format('HH:mm') === `${hh}:${mm}`
  )
}

/** True when the local calendar day contains a spring-forward clock gap. */
export function hasWallTimeGap(dateIso: string, timeZone: string): boolean {
  const dateOnly = normalizeDateOnly(dateIso)
  const parsedTimeZone = timeZoneSchema.parse(timeZone)
  const date = new Date(`${dateOnly}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + 1)
  const nextDate = date.toISOString().slice(0, 10)
  const startOffset = dayjs
    .tz(`${dateOnly}T00:00:00`, parsedTimeZone)
    .utcOffset()
  const nextOffset = dayjs
    .tz(`${nextDate}T00:00:00`, parsedTimeZone)
    .utcOffset()
  return nextOffset > startOffset
}

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
  timeMinutes = 15 * 60,
): Date {
  const dateOnly = normalizeDateOnly(occurrenceDate)
  return recurringWallTimeToUtc(dateOnly, timeMinutes, timeZone)
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

export function wallDateOnlyIso(instant: Date, timeZone: string): string {
  return utcToWallTime(instant, timeZone).dateIso
}

export function timeZoneCityLabel(timeZone: string): string {
  if (timeZone === 'UTC') return 'UTC'
  const last = timeZone.split('/').at(-1) ?? timeZone
  return last.replaceAll('_', ' ')
}

export function timeZoneOffsetLabel(
  timeZone: string,
  at: Date = new Date(),
): string {
  try {
    const part = new Intl.DateTimeFormat('en-US', {
      timeZone,
      timeZoneName: 'longOffset',
    })
      .formatToParts(at)
      .find((p) => p.type === 'timeZoneName')?.value
    if (!part || part === 'GMT') return 'GMT+00:00'
    return part
  } catch {
    return 'GMT+00:00'
  }
}

export function timeZoneCityOffsetLabel(
  timeZone: string,
  at: Date = new Date(),
): string {
  return `${timeZoneCityLabel(timeZone)} · ${timeZoneOffsetLabel(timeZone, at)}`
}

export function formatExpenseWallDateTime(
  instant: Date,
  timeZone: string,
  locale: string,
): { date: string; time: string; cityOffset: string } {
  const d = new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeZone,
  }).format(instant)
  const t = new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
    hour12: false,
  }).format(instant)
  return {
    date: d,
    time: t,
    cityOffset: timeZoneCityOffsetLabel(timeZone, instant),
  }
}

export function orderTimeOptionsNearestFirst(
  nowMinutes: number,
  stepMinutes = 15,
): string[] {
  const grid: number[] = []
  for (let m = 0; m < 1440; m += stepMinutes) grid.push(m)
  const idx = grid.findIndex((m) => m >= nowMinutes)
  const start = idx === -1 ? 0 : idx
  const out: number[] = []
  for (let i = 0; i < grid.length; i++)
    out.push(grid[(start + i) % grid.length]!)
  return out.map(formatTimeMinutes)
}

export function normalizeDateOnly(value: Date | string): string {
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
