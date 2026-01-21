'use client'

import {
  RecentGroups,
  getRecentGroups,
  onRecentGroupsChange,
  setRecentGroups,
} from '@/app/groups/recent-groups-helpers'
import { useSyncAuth } from '@/lib/auth/use-sync-auth'
import type { SyncedGroupData } from '@/lib/plugins/sync'
import { useEffect, useState } from 'react'

function hasWindowStorage() {
  return typeof window !== 'undefined' && typeof localStorage !== 'undefined'
}

function isGroupSyncEnabled() {
  const flag = process.env.NEXT_PUBLIC_ENABLE_GROUP_SYNC
  if (!flag) return false
  return ['true', '1', 'yes', 'on'].includes(flag.toLowerCase())
}

export function getLocalGroupsForSync(): SyncedGroupData[] {
  if (!hasWindowStorage()) return []
  const groups = getRecentGroups()
  const now = new Date()
  return groups.map((group) => ({
    groupId: group.id,
    groupName: group.name,
    addedAt: now,
  }))
}

function mergeGroups(localGroups: RecentGroups, syncedGroups: SyncedGroupData[]) {
  const groupMap = new Map(localGroups.map((group) => [group.id, group]))

  for (const syncedGroup of syncedGroups) {
    if (!groupMap.has(syncedGroup.groupId)) {
      groupMap.set(syncedGroup.groupId, {
        id: syncedGroup.groupId,
        name: syncedGroup.groupName,
      })
    }
  }

  return Array.from(groupMap.values())
}

export function mergeGroupsWithLocal(syncedGroups: SyncedGroupData[]) {
  if (!hasWindowStorage()) return
  const localGroups = getRecentGroups()
  const merged = mergeGroups(localGroups, syncedGroups)
  setRecentGroups(merged)
}

async function syncGroups() {
  if (!hasWindowStorage()) return
  const sessionToken = localStorage.getItem('spliit_sync_session')
  if (!sessionToken) return
  if (!isGroupSyncEnabled()) return

  const groups = getLocalGroupsForSync().map((group) => ({
    groupId: group.groupId,
    groupName: group.groupName,
  }))

  await fetch('/api/trpc/sync.push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: 0,
      json: {
        sessionToken,
        groups,
      },
    }),
  }).catch(() => undefined)
}

export function triggerAutoSync() {
  void syncGroups()
}

export function subscribeToGroupSync() {
  if (!hasWindowStorage()) return () => {}
  return onRecentGroupsChange(() => {
    triggerAutoSync()
  })
}

export function useSyncStatus() {
  const { isAuthenticated, isLoading } = useSyncAuth()
  const [lastSyncAt, setLastSyncAt] = useState<Date | null>(null)

  useEffect(() => {
    if (!hasWindowStorage() || !isGroupSyncEnabled()) return
    const sessionToken = localStorage.getItem('spliit_sync_session')
    if (!sessionToken) return

    const controller = new AbortController()

    const fetchStatus = async () => {
      const response = await fetch('/api/trpc/sync.getStatus', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 0,
          json: { sessionToken },
        }),
        signal: controller.signal,
      })

      if (!response.ok) return

      const data = (await response.json()) as {
        result?: { data?: { connected?: boolean; lastSyncAt?: string } }
      }
      const lastSyncRaw = data?.result?.data?.lastSyncAt
      if (lastSyncRaw) {
        setLastSyncAt(new Date(lastSyncRaw))
      }
    }

    void fetchStatus()

    return () => {
      controller.abort()
    }
  }, [])

  return {
    isAuthenticated,
    isLoading,
    lastSyncAt,
  }
}
