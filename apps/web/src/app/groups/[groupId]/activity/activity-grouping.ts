import type { Dayjs } from 'dayjs'

import {
  calendarDay,
  isInCurrentLocaleWeek,
  isInPreviousLocaleWeek,
} from '@/lib/calendar'
import { zonedDateOnlyIso } from '@/lib/utils'

export const DATE_GROUPS = {
  TODAY: 'today',
  YESTERDAY: 'yesterday',
  EARLIER_THIS_WEEK: 'earlierThisWeek',
  LAST_WEEK: 'lastWeek',
  EARLIER_THIS_MONTH: 'earlierThisMonth',
  LAST_MONTH: 'lastMonth',
  EARLIER_THIS_YEAR: 'earlierThisYear',
  LAST_YEAR: 'lastYear',
  OLDER: 'older',
} as const

export type ActivityDateGroup = (typeof DATE_GROUPS)[keyof typeof DATE_GROUPS]

function getDateGroup(
  date: Dayjs,
  today: Dayjs,
  locale: string,
): ActivityDateGroup {
  if (today.isSame(date, 'day')) {
    return DATE_GROUPS.TODAY
  } else if (today.subtract(1, 'day').isSame(date, 'day')) {
    return DATE_GROUPS.YESTERDAY
  } else if (isInCurrentLocaleWeek(date, today, locale)) {
    return DATE_GROUPS.EARLIER_THIS_WEEK
  } else if (isInPreviousLocaleWeek(date, today, locale)) {
    return DATE_GROUPS.LAST_WEEK
  } else if (today.isSame(date, 'month')) {
    return DATE_GROUPS.EARLIER_THIS_MONTH
  } else if (today.subtract(1, 'month').isSame(date, 'month')) {
    return DATE_GROUPS.LAST_MONTH
  } else if (today.isSame(date, 'year')) {
    return DATE_GROUPS.EARLIER_THIS_YEAR
  } else if (today.subtract(1, 'year').isSame(date, 'year')) {
    return DATE_GROUPS.LAST_YEAR
  } else {
    return DATE_GROUPS.OLDER
  }
}

export type ActivityWithTime = { time: Date | string }

export function getGroupedActivitiesByDate<T extends ActivityWithTime>(
  activities: T[],
  timeZone: string,
  locale = 'en-US',
  now = new Date(),
) {
  const today = calendarDay(zonedDateOnlyIso(now, timeZone))
  const dateGroupValues = Object.values(DATE_GROUPS) as ActivityDateGroup[]
  const result = Object.fromEntries(
    dateGroupValues.map((group) => [group, [] as T[]]),
  ) as Record<ActivityDateGroup, T[]>

  for (const activity of activities) {
    const activityGroup = getDateGroup(
      calendarDay(zonedDateOnlyIso(new Date(activity.time), timeZone)),
      today,
      locale,
    )
    result[activityGroup].push(activity)
  }
  return result
}
