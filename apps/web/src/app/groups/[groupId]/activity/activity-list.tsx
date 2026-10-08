import { getRouteApi, useNavigate } from '@tanstack/react-router'
import { ChevronDown, ChevronUp, EyeOff } from 'lucide-react'
import { Fragment, forwardRef, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useInView } from 'react-intersection-observer'

import {
  DATE_GROUPS,
  getGroupedActivitiesByDate,
  splitActivityRuns,
  type ActivityDateGroup,
} from '@/app/groups/[groupId]/activity/activity-grouping'
import { isActivityInvolvingUser } from '@/app/groups/[groupId]/activity/activity-involvement'
import {
  ActivityItem,
  type Activity,
} from '@/app/groups/[groupId]/activity/activity-item'
import { useSyncedAccountPreferences } from '@/components/account-preferences-sync'
import { ApiErrorEmptyState } from '@/components/api-error-empty-state'
import { ScanStickyHeading } from '@/components/layout/scan-surface'
import { OfflineNeedsConnection } from '@/components/offline-empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { detectDeviceTimeZone } from '@/lib/account-preferences'
import { useRestoreExpenseEditScroll } from '@/lib/expense-edit-scroll'
import { useActiveUser } from '@/lib/hooks'
import { useOfflineActivities } from '@/lib/offline/read-hooks'
import { useCurrentAccount } from '@/lib/use-current-account'
import {
  useOfflineWithoutData,
  useServerUnreachableWithoutData,
} from '@/lib/use-online-status'
import { cn, getCurrencyFromGroup } from '@/lib/utils'
import { trpc } from '@/trpc/client'

import { useCurrentGroup } from '../current-group-context'
import { useGroupAccessSearch } from '../use-group-access-search'

const activityRouteApi = getRouteApi('/groups/$groupId/activity')

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

function HiddenActivitiesToggle({
  testId,
  hiddenCount,
  expanded,
  onToggle,
}: {
  testId: string
  hiddenCount: number
  expanded: boolean
  onToggle: () => void
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'Activities' })
  const Chevron = expanded ? ChevronUp : ChevronDown

  return (
    <button
      type="button"
      aria-expanded={expanded}
      data-testid={testId}
      onClick={onToggle}
      className={cn(
        'flex w-full cursor-pointer items-center gap-1.5 px-4 py-2.5 text-xs text-muted-foreground',
        'hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden sm:px-6',
      )}
    >
      <EyeOff className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="flex-1 text-start">
        {expanded
          ? t('hiddenActivitiesShowLess')
          : t('hiddenActivities', { count: hiddenCount })}
      </span>
      <Chevron className="h-3 w-3 shrink-0" aria-hidden="true" />
    </button>
  )
}

export function ActivityList() {
  const { t, i18n } = useTranslation(undefined, { keyPrefix: 'Activity' })
  const { t: tGroups } = useTranslation(undefined, { keyPrefix: 'Groups' })
  const { t: tOffline } = useTranslation()
  const { t: tActivities } = useTranslation(undefined, {
    keyPrefix: 'Activities',
  })
  const locale = i18n.language || 'en-US'
  const { group, groupId } = useCurrentGroup()
  const { linkInviteToken, viewKey } = useGroupAccessSearch()
  const { actShowAll } = activityRouteApi.useSearch()
  const navigate = useNavigate({ from: '/groups/$groupId/activity' })
  const accountPreferences = useSyncedAccountPreferences()
  const accountTimeZone =
    accountPreferences?.timeZone ?? detectDeviceTimeZone() ?? 'UTC'

  // Same rule as the expenses timeline: involvement can only be determined
  // for members with a ledger participant id. Everyone else (logged-out
  // viewers, pending invitees) sees everything and gets no toggle.
  const participantId = useActiveUser(groupId)
  const { data: account } = useCurrentAccount()
  const canCollapse = participantId != null
  const showAll = actShowAll === 'true' || !canCollapse
  const currency = group ? getCurrencyFromGroup(group) : null
  const isInvolving = (activity: Activity) =>
    isActivityInvolvingUser(activity, participantId, account?.id ?? null)

  // Per-run expansion is ephemeral UI state (not in the URL): each run is
  // keyed by the date group plus its first hidden activity id. It resets
  // when the view mode flips, so the incoming mode always starts collapsed.
  const [expandedRuns, setExpandedRuns] = useState<ReadonlySet<string>>(
    () => new Set(),
  )
  const prevShowAll = useRef(showAll)
  useEffect(() => {
    if (prevShowAll.current !== showAll) {
      prevShowAll.current = showAll
      setExpandedRuns(new Set())
    }
  }, [showAll])
  const toggleRun = (runKey: string) => {
    setExpandedRuns((prev) => {
      const next = new Set(prev)
      if (next.has(runKey)) next.delete(runKey)
      else next.add(runKey)
      return next
    })
  }

  const setShowAll = (next: boolean) => {
    void navigate({
      search: (prev) => ({
        ...prev,
        actShowAll: next ? 'true' : undefined,
      }),
      replace: true,
      resetScroll: false,
    })
  }

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

  // Offline read-only: the snapshot carries the recent activity window.
  // Older feed history stays online-only and is disclosed, never implied.
  const offline = useOfflineActivities({
    groupId,
    limit: PAGE_SIZE,
    linkInviteToken,
    viewKey,
  })
  const useOfflineSource =
    !activitiesData && offline.meta.availability === 'ready'
  const offlineDirtySince = useOfflineSource
    ? ((offline.data?.dirtySince as Date | null | undefined) ?? null)
    : null
  const activities = (
    useOfflineSource
      ? (offline.data?.pages.flatMap((page) => page.activities) ?? [])
      : (activitiesData?.pages.flatMap((page) => page.activities) ?? [])
  ) as Activity[]
  const hasMore = useOfflineSource
    ? offline.hasMore
    : (activitiesData?.pages.at(-1)?.hasMore ?? false)
  const fetchNextPageUnified = useOfflineSource
    ? offline.fetchNextPage
    : fetchNextPage
  const isLoadingUnified = useOfflineSource ? offline.isLoading : isLoading
  const showOfflineEmpty =
    useOfflineWithoutData(!!activitiesData) && !useOfflineSource
  const showServerEmpty = useServerUnreachableWithoutData(!!activitiesData)

  useRestoreExpenseEditScroll(
    !isLoadingUnified && !showOfflineEmpty && !showServerEmpty,
    groupId,
  )

  useEffect(() => {
    if (inView && hasMore && !isLoadingUnified) void fetchNextPageUnified()
  }, [fetchNextPageUnified, hasMore, inView, isLoadingUnified])

  if (showServerEmpty) {
    return (
      <div className="px-4 sm:px-6">
        <ApiErrorEmptyState variant="plain" onRetry={() => void refetch()} />
      </div>
    )
  }

  if (showOfflineEmpty) {
    // Extras (activity) are connection-required: never launch the network
    // query offline and never promise persisted data. In-flow only, with back
    // navigation; never a generic full-page error.
    return (
      <div className="px-4 sm:px-6">
        <OfflineNeedsConnection
          backLabel={tGroups('backToGroups')}
          backHref={`/groups/${groupId}`}
        />
      </div>
    )
  }

  if (isLoadingUnified || !group) return <ActivitiesLoading />

  const showWindowDisclosure =
    useOfflineSource && (offline.data?.activityHasMore ?? false)

  const collapseHidden = !showAll && activities.length > 0
  const groupedActivitiesByDate = getGroupedActivitiesByDate(
    activities,
    accountTimeZone,
    locale,
  )

  const renderItem = (activity: Activity, dateStyle: 'medium' | undefined) => (
    <ActivityItem
      key={activity.id}
      groupId={groupId}
      activity={activity}
      dateStyle={dateStyle}
      viewerParticipantId={participantId}
      currency={currency}
    />
  )

  const renderDateGroup = (
    dateGroup: ActivityDateGroup,
    groupActivities: Activity[],
  ) => {
    if (groupActivities.length === 0) return null
    const dateStyle =
      dateGroup == DATE_GROUPS.TODAY || dateGroup == DATE_GROUPS.YESTERDAY
        ? undefined
        : 'medium'

    if (!collapseHidden) {
      return groupActivities.map((activity) => renderItem(activity, dateStyle))
    }
    const runs = splitActivityRuns(groupActivities, isInvolving)
    return runs.map((run, runIndex) => {
      if (run.type === 'visible') {
        return run.items.map((activity) => renderItem(activity, dateStyle))
      }
      const runKey = `${dateGroup}:${run.items[0]!.id}`
      const expanded = expandedRuns.has(runKey)
      return (
        <Fragment key={runKey}>
          <HiddenActivitiesToggle
            testId={`hidden-activities-toggle-${dateGroup}-${runIndex}`}
            hiddenCount={run.items.length}
            expanded={expanded}
            onToggle={() => toggleRun(runKey)}
          />
          {expanded &&
            run.items.map((activity) => renderItem(activity, dateStyle))}
        </Fragment>
      )
    })
  }

  return activities.length > 0 ? (
    <div data-testid="activity-list">
      {useOfflineSource ? (
        <div className="space-y-1 px-4 py-2 sm:px-6">
          <output className="block text-xs text-muted-foreground">
            {tOffline('OfflineReadOnly.reconnectToEdit')}
          </output>
          {showWindowDisclosure ? (
            <output className="block text-xs text-muted-foreground">
              {tOffline('OfflineReadOnly.dataUnavailable')}
            </output>
          ) : null}
          {offlineDirtySince ? (
            <output className="block text-xs text-muted-foreground">
              {tOffline('OfflineReadOnly.dataStale')}
            </output>
          ) : null}
        </div>
      ) : null}
      {canCollapse && (
        <div className="flex items-center gap-2 px-4 py-2 sm:px-6">
          <Tabs
            value={showAll ? 'all' : 'for-you'}
            onValueChange={(value) => setShowAll(value === 'all')}
            aria-label={tActivities('viewMode.label')}
          >
            <TabsList className="h-9">
              <TabsTrigger
                value="for-you"
                className="h-full min-h-0 py-0 text-xs sm:min-h-0"
              >
                {tActivities('viewMode.forYou')}
              </TabsTrigger>
              <TabsTrigger
                value="all"
                className="h-full min-h-0 py-0 text-xs sm:min-h-0"
              >
                {tActivities('viewMode.all')}
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      )}
      {Object.values(DATE_GROUPS).map((dateGroup) => {
        const groupActivities = groupedActivitiesByDate[dateGroup]
        if (!groupActivities || groupActivities.length === 0) return null

        return (
          <div key={dateGroup} data-testid={`activity-date-group-${dateGroup}`}>
            <ScanStickyHeading>
              {t(DATE_GROUP_I18N_KEYS[dateGroup])}
            </ScanStickyHeading>
            {renderDateGroup(dateGroup, groupActivities)}
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
