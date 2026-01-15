'use client'

import { AddGroupByUrlButton } from '@/app/groups/add-group-by-url-button'
import {
  RecentGroups,
  getArchivedGroups,
  getRecentGroups,
  getStarredGroups,
  saveRecentGroup,
} from '@/app/groups/recent-groups-helpers'
import { Button } from '@/components/ui/button'
import { getGroups } from '@/lib/api'
import { trpc } from '@/trpc/client'
import { AppRouterOutput } from '@/trpc/routers/_app'
import { Loader2 } from 'lucide-react'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { RecentGroupListCard } from './recent-group-list-card'

interface UnifiedGroupListProps {
  isAuthenticated: boolean
}

export function UnifiedGroupList({ isAuthenticated }: UnifiedGroupListProps) {
  const t = useTranslations('Groups')
  const [deviceGroups, setDeviceGroups] = useState<RecentGroups>([])
  const [starredGroups, setStarredGroups] = useState<string[]>([])
  const [archivedGroups, setArchivedGroups] = useState<string[]>([])
  const [deviceGroupsLoaded, setDeviceGroupsLoaded] = useState(false)

  // Fetch device groups from localStorage
  useEffect(() => {
    const groupsInStorage = getRecentGroups()
    const starredGroupsInStorage = getStarredGroups()
    const archivedGroupsInStorage = getArchivedGroups()

    setDeviceGroups(groupsInStorage)
    setStarredGroups(starredGroupsInStorage)
    setArchivedGroups(archivedGroupsInStorage)
    setDeviceGroupsLoaded(true)
  }, [])

  // Fetch authenticated groups only if user is authenticated
  const { data: authenticatedGroups, isLoading: isLoadingAuth } =
    trpc.userGroups.list.useQuery(undefined, {
      enabled: isAuthenticated,
    })

  // Fetch device group details
  const { data: deviceGroupsData, isLoading: isLoadingDeviceDetails } =
    trpc.groups.list.useQuery(
      {
        groupIds: deviceGroups.map((group) => group.id),
      },
      {
        enabled: deviceGroupsLoaded && deviceGroups.length > 0,
      },
    )

  const refreshDeviceGroups = () => {
    const groupsInStorage = getRecentGroups()
    const starredGroupsInStorage = getStarredGroups()
    const archivedGroupsInStorage = getArchivedGroups()

    setDeviceGroups(groupsInStorage)
    setStarredGroups(starredGroupsInStorage)
    setArchivedGroups(archivedGroupsInStorage)
  }

  // Sort device groups
  const sortedDeviceGroups = {
    starred: deviceGroups.filter((g) => starredGroups.includes(g.id)),
    recent: deviceGroups.filter(
      (g) =>
        !starredGroups.includes(g.id) && !archivedGroups.includes(g.id),
    ),
    archived: deviceGroups.filter((g) => archivedGroups.includes(g.id)),
  }

  const hasAuthenticatedGroups =
    authenticatedGroups && authenticatedGroups.length > 0
  const hasDeviceGroups = deviceGroups.length > 0
  const isLoadingAuth_ =
    isAuthenticated && (isLoadingAuth || authenticatedGroups === undefined)

  return (
    <>
      {/* Header with Create and Add by URL buttons */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-6">
        <h1 className="font-bold text-2xl flex-1">
          <Link href="/groups">{t('myGroups')}</Link>
        </h1>
        <div className="flex gap-2">
          <AddGroupByUrlButton reload={refreshDeviceGroups} />
          <Button asChild>
            <Link href="/groups/create">{t('create')}</Link>
          </Button>
        </div>
      </div>

      {/* Empty state when no groups at all */}
      {!hasAuthenticatedGroups && !hasDeviceGroups && !isLoadingAuth_ && (
        <div className="text-sm space-y-2">
          <p>{t('NoRecent.description')}</p>
          <p>
            <Button variant="link" asChild className="p-0">
              <Link href="/groups/create">{t('NoRecent.create')}</Link>
            </Button>
            {' or join using an invite link.'}
          </p>
        </div>
      )}

      {/* Authenticated Groups Section */}
      {isAuthenticated && (
        <>
          {isLoadingAuth_ ? (
            <div className="text-sm space-y-4">
              <p>
                <Loader2 className="w-4 m-4 mr-2 inline animate-spin" />
                {t('loadingRecent')}
              </p>
            </div>
          ) : hasAuthenticatedGroups ? (
            <>
              <div className="mb-6">
                <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
                  Authenticated Groups
                  <span className="text-xs font-normal text-muted-foreground">
                    Synced across devices
                  </span>
                </h2>
                <ul className="grid gap-2 sm:grid-cols-2">
                  {authenticatedGroups.map((group) => (
                    <RecentGroupListCard
                      key={group.id}
                      group={{ id: group.id, name: group.name }}
                      isStarred={false}
                      isArchived={false}
                      refreshGroupsFromStorage={() => {}}
                    />
                  ))}
                </ul>
              </div>

              {/* Separator if there are device groups */}
              {hasDeviceGroups && (
                <div className="my-8 border-t" />
              )}
            </>
          ) : null}
        </>
      )}

      {/* Device Groups Section */}
      {hasDeviceGroups && (
        <div>
          <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
            Device Groups
            <span className="text-xs font-normal text-muted-foreground">
              Local only
            </span>
          </h2>

          {/* Starred Device Groups */}
          {sortedDeviceGroups.starred.length > 0 && (
            <div className="mb-6">
              <h3 className="mb-2 text-sm font-medium">{t('starred')}</h3>
              <ul className="grid gap-2 sm:grid-cols-2">
                {sortedDeviceGroups.starred.map((group) => (
                  <RecentGroupListCard
                    key={group.id}
                    group={group}
                    groupDetail={deviceGroupsData?.groups?.find(
                      (g) => g.id === group.id,
                    )}
                    isStarred={true}
                    isArchived={false}
                    refreshGroupsFromStorage={refreshDeviceGroups}
                  />
                ))}
              </ul>
            </div>
          )}

          {/* Recent Device Groups */}
          {sortedDeviceGroups.recent.length > 0 && (
            <div className="mb-6">
              <h3 className="mb-2 text-sm font-medium">{t('recent')}</h3>
              <ul className="grid gap-2 sm:grid-cols-2">
                {sortedDeviceGroups.recent.map((group) => (
                  <RecentGroupListCard
                    key={group.id}
                    group={group}
                    groupDetail={deviceGroupsData?.groups?.find(
                      (g) => g.id === group.id,
                    )}
                    isStarred={false}
                    isArchived={false}
                    refreshGroupsFromStorage={refreshDeviceGroups}
                  />
                ))}
              </ul>
            </div>
          )}

          {/* Archived Device Groups */}
          {sortedDeviceGroups.archived.length > 0 && (
            <div>
              <h3 className="mb-2 text-sm font-medium opacity-50">
                {t('archived')}
              </h3>
              <div className="opacity-50">
                <ul className="grid gap-2 sm:grid-cols-2">
                  {sortedDeviceGroups.archived.map((group) => (
                    <RecentGroupListCard
                      key={group.id}
                      group={group}
                      groupDetail={deviceGroupsData?.groups?.find(
                        (g) => g.id === group.id,
                      )}
                      isStarred={false}
                      isArchived={true}
                      refreshGroupsFromStorage={refreshDeviceGroups}
                    />
                  ))}
                </ul>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  )
}
