import { forwardRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useInView } from 'react-intersection-observer'

import {
  DATE_GROUPS,
  getGroupedActivitiesByDate,
} from '@/app/groups/[groupId]/activity/activity-grouping'
import { ActivityItem } from '@/app/groups/[groupId]/activity/activity-item'
import { useSyncedAccountPreferences } from '@/components/account-preferences-sync'
import { ScanStickyHeading } from '@/components/layout/scan-surface'
import { OfflineEmptyState } from '@/components/offline-empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { detectDeviceTimeZone } from '@/lib/account-preferences'
import { useOfflineWithoutData } from '@/lib/use-online-status'
import { trpc } from '@/trpc/client'

import { useCurrentGroup } from '../current-group-context'
import { useGroupAccessSearch } from '../use-group-access-search'

const PAGE_SIZE = 20

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

const ActivitiesLoading = forwardRef<HTMLDivElement>((_, ref) => {
  return (
    <div ref={ref} className="flex flex-col gap-4">
      <Skeleton className="mx-4 mt-2 h-3 w-24 sm:mx-6" />
      {Array(5)
        .fill(undefined)
        .map((_, index) => (
          <div key={index} className="flex gap-2 px-4 py-2 sm:px-6">
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
  const { t, i18n } = useTranslation(undefined, { keyPrefix: 'Activity' })
  const locale = i18n.language || 'en-US'
  const { group, groupId } = useCurrentGroup()
  const { linkInviteToken, viewKey } = useGroupAccessSearch()
  const accountPreferences = useSyncedAccountPreferences()
  const accountTimeZone =
    accountPreferences?.timeZone ?? detectDeviceTimeZone() ?? 'UTC'

  const {
    data: activitiesData,
    isLoading,
    fetchNextPage,
    refetch,
  } = trpc.groups.activities.list.useInfiniteQuery(
    { groupId, limit: PAGE_SIZE, linkInviteToken, viewKey },
    { getNextPageParam: ({ nextCursor }) => nextCursor },
  )
  const { ref: loadingRef, inView } = useInView()

  const activities = activitiesData?.pages.flatMap((page) => page.activities)
  const hasMore = activitiesData?.pages.at(-1)?.hasMore ?? false
  const showOfflineEmpty = useOfflineWithoutData(!!activitiesData)

  useEffect(() => {
    if (inView && hasMore && !isLoading) void fetchNextPage()
  }, [fetchNextPage, hasMore, inView, isLoading])

  if (showOfflineEmpty) {
    return (
      <div className="px-4 sm:px-6">
        <OfflineEmptyState variant="plain" onRetry={() => void refetch()} />
      </div>
    )
  }

  if (isLoading || !activities || !group) return <ActivitiesLoading />

  const groupedActivitiesByDate = getGroupedActivitiesByDate(
    activities,
    accountTimeZone,
    locale,
  )

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
            <ScanStickyHeading>
              {t(DATE_GROUP_I18N_KEYS[dateGroup])}
            </ScanStickyHeading>
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
    <p className="px-4 py-6 text-sm sm:px-6" data-testid="activity-list-empty">
      {t('noActivity')}
    </p>
  )
}
