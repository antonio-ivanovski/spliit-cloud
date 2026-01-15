'use client'
import { saveRecentGroup } from '@/app/groups/recent-groups-helpers'
import { useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { trpc } from '@/trpc/client'
import { useCurrentGroup } from './current-group-context'

export function SaveGroupLocally() {
  const { group } = useCurrentGroup()
  const { data: session } = useSession()
  const { data: userGroups } = trpc.userGroups.list.useQuery(undefined, {
    enabled: !!session?.user,
  })

  useEffect(() => {
    if (!group) return

    // Only save to localStorage if this is NOT an authenticated group
    // (i.e., user is not authenticated to this group)
    const isAuthenticatedGroup = userGroups?.some(
      (ug) => ug.id === group.id,
    )

    if (!isAuthenticatedGroup) {
      saveRecentGroup({ id: group.id, name: group.name })
    }
  }, [group, userGroups])

  return null
}
