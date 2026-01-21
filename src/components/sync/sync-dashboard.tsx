'use client'

import {
  getRecentGroups,
  setRecentGroups,
} from '@/app/groups/recent-groups-helpers'
import { AsyncButton } from '@/components/async-button'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { useToast } from '@/components/ui/use-toast'
import { useSyncAuth } from '@/lib/auth/use-sync-auth'
import { formatDate } from '@/lib/utils'
import { trpc } from '@/trpc/client'
import { Loader2, RefreshCw, UserCheck } from 'lucide-react'
import { useLocale } from 'next-intl'
import { useEffect, useMemo, useRef, useState } from 'react'

type SyncUser = {
  id: string
  email: string
}

type SyncDashboardProps = {
  user: SyncUser
  onLogout: () => Promise<void>
  onLogoutAll: () => Promise<void>
  onDeleteAccount: () => Promise<void>
}

type SyncStatus = {
  lastSyncAt?: Date | string | null
  syncedCount?: number
}

const SYNC_STATUS_KEY = 'spliit_sync_status'

const readSyncStatus = (): SyncStatus => {
  if (typeof window === 'undefined') return {}
  const raw = localStorage.getItem(SYNC_STATUS_KEY)
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as SyncStatus
    return parsed
  } catch {
    return {}
  }
}

const writeSyncStatus = (status: SyncStatus) => {
  if (typeof window === 'undefined') return
  localStorage.setItem(SYNC_STATUS_KEY, JSON.stringify(status))
}

export function SyncDashboard({
  user,
  onLogout,
  onLogoutAll,
  onDeleteAccount,
}: SyncDashboardProps) {
  const { getSessionToken } = useSyncAuth()
  const { toast } = useToast()
  const locale = useLocale()
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(() => readSyncStatus())
  const [syncing, setSyncing] = useState(false)

  const sessionToken = useMemo(() => getSessionToken(), [getSessionToken])

  const statusQuery = trpc.sync.getStatus.useQuery(
    { sessionToken: sessionToken ?? '' },
    {
      enabled: !!sessionToken,
    },
  )

  const pushMutation = trpc.sync.push.useMutation()
  const pullQuery = trpc.sync.pull.useQuery(
    { sessionToken: sessionToken ?? '' },
    { enabled: false },
  )

  const hasShownStatusError = useRef(false)

  useEffect(() => {
    if (!statusQuery.data) return
    const nextStatus = {
      lastSyncAt: statusQuery.data.lastSyncAt ?? null,
      syncedCount: undefined,
    }
    setSyncStatus((current) => {
      const updated = { ...current, ...nextStatus }
      writeSyncStatus(updated)
      return updated
    })
  }, [statusQuery.data])

  useEffect(() => {
    if (!statusQuery.error || hasShownStatusError.current) return
    hasShownStatusError.current = true
    toast({
      title: 'Unable to fetch sync status',
      description: 'Check your connection or sign in again.',
    })
  }, [statusQuery.error, toast])

  const handleSync = async () => {
    if (!sessionToken) return
    setSyncing(true)
    try {
      const groups = getRecentGroups()
      const pushResult = await pushMutation.mutateAsync({
        sessionToken,
        groups: groups.map((group) => ({
          groupId: group.id,
          groupName: group.name,
        })),
      })
      const pullResult = await pullQuery.refetch()
      const syncedGroups = pullResult.data?.groups ?? []

      const mergedGroups = new Map(
        groups.map((group) => [group.id, group] as const),
      )
      syncedGroups.forEach((group) => {
        mergedGroups.set(group.groupId, {
          id: group.groupId,
          name: group.groupName,
        })
      })

      const mergedValues = Array.from(mergedGroups.values())
      setRecentGroups(mergedValues)
      const localGroupIds = new Set(mergedValues.map((group) => group.id))

      const updatedStatus = {
        lastSyncAt: new Date().toISOString(),
        syncedCount: localGroupIds.size,
      }
      setSyncStatus(updatedStatus)
      writeSyncStatus(updatedStatus)
      toast({
        title: 'Sync complete',
        description: `Synced ${pushResult.syncedCount} groups from this device.`,
      })
      statusQuery.refetch()
    } catch (error) {
      toast({
        title: 'Sync failed',
        description: 'Please try again in a moment.',
        variant: 'destructive',
      })
      console.error(error)
    } finally {
      setSyncing(false)
    }
  }

  const lastSyncLabel = syncStatus.lastSyncAt
    ? formatDate(new Date(syncStatus.lastSyncAt), locale, {
        dateStyle: 'medium',
        timeStyle: 'short',
      })
    : 'Never'

  return (
    <div className="grid gap-4">
      <div className="rounded-lg border bg-muted/30 p-4">
        <div className="flex items-center gap-2 text-sm font-medium">
          <UserCheck className="h-4 w-4 text-emerald-500" />
          Connected
        </div>
        <div className="mt-2 text-sm text-muted-foreground">Signed in as</div>
        <div className="text-sm font-medium">{user.email}</div>
      </div>

      <div className="space-y-3 rounded-lg border bg-card p-4">
        <div className="text-sm font-medium">Sync controls</div>
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={handleSync} disabled={syncing || !sessionToken}>
            {syncing ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            Sync now
          </Button>
          <Button
            variant="secondary"
            onClick={() => statusQuery.refetch()}
            disabled={statusQuery.isFetching}
          >
            Refresh status
          </Button>
        </div>
        <div className="grid gap-1 text-sm text-muted-foreground">
          <div>Last sync: {lastSyncLabel}</div>
          <div>Synced groups: {syncStatus.syncedCount ?? getRecentGroups().length}</div>
        </div>
      </div>

      <div className="space-y-3 rounded-lg border bg-card p-4">
        <div className="text-sm font-medium">Account</div>
        <div className="flex flex-col gap-3">
          <AsyncButton variant="outline" action={onLogout}>
            Sign out
          </AsyncButton>
          <AsyncButton variant="secondary" action={onLogoutAll}>
            Sign out everywhere
          </AsyncButton>
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="destructive">Delete account</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogTitle>Delete sync account?</DialogTitle>
              <DialogDescription>
                This removes your sync account and signs you out on every device. Synced
                groups will be deleted from the cloud.
              </DialogDescription>
              <DialogFooter className="flex flex-col gap-2">
                <AsyncButton
                  variant="destructive"
                  loadingContent="Deleting..."
                  action={async () => {
                    await onDeleteAccount()
                    setRecentGroups([])
                    writeSyncStatus({})
                  }}
                >
                  Delete account
                </AsyncButton>
                <DialogClose asChild>
                  <Button variant="secondary">Cancel</Button>
                </DialogClose>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>
    </div>
  )
}
