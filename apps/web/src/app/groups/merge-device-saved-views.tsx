import { useEffect, useRef } from 'react'

import { invalidateAccountGroupLists } from '@/lib/invalidate-account-groups'
import {
  DEVICE_SAVED_VIEWS_MERGE_CHUNK,
  readDeviceSavedViews,
  removeDeviceView,
} from '@/lib/saved-view-groups'
import { useCurrentAccount } from '@/lib/use-current-account'
import { useOnlineStatus } from '@/lib/use-online-status'
import { trpc } from '@/trpc/client'

/** Uploads signed-out device bookmarks onto the account once per page load. */
export function MergeDeviceSavedViews() {
  const { data: account } = useCurrentAccount()
  const isOnline = useOnlineStatus()
  const canWrite = isOnline
  const utils = trpc.useUtils()
  const mergingFor = useRef<string | null>(null)
  const merge = trpc.groups.savedViews.merge.useMutation()
  const mergeMutateAsync = merge.mutateAsync

  useEffect(() => {
    // Automatic merge is a write effect — never run it offline. Device
    // bookmarks stay local until reconnect; no queue, no retry loop.
    if (!canWrite) return
    if (!account) {
      mergingFor.current = null
      return
    }
    if (account.isAnonymous) return
    const items = readDeviceSavedViews()
    if (items.length === 0) return
    if (mergingFor.current === account.id) return
    mergingFor.current = account.id

    const payload = items.map((item) => ({
      groupId: item.groupId,
      viewKey: item.viewKey,
      lastOpenedAt: item.lastOpenedAt,
    }))

    void (async () => {
      try {
        for (
          let offset = 0;
          offset < payload.length;
          offset += DEVICE_SAVED_VIEWS_MERGE_CHUNK
        ) {
          const chunk = payload.slice(
            offset,
            offset + DEVICE_SAVED_VIEWS_MERGE_CHUNK,
          )
          const result = await mergeMutateAsync({ items: chunk })
          for (const groupId of result.completedGroupIds) {
            removeDeviceView(groupId)
          }
        }
        void invalidateAccountGroupLists(utils)
      } catch {
        // Keep mergingFor set so a network failure does not retry in a loop.
      }
    })()
  }, [account, canWrite, mergeMutateAsync, utils])

  return null
}
