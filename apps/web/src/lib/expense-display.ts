import { timeZoneCityOffsetLabel } from '@spliit/domain'

export function getDeviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC'
  } catch {
    return 'UTC'
  }
}

export function formatExpenseClosed(
  expense: {
    expenseAt?: Date | string
    expenseDate: Date | string
    expenseTimeZone?: string | null
  },
  locale: string,
  deviceTz = getDeviceTimeZone(),
  yourTimeLabel?: string,
): { text: string; tooltip?: string } {
  const instant = expense.expenseAt
    ? new Date(expense.expenseAt as Date | string)
    : new Date(expense.expenseDate as Date | string)
  if (Number.isNaN(instant.getTime())) return { text: '' }
  const tz = expense.expenseTimeZone ?? 'UTC'
  const date = new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeZone: tz,
  }).format(instant)
  const time = new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: tz,
    hour12: false,
  }).format(instant)
  const needsTz = tz !== deviceTz
  if (!needsTz) return { text: `${date} ${time}` }
  const cityOffset = timeZoneCityOffsetLabel(tz, instant)
  const yourTime = new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: deviceTz,
    hour12: false,
  }).format(instant)
  return {
    text: `${date} ${time} · ${cityOffset}`,
    tooltip: yourTimeLabel
      ? `${time} ${cityOffset} · ${yourTimeLabel} ${yourTime}`
      : undefined,
  }
}
