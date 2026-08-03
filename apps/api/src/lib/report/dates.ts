const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Parse an inclusive `YYYY-MM-DD` report bound into a UTC midnight Date. Throws
 * on non-ISO or invalid calendar dates.
 */
export function parseReportDate(value: string): Date {
  if (!ISO_DATE_RE.test(value)) {
    throw new Error(`Invalid report date: ${value}`)
  }
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error(`Invalid report date: ${value}`)
  }
  return date
}

/** Format a Date as `YYYY-MM-DD` in UTC. */
export function formatIsoDate(date: Date): string {
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/** UTC midnight of today, used when no browser time zone is available. */
export function todayUtc(): Date {
  const now = new Date()
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  )
}

/**
 * Return today's calendar date at midnight UTC for a browser-provided IANA time
 * zone. Invalid or missing zones fall back to UTC rather than preventing the
 * report dialog from opening.
 */
export function todayInTimeZone(timeZone?: string, now = new Date()): Date {
  if (!timeZone) return todayUtc()

  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(now)
    const values = Object.fromEntries(
      parts
        .filter((part) => part.type !== 'literal')
        .map((part) => [part.type, part.value]),
    )
    return parseReportDate(`${values.year}-${values.month}-${values.day}`)
  } catch {
    return todayUtc()
  }
}

/** End of an inclusive `to` bound: everything through 23:59:59.999 UTC. */
export function endOfReportDay(date: Date): Date {
  return new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate(),
      23,
      59,
      59,
      999,
    ),
  )
}

/** True when `from <= to` (inclusive), both UTC midnights. */
export function isDateRangeValid(from: Date, to: Date): boolean {
  return from.getTime() <= endOfReportDay(to).getTime()
}
