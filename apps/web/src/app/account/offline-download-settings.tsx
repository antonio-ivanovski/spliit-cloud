import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, type LucideIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  OfflineGroupStatus,
  resolveDownloadStatusKind,
  useOfflineDownloadSummary,
} from '@/components/offline-download-status'
import { Button } from '@/components/ui/button'
import {
  ResponsiveDialog as Dialog,
  ResponsiveDialogBody as DialogBody,
  ResponsiveDialogContent as DialogContent,
  ResponsiveDialogDescription as DialogDescription,
  ResponsiveDialogFooter as DialogFooter,
  ResponsiveDialogHeader as DialogHeader,
  ResponsiveDialogTitle as DialogTitle,
} from '@/components/ui/responsive-dialog'
import { Switch } from '@/components/ui/switch'
import { useLocale } from '@/i18n/react'
import type { CatalogRecord } from '@/lib/offline/contract'
import {
  useOfflineRetry,
  useOfflineSession,
  useOptionalOfflineLifecycle,
  useOptionalOfflineStorage,
  useOptionalOfflineSync,
} from '@/lib/offline/provider'
import { offlineQueryKey } from '@/lib/offline/read-model'

import {
  SettingsFieldRow,
  SettingsList,
  SettingsRow,
  SettingsSection,
  settingsControlId,
} from './settings-ui'

function useCatalogForSettings(): CatalogRecord | null {
  const { namespace, generation } = useOfflineSession()
  const storage = useOptionalOfflineStorage()
  let repository: ReturnType<NonNullable<typeof storage>['getRepository']> =
    null
  try {
    repository = storage?.getRepository() ?? null
  } catch {
    repository = null
  }
  const query = useQuery({
    queryKey: offlineQueryKey(namespace ?? '', generation, 'settings-catalog'),
    queryFn: async () => {
      if (!repository || !namespace) return null
      const result = await repository.readCatalog(namespace)
      return result.status === 'ready' ? result.record : null
    },
    enabled: !!repository && !!namespace,
    networkMode: 'always',
    staleTime: 5_000,
    retry: false,
  })
  return (query.data ?? null) as CatalogRecord | null
}

function formatExactDate(date: Date, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(date)
  } catch {
    return date.toISOString()
  }
}

function formatBytes(bytes: number, locale: string): string {
  try {
    const units = ['B', 'KB', 'MB', 'GB'] as const
    let value = bytes
    let unit: (typeof units)[number] = 'B'
    for (const next of units) {
      unit = next
      if (value < 1024 || next === 'GB') break
      value /= 1024
    }
    const formatted = new Intl.NumberFormat(locale, {
      maximumFractionDigits: unit === 'B' ? 0 : 1,
    }).format(value)
    return `${formatted} ${unit}`
  } catch {
    return `${bytes} B`
  }
}

/**
 * Device offline controls.
 *
 * Local appearance/locale/download settings stay usable offline; remote
 * preference writes are never queued. Automatic downloads default on for a
 * newly verified namespace (repository `ensureControl`). Clearing removes only
 * catalog/group/status rows, never SW caches, appearance, or server data, and
 * disables automatic work so cleared data is not immediately repopulated.
 *
 * Shown for anonymous accounts too: the namespace is per-device account, and
 * all actions are local-only.
 */
export function OfflineDownloadSettings() {
  const { t } = useTranslation()
  const locale = useLocale()
  const { namespace, cleanupError } = useOfflineSession()
  const storage = useOptionalOfflineStorage()
  const sync = useOptionalOfflineSync()
  const lifecycle = useOptionalOfflineLifecycle()
  const summary = useOfflineDownloadSummary()
  const catalog = useCatalogForSettings()
  const { retry } = useOfflineRetry()
  const queryClient = useQueryClient()

  const [clearOpen, setClearOpen] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [persistState, setPersistState] = useState<
    'idle' | 'kept' | 'not-kept'
  >('idle')
  const [storageEstimate, setStorageEstimate] = useState<string | null>(null)

  function getRepository() {
    try {
      return storage?.getRepository() ?? null
    } catch {
      return null
    }
  }

  useEffect(() => {
    let cancelled = false
    async function loadEstimate() {
      try {
        const nav = navigator as Navigator & {
          storage?: { estimate?: () => Promise<{ usage?: number }> }
        }
        const estimate = await nav.storage?.estimate?.()
        if (cancelled) return
        if (typeof estimate?.usage === 'number') {
          setStorageEstimate(formatBytes(estimate.usage, locale))
        } else {
          setStorageEstimate(null)
        }
      } catch {
        if (!cancelled) setStorageEstimate(null)
      }
    }
    void loadEstimate()
    return () => {
      cancelled = true
    }
  }, [locale, summary.ready, summary.total])

  async function invalidateOffline() {
    await queryClient
      .invalidateQueries({ queryKey: ['offline', namespace ?? ''] })
      .catch(() => undefined)
  }

  async function handleToggleEnabled(next: boolean) {
    setActionError(null)
    // Prefer the sync engine (lease-fenced, cancels in-flight passes);
    // fall back to direct repository writes when no engine exists.
    if (sync) {
      try {
        await sync.setEnabled(next)
        await invalidateOffline()
        if (next) {
          await retry().catch(() => false)
          await invalidateOffline()
        }
        return
      } catch {
        setActionError(t('OfflineDownloads.statusUnavailable'))
        return
      }
    }
    const repository = getRepository()
    if (!repository || !namespace) {
      setActionError(t('OfflineDownloads.statusUnavailable'))
      return
    }
    try {
      const control = await repository.readControl(namespace).catch(() => null)
      const generation = control?.generation ?? 0
      await repository.setEnabled({ namespace, generation, enabled: next })
      await invalidateOffline()
      if (next) {
        // Re-enabling starts a fresh pass: probe recovery so the next trigger
        // can download. Failures stay inline; no toast here.
        await retry().catch(() => false)
        await invalidateOffline()
      }
    } catch {
      setActionError(t('OfflineDownloads.statusUnavailable'))
    }
  }

  async function handleRefresh() {
    setActionError(null)
    if (!summary.enabled) return
    try {
      // Explicit Refresh now downloads all catalog groups once (only when
      // enabled). Probe first so offline stays honest, then refreshNow.
      await retry().catch(() => false)
      if (sync) {
        await sync.refreshNow().catch(() => undefined)
      }
      await invalidateOffline()
    } catch {
      setActionError(t('OfflineDownloads.statusUnavailable'))
    }
  }

  async function handleStorageRetry() {
    setActionError(null)
    try {
      await storage?.retry().catch(() => undefined)
      await invalidateOffline()
    } catch {
      setActionError(t('OfflineDownloads.statusUnavailable'))
    }
  }

  async function handleClear() {
    setActionError(null)
    // Prefer the sync engine (increments generation, disables, broadcasts).
    if (sync) {
      try {
        await sync.clearDownloads()
        await invalidateOffline()
        setClearOpen(false)
        return
      } catch {
        setActionError(t('OfflineDownloads.statusUnavailable'))
        return
      }
    }
    const repository = getRepository()
    if (!repository || !namespace) {
      setActionError(t('OfflineDownloads.statusUnavailable'))
      return
    }
    try {
      const control = await repository.readControl(namespace).catch(() => null)
      const generation = control?.generation ?? 0
      await repository.clearDownloads({ namespace, generation })
      try {
        // Cross-tab fallback notification; fencing itself owns correctness.
        window.localStorage.setItem(
          'spliit:offline:event',
          JSON.stringify({
            type: 'cleared',
            namespace,
            generation: generation + 1,
            nonce: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
          }),
        )
      } catch {
        // Ignore broadcast failures.
      }
      await invalidateOffline()
      setClearOpen(false)
    } catch {
      setActionError(t('OfflineDownloads.statusUnavailable'))
    }
  }

  async function handleKeepOnDevice() {
    // No automatic prompt: only an explicit click reaches persist().
    // Denied/unsupported never blocks downloads; storage stays browser-managed.
    try {
      const nav = navigator as Navigator & {
        storage?: { persist?: () => Promise<boolean> }
      }
      if (typeof nav.storage?.persist !== 'function') {
        setPersistState('not-kept')
        return
      }
      const kept = await nav.storage.persist()
      setPersistState(kept ? 'kept' : 'not-kept')
    } catch {
      setPersistState('not-kept')
    }
  }

  if (!namespace) return null

  // Last updated uses the last completed full pass, never catalog time.
  // Hide when the inventory is incomplete/dirty/failed so a partial pass
  // never reads as “updated”.
  const hasIncomplete =
    summary.total !== summary.ready ||
    summary.dirtyCount > 0 ||
    summary.errorCount > 0 ||
    summary.syncErrorCount > 0
  const lastUpdatedText =
    summary.lastCompletedFullPassAt != null && !hasIncomplete
      ? t('OfflineDownloads.lastUpdated', {
          date: formatExactDate(summary.lastCompletedFullPassAt, locale),
        })
      : null

  const statusKind = resolveDownloadStatusKind(summary)
  const statusText = summary.isLoading
    ? ''
    : statusKind === 'downloading'
      ? t('OfflineDownloads.statusDownloading', {
          ready: summary.ready,
          total: summary.total,
        })
      : statusKind === 'available'
        ? t('OfflineDownloads.statusAvailable')
        : statusKind === 'partial'
          ? t('OfflineDownloads.statusPartial')
          : statusKind === 'paused'
            ? t('OfflineDownloads.statusPaused')
            : statusKind === 'needs-update'
              ? t('OfflineDownloads.statusNeedsUpdate')
              : statusKind === 'empty'
                ? t('OfflineDownloads.statusEmpty')
                : statusKind === 'blocked'
                  ? t('OfflineDownloads.statusBlocked')
                  : statusKind === 'quota-error'
                    ? t('OfflineDownloads.statusQuotaError')
                    : statusKind === 'unsupported'
                      ? t('OfflineDownloads.schemaUnsupported')
                      : t('OfflineDownloads.statusUnavailable')
  const showSyncGroup =
    statusKind === 'downloading' && summary.currentGroupName != null
  const showStorageBlocked = statusKind === 'blocked'
  const showStorageQuota = statusKind === 'quota-error'

  return (
    <>
      <SettingsSection
        id="offline-downloads"
        title={t('OfflineDownloads.title')}
        description={t('OfflineDownloads.description')}
        icon={Download as LucideIcon}
      >
        <SettingsList className="border-t border-border/70">
          <SettingsFieldRow
            id="offline-automatic-downloads"
            label={t('OfflineDownloads.automatic')}
            description={t('OfflineDownloads.automaticDescription')}
            control={
              <Switch
                id={settingsControlId('offline-automatic-downloads')}
                checked={summary.enabled}
                onCheckedChange={(checked) => void handleToggleEnabled(checked)}
                aria-label={t('OfflineDownloads.automatic')}
              />
            }
          />
          <div
            id="offline-download-counts"
            className="flex min-w-0 flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:gap-6 sm:px-6"
          >
            <div className="min-w-0">
              <p className="min-w-0 font-medium break-words">
                {t('OfflineDownloads.refreshNow')} /{' '}
                {t('OfflineDownloads.clear')}
              </p>
              <div className="mt-0.5 flex flex-col gap-1 text-sm text-muted-foreground">
                {/* oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- span keeps inline layout; polite announcement required. */}
                <span role="status" aria-live="polite">
                  {statusText}
                </span>
                {showSyncGroup ? <span>{summary.currentGroupName}</span> : null}
                {showStorageBlocked ? (
                  <span>{t('OfflineDownloads.storageBlocked')}</span>
                ) : null}
                {showStorageQuota ? (
                  <span>{t('OfflineDownloads.storageQuota')}</span>
                ) : null}
                {(statusKind === 'blocked' ||
                  statusKind === 'quota-error' ||
                  statusKind === 'unavailable') &&
                !summary.isLoading ? (
                  <span>
                    <button
                      type="button"
                      data-testid="storage-retry"
                      onClick={() => void handleStorageRetry()}
                      className="inline-flex min-h-8 items-center rounded-md px-2 text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden"
                    >
                      {t('OfflineDownloads.storageRetry')}
                    </button>
                  </span>
                ) : null}
                {lastUpdatedText ? <span>{lastUpdatedText}</span> : null}
                {storageEstimate ? (
                  <span>
                    {t('OfflineDownloads.storageEstimate', {
                      size: storageEstimate,
                    })}
                  </span>
                ) : null}
                {cleanupError ? (
                  <span
                    className="text-destructive"
                    role="alert"
                    data-testid="offline-cleanup-error"
                  >
                    {t('OfflineDownloads.cleanupFailed')}{' '}
                    <button
                      type="button"
                      data-testid="cleanup-retry"
                      onClick={() => void lifecycle?.retryCleanup?.()}
                      className="font-medium underline underline-offset-4 hover:no-underline"
                    >
                      {t('OfflineEmptyState.retry')}
                    </button>
                  </span>
                ) : null}
                {actionError ? (
                  <span className="text-destructive" role="alert">
                    {actionError}
                  </span>
                ) : null}
              </div>
            </div>
            <div className="flex w-full shrink-0 sm:w-auto">
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void handleRefresh()}
                  disabled={!summary.enabled}
                >
                  {t('OfflineDownloads.refreshNow')}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setClearOpen(true)}
                >
                  {t('OfflineDownloads.clear')}
                </Button>
              </div>
            </div>
          </div>
          <SettingsRow
            id="offline-keep-on-device"
            label={t('OfflineDownloads.keepOnDevice')}
            description={
              <span className="flex flex-col gap-1">
                <span>{t('OfflineDownloads.keepOnDeviceDescription')}</span>
                {persistState === 'kept' ? (
                  /* oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- inline persist result needs polite status. */
                  <span role="status">
                    {t('OfflineDownloads.keepOnDeviceKept')}
                  </span>
                ) : persistState === 'not-kept' ? (
                  /* oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- inline persist result needs polite status. */
                  <span role="status">
                    {t('OfflineDownloads.keepOnDeviceNotKept')}
                  </span>
                ) : null}
              </span>
            }
            control={
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void handleKeepOnDevice()}
              >
                {t('OfflineDownloads.keepOnDevice')}
              </Button>
            }
          />
          {catalog && catalog.groups.length > 0 ? (
            <li className="min-w-0">
              <ul className="divide-y divide-border/70">
                {catalog.groups.map((entry) => (
                  <OfflineGroupStatus
                    key={entry.overview.id}
                    groupId={entry.overview.id}
                    groupName={
                      entry.overview.displayName ?? entry.overview.name
                    }
                  />
                ))}
              </ul>
            </li>
          ) : null}
        </SettingsList>
      </SettingsSection>

      <Dialog open={clearOpen} onOpenChange={setClearOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('OfflineDownloads.clear')}</DialogTitle>
            <DialogDescription>
              {t('OfflineDownloads.clearConfirm')}
            </DialogDescription>
          </DialogHeader>
          <DialogBody />
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setClearOpen(false)}
            >
              {t('Header.cancel')}
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void handleClear()}
            >
              {t('OfflineDownloads.clear')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
