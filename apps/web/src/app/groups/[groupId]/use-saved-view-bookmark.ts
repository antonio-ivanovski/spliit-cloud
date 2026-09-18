import { useEffect, useRef, useState } from 'react'

import { invalidateAccountGroupLists } from '@/lib/invalidate-account-groups'
import {
  isOfflineWriteError,
  notifyOfflineWriteBlocked,
} from '@/lib/offline/write-guard'
import {
  saveDeviceView,
  touchDeviceView,
  useDeviceSavedViews,
} from '@/lib/saved-view-groups'
import { useCurrentAccount } from '@/lib/use-current-account'
import { useOnlineStatus } from '@/lib/use-online-status'
import { trpc } from '@/trpc/client'

import { useCurrentGroup } from './current-group-context'
import { useGroupAccessSearch } from './use-group-access-search'

export function useSavedViewBookmark(options?: {
  onSaved?: () => void
  onError?: (message: string) => void
}) {
  const { group, viewer, hasSavedView } = useCurrentGroup()
  const { viewKey, linkInviteToken } = useGroupAccessSearch()
  const { data: account } = useCurrentAccount()
  const utils = trpc.useUtils()
  const deviceViews = useDeviceSavedViews()
  const [accountSaved, setAccountSaved] = useState(false)
  const onSaved = options?.onSaved
  const onError = options?.onError
  const lastVisit = useRef<string | null>(null)

  const persistToAccount = Boolean(account && !account.isAnonymous)
  const isOnline = useOnlineStatus()
  const canWrite = isOnline
  const groupId = group?.id
  const groupName = group?.name
  const groupEmoji = group?.emoji
  const groupColor = group?.color
  const memberCount = group?.members.length ?? 0
  const visitKey = `${account?.id ?? 'device'}:${groupId ?? ''}:${viewKey ?? ''}`
  const isPublicLink =
    viewer?.source === 'PUBLIC_LINK' &&
    Boolean(groupId && viewKey) &&
    !linkInviteToken
  const deviceSaved = Boolean(
    groupId && deviceViews.some((item) => item.groupId === groupId),
  )
  const isSaved = persistToAccount
    ? accountSaved || hasSavedView === true
    : deviceSaved

  const touch = trpc.groups.savedViews.touch.useMutation({
    onSuccess: (row) => {
      setAccountSaved(row != null)
    },
  })
  const saveMutation = trpc.groups.savedViews.save.useMutation({
    onSuccess: () => {
      setAccountSaved(true)
      if (groupId) void utils.groups.get.invalidate({ groupId })
      void invalidateAccountGroupLists(utils)
      onSaved?.()
    },
    onError: (error) => {
      if (isOfflineWriteError(error)) {
        notifyOfflineWriteBlocked((message) => onError?.(message))
        return
      }
      onError?.(error.message)
    },
  })

  const touchMutate = touch.mutate

  useEffect(() => {
    // The touch is an automatic write effect — never send it offline.
    // Device views stay local; the guard would also reject a missed call.
    if (!canWrite) return
    if (!isPublicLink || !groupId || !viewKey) return
    if (lastVisit.current === visitKey) return
    lastVisit.current = visitKey
    if (persistToAccount) {
      touchMutate({ groupId, viewKey })
      return
    }
    if (deviceSaved && groupName) {
      touchDeviceView({
        groupId,
        viewKey,
        name: groupName,
        memberCount,
        emoji: groupEmoji ?? null,
        color: groupColor ?? null,
      })
    }
  }, [
    canWrite,
    deviceSaved,
    groupColor,
    groupEmoji,
    groupId,
    groupName,
    isPublicLink,
    memberCount,
    persistToAccount,
    touchMutate,
    visitKey,
    viewKey,
  ])

  const save = () => {
    if (!groupId || !viewKey || !groupName) return
    if (persistToAccount) {
      // Manual account write: gate before optimism. Device views stay local
      // and always succeed offline.
      if (!canWrite) {
        notifyOfflineWriteBlocked((message) => onError?.(message))
        return
      }
      saveMutation.mutate({ groupId, viewKey })
      return
    }
    saveDeviceView({
      groupId,
      viewKey,
      name: groupName,
      memberCount,
      emoji: groupEmoji ?? null,
      color: groupColor ?? null,
      lastOpenedAt: new Date().toISOString(),
    })
    onSaved?.()
  }

  return {
    isPublicLink,
    isSaved,
    persistToAccount,
    pending: saveMutation.isPending,
    save,
  }
}
