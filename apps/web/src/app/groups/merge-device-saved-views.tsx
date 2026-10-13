import { useEffect, useRef, useState } from 'react'

import { invalidateAccountGroupLists } from '@/lib/invalidate-account-groups'
import { isNetworkError } from '@/lib/network-error'
import {
  DEVICE_SAVED_VIEWS_MERGE_CHUNK,
  readDeviceSavedViews,
  removeDeviceView,
} from '@/lib/saved-view-groups'
import { useCurrentAccount } from '@/lib/use-current-account'
import { useOnlineStatus } from '@/lib/use-online-status'
import { trpc } from '@/trpc/client'

/** Accounts whose device bookmarks already merged this page load. */
const mergedAccountIds = new Set<string>()

const MERGE_RETRY_BASE_MS = 2_000
const MERGE_RETRY_MAX_MS = 30_000
const MERGE_MAX_RETRIES = 3

function getMergeErrorStatus(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null
  const record = error as Record<string, unknown>
  const candidates: unknown[] = [
    record.status,
    record.statusCode,
    (record.data as Record<string, unknown> | undefined)?.httpStatus,
  ]
  const cause = record.cause as Record<string, unknown> | undefined
  if (cause) {
    candidates.push(
      cause.status,
      cause.statusCode,
      (cause.data as Record<string, unknown> | undefined)?.httpStatus,
    )
  }
  for (const candidate of candidates) {
    if (typeof candidate === 'number' && Number.isInteger(candidate)) {
      return candidate
    }
  }
  return null
}

function isTransientMergeError(error: unknown): boolean {
  if (isNetworkError(error)) return true
  if (typeof navigator !== 'undefined' && navigator.onLine === false)
    return true
  const status = getMergeErrorStatus(error)
  if (status === null) return false
  if (status >= 400 && status < 500) return false
  return status >= 500
}

/** Uploads signed-out device bookmarks onto the account once per page load. */
export function MergeDeviceSavedViews() {
  const { data: account } = useCurrentAccount()
  const isOnline = useOnlineStatus()
  const canWrite = isOnline
  const utils = trpc.useUtils()
  const mergingFor = useRef<string | null>(null)
  const [retryAttempt, setRetryAttempt] = useState(0)
  const merge = trpc.groups.savedViews.merge.useMutation()
  const mergeMutateAsync = merge.mutateAsync
  // Stable primitives so session refetches with a new account object identity
  // do not refire the merge.
  const accountId = account?.id ?? null
  const isAnonymous = account?.isAnonymous === true

  useEffect(() => {
    // Automatic merge is a write effect — never run it offline. Device
    // bookmarks stay local until reconnect; no queue, no retry loop.
    if (!canWrite) return
    if (!accountId || isAnonymous) {
      if (!accountId) mergingFor.current = null
      return
    }
    if (mergedAccountIds.has(accountId)) return
    const items = readDeviceSavedViews()
    if (items.length === 0) {
      mergedAccountIds.add(accountId)
      return
    }
    if (mergingFor.current === accountId) return
    mergingFor.current = accountId

    const payload = items.map((item) => ({
      groupId: item.groupId,
      viewKey: item.viewKey,
      lastOpenedAt: item.lastOpenedAt,
    }))

    let retryTimer: ReturnType<typeof setTimeout> | undefined
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
        mergedAccountIds.add(accountId)
        setRetryAttempt(0)
        void invalidateAccountGroupLists(utils)
      } catch (error) {
        // Release the in-flight guard so a later retry can run, with
        // backoff so a persistent failure does not retry in a loop.
        mergingFor.current = null
        if (!isTransientMergeError(error) || retryAttempt >= MERGE_MAX_RETRIES)
          return
        const delay = Math.min(
          MERGE_RETRY_MAX_MS,
          MERGE_RETRY_BASE_MS * 2 ** retryAttempt,
        )
        retryTimer = setTimeout(
          () => setRetryAttempt((attempt) => attempt + 1),
          delay,
        )
      }
    })()
    return () => {
      if (retryTimer) clearTimeout(retryTimer)
    }
  }, [accountId, isAnonymous, canWrite, mergeMutateAsync, utils, retryAttempt])

  return null
}
