import { trpc } from '@/trpc/client'
import { useEffect } from 'react'
import { useCurrentGroup } from './current-group-context'

/**
 * Server-backed replacement for the localStorage "save recent group" side
 * effect. Visiting a group the account is a member of is enough to make it
 * appear in the server-backed group list, so we just refresh that list when
 * the group loads.
 */
export function SaveGroupLocally() {
  const { group } = useCurrentGroup()
  const utils = trpc.useUtils()

  useEffect(() => {
    if (group) {
      // Refresh the server-backed group list so the visited group shows up
      // in the "recent" section on the groups page.
      utils.account.groups.invalidate()
    }
  }, [group, utils])

  return null
}
