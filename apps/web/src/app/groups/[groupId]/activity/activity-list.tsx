import type { Activity } from '@/app/groups/[groupId]/activity/activity-item'
import { ActivityItem } from '@/app/groups/[groupId]/activity/activity-item'
import { Skeleton } from '@/components/ui/skeleton'
import { trpc } from '@/trpc/client'
import dayjs, { type Dayjs } from 'dayjs'
import { forwardRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useInView } from 'react-intersection-observer'
import { useCurrentGroup } from '../current-group-context'
import { useLinkInviteToken } from '../use-link-invite-token'

const PAGE_SIZE = 20

const DATE_GROUPS = {
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

const DATE_GROUP_I18N_KEYS = {
  today: 'Groups.today',
  yesterday: 'Groups.yesterday',
  earlierThisWeek: 'Groups.earlierThisWeek',
  lastWeek: 'Groups.lastWeek',
  earlierThisMonth: 'Groups.earlierThisMonth',
  lastMonth: 'Groups.lastMonth',
  earlierThisYear: 'Groups.earlierThisYear',
  lastYear: 'Groups.lastYear',
  older: 'Groups.older',
} as const satisfies Record<
  (typeof DATE_GROUPS)[keyof typeof DATE_GROUPS],
  string
>

function getDateGroup(date: Dayjs, today: Dayjs) {
  if (today.isSame(date, 'day')) {
    return DATE_GROUPS.TODAY
  } else if (today.subtract(1, 'day').isSame(date, 'day')) {
    return DATE_GROUPS.YESTERDAY
  } else if (today.isSame(date, 'week')) {
    return DATE_GROUPS.EARLIER_THIS_WEEK
  } else if (today.subtract(1, 'week').isSame(date, 'week')) {
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

function getGroupedActivitiesByDate(activities: Activity[]) {
  const today = dayjs()
  const dateGroupValues = Object.values(DATE_GROUPS) as Array<
    (typeof DATE_GROUPS)[keyof typeof DATE_GROUPS]
  >
  const result = Object.fromEntries(
    dateGroupValues.map((g) => [g, [] as Activity[]]),
  ) as Record<(typeof DATE_GROUPS)[keyof typeof DATE_GROUPS], Activity[]>
  for (const activity of activities) {
    const activityGroup = getDateGroup(dayjs(activity.time), today)
    result[activityGroup].push(activity)
  }
  return result
}

const ActivitiesLoading = forwardRef<HTMLDivElement>((_, ref) => {
  return (
    <div ref={ref} className="flex flex-col gap-4">
      <Skeleton className="mt-2 h-3 w-24" />
      {Array(5)
        .fill(undefined)
        .map((_, index) => (
          <div key={index} className="flex gap-2 p-2">
            <div className="flex-0">
              <Skeleton className="h-3 w-12" />
            </div>
            <div className="flex-1">
              <Skeleton className="h-3 w-48" />
            </div>
          </div>
        ))}
    </div>
  )
})
ActivitiesLoading.displayName = 'ActivitiesLoading'

export function ActivityList() {
  const { t } = useTranslation(undefined, { keyPrefix: 'Activity' })
  const { group, groupId } = useCurrentGroup()
  const linkInviteToken = useLinkInviteToken()

  const {
    data: activitiesData,
    isLoading,
    fetchNextPage,
  } = trpc.groups.activities.list.useInfiniteQuery(
    { groupId, limit: PAGE_SIZE, linkInviteToken },
    { getNextPageParam: ({ nextCursor }) => nextCursor },
  )
  const { ref: loadingRef, inView } = useInView()

  const activities = activitiesData?.pages.flatMap((page) => page.activities)
  const hasMore = activitiesData?.pages.at(-1)?.hasMore ?? false

  useEffect(() => {
    if (inView && hasMore && !isLoading) fetchNextPage()
  }, [fetchNextPage, hasMore, inView, isLoading])

  if (isLoading || !activities || !group) return <ActivitiesLoading />

  const groupedActivitiesByDate = getGroupedActivitiesByDate(activities)

  return activities.length > 0 ? (
    <div data-testid="activity-list">
      {Object.values(DATE_GROUPS).map((dateGroup) => {
        const groupActivities = groupedActivitiesByDate[dateGroup]
        if (!groupActivities || groupActivities.length === 0) return null
        const dateStyle =
          dateGroup == DATE_GROUPS.TODAY || dateGroup == DATE_GROUPS.YESTERDAY
            ? undefined
            : 'medium'

        return (
          <div key={dateGroup} data-testid={`activity-date-group-${dateGroup}`}>
            <div
              className={
                'text-muted-foreground text-xs py-1 font-semibold sticky top-16 bg-white dark:bg-[#1b1917]'
              }
            >
              {t(DATE_GROUP_I18N_KEYS[dateGroup])}
            </div>
            {groupActivities.map((activity) => (
              <ActivityItem
                key={activity.id}
                groupId={groupId}
                activity={activity}
                dateStyle={dateStyle}
              />
            ))}
          </div>
        )
      })}
      {hasMore && <ActivitiesLoading ref={loadingRef} />}
    </div>
  ) : (
    <p className="text-sm py-6" data-testid="activity-list-empty">
      {t('noActivity')}
    </p>
  )
}
