import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'

import { useLocale } from '@/i18n/react'
import type { CatalogRecord, GroupRecord } from '@/lib/offline/contract'
import {
  useOfflineSession,
  useOfflineRetry,
  useOptionalOfflineStorage,
  useOptionalOfflineSync,
} from '@/lib/offline/provider'
import { offlineQueryKey } from '@/lib/offline/read-model'
import { cn } from '@/lib/utils'

function useRepository() {
  const storage = useOptionalOfflineStorage()
  try {
    return storage?.getRepository() ?? null
  } catch {
    return null
  }
}

const EMPTY_STORAGE_SNAPSHOT = { status: 'opening' as const }

function useStorageStatus(): string {
  const storage = useOptionalOfflineStorage()
  const subscribe = useCallback(
    (listener: () => void) => storage?.subscribe(listener) ?? (() => {}),
    [storage],
  )
  const getSnapshot = useCallback(
    () => storage?.getSnapshot() ?? EMPTY_STORAGE_SNAPSHOT,
    [storage],
  )
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  return (snapshot as { status: string }).status
}

const EMPTY_STORAGE_SNAPSHOT_FULL = {
  status: 'opening',
  blockedMessage: null as string | null,
}

function useStorageSnapshot(): {
  status: string
  blockedMessage: string | null
} {
  const storage = useOptionalOfflineStorage()
  const subscribe = useCallback(
    (listener: () => void) => storage?.subscribe(listener) ?? (() => {}),
    [storage],
  )
  const getSnapshot = useCallback(() => {
    try {
      const snap = storage?.getSnapshot() as unknown as {
        status: string
        blockedMessage: string | null
      } | null
      // Store snapshots are referentially stable between emits; only the
      // opening fallback is a shared constant so getSnapshot stays cached.
      return snap ?? EMPTY_STORAGE_SNAPSHOT_FULL
    } catch {
      return EMPTY_STORAGE_SNAPSHOT_FULL
    }
  }, [storage])
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

const EMPTY_SYNC_SNAPSHOT = {
  phase: null as string | null,
  currentGroupName: null as string | null,
  lastCompletedFullPassAt: null as number | null,
  syncErrorCount: 0,
}

function useSyncSnapshot(): {
  phase: string | null
  currentGroupName: string | null
  lastCompletedFullPassAt: number | null
  syncErrorCount: number
} {
  const sync = useOptionalOfflineSync()
  const subscribe = useCallback(
    (listener: () => void) => sync?.subscribe(listener) ?? (() => {}),
    [sync],
  )
  // getSnapshot must return a cached reference: sync.getStatus() is stable
  // between emits, so derive a memoized view keyed by the status object
  // itself instead of allocating a fresh wrapper on every call.
  const getStatusSnapshot = useCallback(() => {
    try {
      return sync?.getStatus() ?? null
    } catch {
      return null
    }
  }, [sync])
  const status = useSyncExternalStore(
    subscribe,
    getStatusSnapshot,
    getStatusSnapshot,
  )
  if (!status) return EMPTY_SYNC_SNAPSHOT
  // Derive primitive view without extra store subscriptions; this object is
  // recreated per render (not per getSnapshot) so it never triggers the
  // “getSnapshot should be cached” infinite loop.
  return {
    phase: status.phase as string,
    currentGroupName: status.currentGroupName,
    lastCompletedFullPassAt: status.lastCompletedFullPassAt,
    syncErrorCount: Object.keys(status.errors ?? {}).length,
  }
}

export type DownloadSummary = {
  storageStatus: string
  storageBlockedMessage: string | null
  total: number
  ready: number
  dirtyCount: number
  errorCount: number
  unsupportedCount: number
  catalogUnsupported: boolean
  hasMore: boolean
  enabled: boolean
  catalogCapturedAt: Date | null
  lastCompletedFullPassAt: Date | null
  currentGroupName: string | null
  syncPhase: string | null
  syncErrorCount: number
  isLoading: boolean
  isRefreshing: boolean
}

export type DownloadStatusKind =
  | 'unavailable'
  | 'blocked'
  | 'quota-error'
  | 'unsupported'
  | 'empty'
  | 'paused'
  | 'needs-update'
  | 'downloading'
  | 'partial'
  | 'available'

/**
 * Pure status resolution for tests and UI. Success needs every group ready with
 * no active failure; dirty forces needs-update; zero groups is explicit empty.
 * Storage failures stay distinct (blocked/quota-error/unavailable) so recovery
 * UI can offer storage Retry/Clear separately from connectivity Retry.
 * Unsupported schemas stay distinct (update copy, no Retry) so an old app never
 * shows a dead download Retry. Downloading comes from the real sync phase
 * (verifying/catalog/downloading), never from query isFetching alone;
 * isRefreshing is only a fallback when no engine exists (signed-out, storage
 * unavailable).
 */
export function resolveDownloadStatusKind(
  summary: DownloadSummary,
): DownloadStatusKind {
  if (summary.storageStatus === 'blocked') return 'blocked'
  if (summary.storageStatus === 'quota-error') return 'quota-error'
  if (
    summary.storageStatus !== 'available' &&
    summary.storageStatus !== 'opening'
  ) {
    return 'unavailable'
  }
  if (summary.catalogUnsupported || summary.unsupportedCount > 0)
    return 'unsupported'
  if (summary.total === 0) return 'empty'
  if (!summary.enabled) return 'paused'
  if (
    summary.dirtyCount > 0 ||
    (summary.ready === summary.total && summary.errorCount > 0)
  ) {
    return 'needs-update'
  }
  if (summary.ready < summary.total) {
    if (summary.syncPhase != null) {
      const active =
        summary.syncPhase === 'verifying' ||
        summary.syncPhase === 'catalog' ||
        summary.syncPhase === 'downloading'
      return active ? 'downloading' : 'partial'
    }
    return summary.isRefreshing ? 'downloading' : 'partial'
  }
  return 'available'
}

/**
 * Aggregate download state for compact status UI.
 *
 * Success requires every catalog group ready with no active failure; dirty
 * groups force “needs updating”. Zero catalog groups is an explicit empty
 * state. Storage failures stay distinct (blocked/quota-error/unavailable) so
 * recovery UI can offer storage Retry/Clear separately from connectivity Retry.
 * Downloading comes from the real sync phase, never query isFetching.
 */
export function useOfflineDownloadSummary(): DownloadSummary {
  const { namespace, generation } = useOfflineSession()
  const repository = useRepository()
  const storageStatus = useStorageStatus()
  const storageSnapshot = useStorageSnapshot()
  const syncSnapshot = useSyncSnapshot()

  const catalogQuery = useQuery({
    queryKey: offlineQueryKey(
      namespace ?? '',
      generation,
      'download-status-catalog',
    ),
    queryFn: async () => {
      if (!repository || !namespace)
        return { kind: 'missing' as const, record: null }
      const result = await repository.readCatalog(namespace)
      if (result.status === 'ready')
        return { kind: 'ready' as const, record: result.record }
      if (result.status === 'unsupported')
        return { kind: 'unsupported' as const, record: null }
      return { kind: 'missing' as const, record: null }
    },
    enabled: !!repository && !!namespace,
    networkMode: 'always',
    staleTime: 5_000,
    retry: false,
  })

  const catalog = (catalogQuery.data?.record ?? null) as CatalogRecord | null
  const catalogUnsupported = catalogQuery.data?.kind === 'unsupported'
  const total = catalog?.groups.length ?? 0

  const groupsQuery = useQuery({
    queryKey: offlineQueryKey(
      namespace ?? '',
      generation,
      'download-status-groups',
      total,
      catalog?.capturedAt?.getTime() ?? 0,
    ),
    queryFn: async () => {
      const fallback = {
        ready: 0,
        dirtyCount: 0,
        unsupportedCount: 0,
        hasMore: false,
        enabled: true,
        catalogCapturedAt: null as Date | null,
        statuses: [] as Array<{ groupId: string; error: boolean }>,
      }
      if (!repository || !namespace) return fallback
      // The enabled flag lives on the control row, not the catalog: after
      // Clear downloads the catalog is gone while control stays disabled.
      // Defaulting to true here would show the switch ON while storage is
      // OFF, and every toggle would write `false` to already-false storage,
      // leaving the user no way back on. Read control first instead.
      const control = await repository.readControl(namespace).catch(() => null)
      const enabled = control?.enabled ?? true
      if (!catalog) {
        return { ...fallback, enabled }
      }
      let ready = 0
      let dirtyCount = 0
      let unsupportedCount = 0
      let hasMore = false
      const statuses: Array<{ groupId: string; error: boolean }> = []
      // Status errors are informational; readiness comes only from commits.
      const statusRows = await repository
        .listGroupStatus(namespace)
        .catch(() => [])
      const errorIds = new Set(
        statusRows
          .filter((row) => row.lastResult === 'error')
          .map((row) => row.groupId),
      )
      for (const entry of catalog.groups) {
        const id = entry.overview.id
        const result = await repository.readGroup(namespace, id)
        if (result.status === 'ready') {
          ready += 1
          if (result.record.dirtySince !== null) dirtyCount += 1
          if (result.record.payload.hasMore) hasMore = true
          if (errorIds.has(id)) {
            statuses.push({ groupId: id, error: true })
          }
        } else if (result.status === 'unsupported') {
          unsupportedCount += 1
        } else {
          if (errorIds.has(id)) {
            statuses.push({ groupId: id, error: true })
          }
        }
      }
      return {
        ready,
        dirtyCount,
        unsupportedCount,
        hasMore,
        enabled,
        catalogCapturedAt: catalog.capturedAt,
        statuses,
      }
    },
    // The control read above runs with or without a catalog so the switch
    // reflects Clear-downloads disabled state instead of defaulting on.
    enabled: !!repository && !!namespace,
    networkMode: 'always',
    staleTime: 5_000,
    retry: false,
  })

  const data = groupsQuery.data
  const ready = data?.ready ?? 0
  const dirtyCount = data?.dirtyCount ?? 0
  const unsupportedCount = data?.unsupportedCount ?? 0
  const hasMore = data?.hasMore ?? false
  const enabled = data?.enabled ?? true
  const errorCount = data?.statuses.filter((s) => s.error).length ?? 0

  const waitingForStorage =
    (!repository || !namespace) && storageStatus === 'opening'
  const waitingForCatalog =
    !!repository && !!namespace && catalogQuery.isLoading
  const waitingForGroups = !!catalog && groupsQuery.isLoading

  // Real sync phase owns “downloading”; query isFetching never implies it.
  // Without an engine (signed-out, storage unavailable) fall back to idle so
  // incomplete inventory reports as partial, never fake downloading.
  const syncPhase = syncSnapshot.phase
  const syncActive =
    syncPhase === 'verifying' ||
    syncPhase === 'catalog' ||
    syncPhase === 'downloading'
  const lastCompletedFullPassAt =
    syncSnapshot.lastCompletedFullPassAt != null
      ? new Date(syncSnapshot.lastCompletedFullPassAt)
      : null

  return {
    storageStatus,
    storageBlockedMessage: storageSnapshot.blockedMessage,
    total,
    ready,
    dirtyCount,
    errorCount,
    unsupportedCount,
    catalogUnsupported,
    hasMore,
    enabled,
    catalogCapturedAt: data?.catalogCapturedAt ?? catalog?.capturedAt ?? null,
    lastCompletedFullPassAt,
    currentGroupName: syncSnapshot.currentGroupName,
    syncPhase,
    syncErrorCount: syncSnapshot.syncErrorCount,
    isLoading: waitingForStorage || waitingForCatalog || waitingForGroups,
    isRefreshing: syncActive,
  }
}

/**
 * Compact in-flow status for home and settings.
 *
 * In-flow only (never a full-screen overlay), `role=status` with polite
 * announcements, no layout-covering positioning. Errors requiring action stay
 * visible via the status text itself, never only a transient toast.
 */
export function OfflineDownloadStatus({ className }: { className?: string }) {
  const { t } = useTranslation()
  const summary = useOfflineDownloadSummary()
  const storage = useOptionalOfflineStorage()

  // No signed-in device identity: nothing to report.
  const { namespace } = useOfflineSession()
  if (!namespace) return null
  if (summary.isLoading) return null

  const kind = resolveDownloadStatusKind(summary)
  let text: string
  if (kind === 'blocked') {
    text = t('OfflineDownloads.statusBlocked')
  } else if (kind === 'quota-error') {
    text = t('OfflineDownloads.statusQuotaError')
  } else if (kind === 'unavailable') {
    text = t('OfflineDownloads.statusUnavailable')
  } else if (kind === 'unsupported') {
    text = t('OfflineDownloads.schemaUnsupported')
  } else if (kind === 'empty') {
    text = t('OfflineDownloads.statusEmpty')
  } else if (kind === 'paused') {
    text = t('OfflineDownloads.statusPaused')
  } else if (kind === 'needs-update') {
    text = t('OfflineDownloads.statusNeedsUpdate')
  } else if (kind === 'downloading') {
    text = t('OfflineDownloads.statusDownloading', {
      ready: summary.ready,
      total: summary.total,
    })
  } else if (kind === 'partial') {
    text = t('OfflineDownloads.statusPartial')
  } else {
    text = t('OfflineDownloads.statusAvailable')
  }

  const showRecent500 =
    summary.hasMore && (kind === 'available' || kind === 'downloading')
  const showSyncGroup =
    kind === 'downloading' && summary.currentGroupName != null
  const showStorageRetry =
    kind === 'blocked' || kind === 'quota-error' || kind === 'unavailable'

  async function handleStorageRetry() {
    try {
      await storage?.retry().catch(() => undefined)
    } catch {
      // Ignore retry failures; status text remains until fixed.
    }
  }

  return (
    <output
      aria-live="polite"
      data-testid="offline-download-status"
      className={cn(
        'block rounded-lg border bg-muted/40 px-4 py-2 text-sm text-muted-foreground',
        className,
      )}
    >
      <span>{text}</span>
      {showSyncGroup ? (
        <span className="mt-0.5 block text-xs">{summary.currentGroupName}</span>
      ) : null}
      {kind === 'blocked' ? (
        <span className="mt-0.5 block text-xs">
          {t('OfflineDownloads.storageBlocked')}
        </span>
      ) : null}
      {kind === 'quota-error' ? (
        <span className="mt-0.5 block text-xs">
          {t('OfflineDownloads.storageQuota')}
        </span>
      ) : null}
      {showRecent500 ? (
        <span className="mt-0.5 block text-xs">
          {t('OfflineDownloads.recent500Note')}
        </span>
      ) : null}
      {showStorageRetry ? (
        <button
          type="button"
          data-testid="storage-retry"
          onClick={() => void handleStorageRetry()}
          className="mt-1 inline-flex min-h-8 items-center rounded-md px-2 text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden"
        >
          {t('OfflineDownloads.storageRetry')}
        </button>
      ) : null}
    </output>
  )
}

function formatRelativeShort(date: Date, now: number, locale: string): string {
  const diffMs = date.getTime() - now
  const absMs = Math.abs(diffMs)
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour
  try {
    const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
    if (absMs < hour) {
      const minutes = Math.round(diffMs / minute)
      if (Math.abs(minutes) < 1) return rtf.format(0, 'second')
      return rtf.format(minutes, 'minute')
    }
    if (absMs < day) {
      return rtf.format(Math.round(diffMs / hour), 'hour')
    }
    return rtf.format(Math.round(diffMs / day), 'day')
  } catch {
    return date.toISOString()
  }
}

function formatExact(date: Date, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(date)
  } catch {
    return date.toISOString()
  }
}

/**
 * Per-group download row: ready/missing, captured time, error with Retry.
 *
 * No `role=status` here and no toasts: the compact status owns the single
 * polite announcement so rows never spam screen readers on every page.
 */
export function OfflineGroupStatus({
  groupId,
  groupName,
}: {
  groupId: string
  groupName: string
}) {
  const { t } = useTranslation()
  const locale = useLocale()
  const { namespace, generation } = useOfflineSession()
  const repository = useRepository()
  const { retry } = useOfflineRetry()
  const sync = useOptionalOfflineSync()
  const queryClient = useQueryClient()

  const recordQuery = useQuery({
    queryKey: offlineQueryKey(
      namespace ?? '',
      generation,
      'group-status',
      groupId,
    ),
    queryFn: async () => {
      if (!repository || !namespace)
        return {
          status: 'missing' as const,
          record: null as GroupRecord | null,
          errorCode: null as string | null,
        }
      const result = await repository.readGroup(namespace, groupId)
      if (result.status === 'ready') {
        const statusRows = await repository
          .listGroupStatus(namespace)
          .catch(() => [])
        const row = statusRows.find((r) => r.groupId === groupId)
        return {
          status: 'ready' as const,
          record: result.record,
          errorCode:
            row?.lastResult === 'error'
              ? (row.lastErrorCode ?? 'storage-unavailable')
              : null,
        }
      }
      if (result.status === 'unsupported') {
        return {
          status: 'unsupported' as const,
          record: null,
          errorCode: null,
        }
      }
      const statusRows = await repository
        .listGroupStatus(namespace)
        .catch(() => [])
      const row = statusRows.find((r) => r.groupId === groupId)
      return {
        status: 'missing' as const,
        record: null,
        errorCode:
          row?.lastResult === 'error'
            ? (row.lastErrorCode ?? 'storage-unavailable')
            : null,
      }
    },
    enabled: !!repository && !!namespace && !!groupId,
    networkMode: 'always',
    staleTime: 5_000,
    retry: false,
  })

  const isReady = recordQuery.data?.status === 'ready'
  const isUnsupported = recordQuery.data?.status === 'unsupported'
  const capturedAt = recordQuery.data?.record?.capturedAt ?? null
  const errorCode = recordQuery.data?.errorCode ?? null
  // oxlint-disable-next-line react/purity -- relative "now" for display only; commit data never uses wall-clock.
  const now = Date.now()
  // Retry only when recovery is possible: the browser reports online and the
  // schema is supported. Unsupported schemas need an app update, never a
  // dead Retry; explicitly offline keeps the honest missing explanation.
  const canRetry =
    !isUnsupported &&
    (typeof navigator === 'undefined' ? true : navigator.onLine !== false)

  async function handleRetry() {
    // Explicit Retry restarts missing/failed work when enabled (never the
    // server Retry-After deadline). Probe first so offline stays honest, then
    // retryFailed, then reload local inventory. No per-group toast: the inline
    // error stays until fixed. Connectivity Retry lives in the banner/status;
    // this button is the download Retry path.
    await retry().catch(() => false)
    try {
      await sync?.retryFailed().catch(() => undefined)
    } catch {
      // Ignore sync retry failures; inline error remains.
    }
    await queryClient
      .invalidateQueries({ queryKey: ['offline', namespace ?? ''] })
      .catch(() => undefined)
  }

  return (
    <li
      data-testid={`offline-group-status-${groupId}`}
      className="flex min-w-0 flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:px-6"
    >
      <div className="min-w-0">
        <p className="truncate font-medium">{groupName}</p>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {isReady
            ? t('OfflineDownloads.statusAvailable')
            : isUnsupported
              ? t('OfflineDownloads.schemaUnsupported')
              : t('OfflineDownloads.groupNotDownloaded')}
          {capturedAt ? (
            <>
              {' · '}
              <time
                dateTime={capturedAt.toISOString()}
                title={formatExact(capturedAt, locale)}
              >
                {formatRelativeShort(capturedAt, now, locale)}
              </time>
            </>
          ) : null}
        </p>
        {capturedAt ? (
          <details className="mt-1 text-xs text-muted-foreground">
            <summary className="cursor-pointer underline decoration-muted-foreground/40 underline-offset-4">
              {formatRelativeShort(capturedAt, now, locale)}
            </summary>
            <p className="mt-1">
              <time dateTime={capturedAt.toISOString()}>
                {formatExact(capturedAt, locale)}
              </time>
            </p>
          </details>
        ) : null}
        {errorCode ? (
          <p className="mt-1 text-sm text-destructive" role="alert">
            {t('OfflineDownloads.downloadFailed')}
          </p>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {recordQuery.isFetching ? (
          <span
            className="inline-block size-4 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-foreground motion-reduce:animate-none"
            aria-hidden="true"
          />
        ) : null}
        {canRetry && (errorCode || !isReady) ? (
          <button
            type="button"
            onClick={() => void handleRetry()}
            className="inline-flex min-h-8 items-center rounded-md px-2 text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden"
          >
            {t('OfflineEmptyState.retry')}
          </button>
        ) : null}
      </div>
    </li>
  )
}

/**
 * Connection-required state for extras (comments/activity/stats/budgets/ member
 * admin/reports/exports/AI/imports). Never launches its network query while
 * offline and never promises persisted data. In-flow only, with back
 * navigation; never a generic full-page error that swallows the feature name.
 */
export function OfflineNeedsConnection({
  backLabel,
  onBack,
  backHref,
}: {
  backLabel: string
  onBack?: () => void
  backHref?: string
}) {
  const { t } = useTranslation()
  return (
    <div
      data-testid="offline-needs-connection"
      className="flex flex-col items-center justify-center gap-3 rounded-lg border bg-card px-4 py-10 text-center"
    >
      <p className="text-sm text-muted-foreground">
        {t('OfflineReadOnly.needsConnection')}
      </p>
      {backHref ? (
        <a
          href={backHref}
          className="text-sm font-medium text-primary underline-offset-4 hover:underline"
        >
          {backLabel}
        </a>
      ) : (
        <button
          type="button"
          onClick={onBack}
          className="text-sm font-medium text-primary underline-offset-4 hover:underline"
        >
          {backLabel}
        </button>
      )}
    </div>
  )
}

/**
 * Missing-download state: explains what is absent, offers Retry only when
 * recovery is possible, plus a link back to groups. Never a generic error.
 */
export function OfflineMissingData({
  description,
  onRetry,
  backLabel,
  backHref,
  onBack,
}: {
  description: string
  onRetry?: () => void
  backLabel: string
  backHref?: string
  onBack?: () => void
}) {
  const { t } = useTranslation()
  const canRetry =
    typeof navigator === 'undefined' ? true : navigator.onLine !== false
  return (
    <div
      data-testid="offline-missing-data"
      className="flex flex-col items-center justify-center gap-3 rounded-lg border bg-card px-4 py-10 text-center"
    >
      <p className="max-w-md text-sm text-muted-foreground">{description}</p>
      <div className="flex flex-wrap items-center justify-center gap-3">
        {onRetry && canRetry ? (
          <button
            type="button"
            onClick={onRetry}
            className="text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            {t('OfflineEmptyState.retry')}
          </button>
        ) : null}
        {backHref ? (
          <a
            href={backHref}
            className="text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            {backLabel}
          </a>
        ) : onBack ? (
          <button
            type="button"
            onClick={onBack}
            className="text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            {backLabel}
          </button>
        ) : null}
      </div>
    </div>
  )
}
