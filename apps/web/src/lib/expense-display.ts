import { timeZoneCityLabel, timeZoneCityOffsetLabel } from '@spliit/domain'

export function getDeviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC'
  } catch {
    return 'UTC'
  }
}

function formatTime(instant: Date, locale: string, timeZone: string): string {
  return new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
    hour12: false,
  }).format(instant)
}

function calendarYear(instant: Date, timeZone: string): number {
  const year = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
  }).format(instant)
  return Number(year)
}

function formatShortDate(
  instant: Date,
  locale: string,
  timeZone: string,
  now: Date,
): string {
  const includeYear =
    calendarYear(instant, timeZone) !== calendarYear(now, timeZone)
  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    ...(includeYear ? { year: 'numeric' } : {}),
    timeZone,
  }).format(instant)
}

export function formatExpenseClosed(
  expense: {
    expenseDate: Date | string
    expenseTimeZone: string
  },
  locale: string,
  referenceTz = getDeviceTimeZone(),
  yourTimeLabel?: string,
): {
  date: string
  shortDate: string
  time: string
  tzHint?: string
  text: string
  tooltip?: string
} {
  const empty = { text: '', date: '', shortDate: '', time: '' }
  const instant = new Date(expense.expenseDate as Date | string)
  if (Number.isNaN(instant.getTime())) return empty
  const tz = expense.expenseTimeZone
  const date = new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeZone: tz,
  }).format(instant)
  const time = formatTime(instant, locale, tz)
  const shortDate = formatShortDate(instant, locale, tz, new Date())
  const needsTz = tz !== referenceTz
  if (!needsTz) return { date, shortDate, time, text: `${date} ${time}` }
  const tzHint = timeZoneCityLabel(tz)
  const cityOffset = timeZoneCityOffsetLabel(tz, instant)
  const yourTime = formatTime(instant, locale, referenceTz)
  return {
    date,
    shortDate,
    time,
    tzHint,
    text: `${date} ${time} · ${tzHint}`,
    tooltip: yourTimeLabel
      ? `${time} ${cityOffset} · ${yourTimeLabel} ${yourTime}`
      : undefined,
  }
}
