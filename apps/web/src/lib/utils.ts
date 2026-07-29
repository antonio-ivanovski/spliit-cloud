export * from '@spliit/domain/utils'

const dateOnlyFormatters = new Map<string, Intl.DateTimeFormat>()

export function formatZonedDate(
  date: Date,
  locale: string,
  timeZone: string,
  options: {
    dateStyle?: Intl.DateTimeFormatOptions['dateStyle']
    timeStyle?: Intl.DateTimeFormatOptions['timeStyle']
  } = {},
) {
  return new Intl.DateTimeFormat(locale, { ...options, timeZone }).format(date)
}

/** ISO calendar date containing an instant in the requested IANA timezone. */
export function zonedDateOnlyIso(date: Date, timeZone: string): string {
  let formatter = dateOnlyFormatters.get(timeZone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
    dateOnlyFormatters.set(timeZone, formatter)
  }
  const parts = formatter.formatToParts(date)
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((candidate) => candidate.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')}`
}

/** Stable ISO representation of a Prisma DATE value. */
export function dateOnlyIso(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/** Prisma-compatible DATE value for the current date in an IANA timezone. */
export function dateOnlyInAccountTimeZone(date: Date, timeZone: string): Date {
  return new Date(`${zonedDateOnlyIso(date, timeZone)}T00:00:00.000Z`)
}
