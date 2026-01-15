'use client'
import { saveRecentGroup } from '@/app/groups/recent-groups-helpers'
import { useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { trpc } from '@/trpc/client'
import { useCurrentGroup } from './current-group-context'

export function SaveGroupLocally() {
  const { group } = useCurrentGroup()
  const { data: session } = useSession()
  const { data: userGroups, isLoading: isLoadingUserGroups } = trpc.userGroups.list.useQuery(undefined, {
    enabled: !!session?.user,
  })

  useEffect(() => {
    if (!group) return

    // If user is not authenticated, this is a device group - save it
    if (!session?.user) {
      saveRecentGroup({ id: group.id, name: group.name })
      return
    }

    // If user is authenticated but userGroups is still loading, don't save yet
    if (isLoadingUserGroups || userGroups === undefined) {
      return
    }

    // User is authenticated and userGroups loaded - only save if NOT in authenticated groups
    const isAuthenticatedGroup = userGroups.some(ug => ug.id === group.id)
    if (!isAuthenticatedGroup) {
      saveRecentGroup({ id: group.id, name: group.name })
    }
  }, [group, session, userGroups, isLoadingUserGroups])

  return null
}
