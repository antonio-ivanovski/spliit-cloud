import dayjs, { type Dayjs } from 'dayjs'

import { firstDayOfWeek } from '@spliit/domain/i18n'

/** Returns the start of the locale week containing `date` (at calendar noon). */
export function startOfLocaleWeek(date: Dayjs, locale: string): Dayjs {
  const firstDay = firstDayOfWeek(locale) % 7
  const daysSinceStart = (date.day() - firstDay + 7) % 7
  return date.startOf('day').subtract(daysSinceStart, 'day')
}

export function isInCurrentLocaleWeek(
  date: Dayjs,
  today: Dayjs,
  locale: string,
): boolean {
  const weekStart = startOfLocaleWeek(today, locale)
  const nextWeekStart = weekStart.add(7, 'day')
  return !date.isBefore(weekStart, 'day') && date.isBefore(nextWeekStart, 'day')
}

export function isInPreviousLocaleWeek(
  date: Dayjs,
  today: Dayjs,
  locale: string,
): boolean {
  const weekStart = startOfLocaleWeek(today, locale)
  const previousWeekStart = weekStart.subtract(7, 'day')
  return (
    !date.isBefore(previousWeekStart, 'day') && date.isBefore(weekStart, 'day')
  )
}

export function calendarDay(value: string): Dayjs {
  return dayjs(`${value}T12:00:00`)
}
