import { useEffect } from 'react'

import { invalidateAccountGroupLists } from '@/lib/invalidate-account-groups'
import { trpc } from '@/trpc/client'

import { useCurrentGroup } from './current-group-context'

/**
 * Server-backed replacement for the localStorage "save recent group" side
 * effect. Visiting a group the account is a member of is enough to make it
 * appear in the server-backed group list, so we just refresh that list when the
 * group loads.
 */
export function SaveGroupLocally() {
  const { group, viewer } = useCurrentGroup()
  const utils = trpc.useUtils()

  useEffect(() => {
    // Membership visits refresh the account group list. Public-view and
    // pending-invite visits are not memberships — leave those lists alone
    // so a later "save this view-only group" flow can persist them itself.
    if (group && viewer?.source === 'MEMBER') {
      void invalidateAccountGroupLists(utils)
    }
  }, [group, utils, viewer?.source])

  return null
}
