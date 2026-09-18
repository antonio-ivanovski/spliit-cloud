import { useEffect, useRef } from 'react'

import { invalidateAccountGroupLists } from '@/lib/invalidate-account-groups'
import { useCurrentAccount } from '@/lib/use-current-account'
import { useOnlineStatus } from '@/lib/use-online-status'
import { trpc } from '@/trpc/client'

import { useCurrentGroup } from './current-group-context'

/**
 * Membership visits refresh the account group list and drop a leftover
 * view-only bookmark for the same group. Public-view persistence is owned by
 * `useSavedViewBookmark`.
 */
export function SaveGroupLocally() {
  const { group, viewer } = useCurrentGroup()
  const { data: account } = useCurrentAccount()
  const utils = trpc.useUtils()
  const lastVisit = useRef<string | null>(null)
  const removeSavedView = trpc.groups.savedViews.remove.useMutation({
    onSuccess: () => {
      void invalidateAccountGroupLists(utils)
    },
  })
  const removeMutate = removeSavedView.mutate
  const groupId = group?.id
  const persistToAccount = Boolean(account && !account.isAnonymous)
  // Automatic remove is a write effect — never send it offline.
  // Device views stay local; the guard would also reject a missed call.
  const isOnline = useOnlineStatus()

  useEffect(() => {
    if (!groupId || viewer?.source !== 'MEMBER') return
    if (!isOnline) return
    const visitKey = `${account?.id ?? ''}:${groupId}`
    if (lastVisit.current === visitKey) return
    lastVisit.current = visitKey
    void invalidateAccountGroupLists(utils)
    if (persistToAccount) {
      removeMutate({ groupId })
    }
  }, [
    account?.id,
    groupId,
    isOnline,
    persistToAccount,
    removeMutate,
    utils,
    viewer?.source,
  ])

  return null
}
