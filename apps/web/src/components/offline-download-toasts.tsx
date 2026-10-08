import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { ToastAction } from '@/components/ui/toast'
import { useToast } from '@/components/ui/use-toast'
import {
  useOfflineRetry,
  useOptionalOfflineSyncStatus,
} from '@/lib/offline/provider'
import type { SyncStatusSnapshot } from '@/lib/offline/sync'

export type ToastableDownloadKind =
  | 'quota-error'
  | 'needs-update'
  | 'unavailable'

/** Minimum interval before re-toasting the same kind. */
export const DOWNLOAD_TOAST_COOLDOWN_MS = 5 * 60 * 1000

/**
 * Pure mapping from the sync engine snapshot to the toast-worthy download
 * state. Only errors and user-fixable warnings toast: quota exhaustion, failed
 * passes, and disabled storage. Transient states (verifying, catalog,
 * downloading, paused-connectivity, rate-limited) and healthy states (idle,
 * done, cancelled, cleared) stay silent — connectivity loss already has the
 * offline banner, and progress banners were removed as noise.
 */
export function selectDownloadToastKind(
  status: SyncStatusSnapshot | null,
): ToastableDownloadKind | null {
  if (!status) return null
  switch (status.phase) {
    case 'quota-error':
      return 'quota-error'
    case 'failed':
      return 'needs-update'
    case 'disabled':
      return 'unavailable'
    default:
      return null
  }
}

/**
 * Edge-triggered error toasts for offline downloads. Mount once beside
 * `OfflineSyncHost` in AppShell.
 *
 * Anti-spam: toasts only on transition _into_ a toastable kind (tracked via
 * ref, never on every render), keeps a single live toast (dismisses the
 * previous id on kind change/exit), and applies a per-kind cooldown so a
 * repeatedly failing pass (`downloading` → `failed` loops) cannot spam.
 * StrictMode-safe: the double-invoked effect is a no-op the second time because
 * `prevKind` is already set. Returns null UI.
 */
export function OfflineDownloadToasts() {
  const status = useOptionalOfflineSyncStatus()
  const { retry } = useOfflineRetry()
  const { toast, dismiss } = useToast()
  const { t } = useTranslation()
  const prevKindRef = useRef<ToastableDownloadKind | null>(null)
  const toastIdRef = useRef<string | undefined>(undefined)
  const lastShownAtRef = useRef<Partial<Record<ToastableDownloadKind, number>>>(
    {},
  )

  useEffect(() => {
    const kind = selectDownloadToastKind(status)
    if (kind === prevKindRef.current) return
    prevKindRef.current = kind
    if (toastIdRef.current !== undefined) {
      try {
        dismiss(toastIdRef.current)
      } catch {
        // Dismissal must never break sync status handling.
      }
      toastIdRef.current = undefined
    }
    if (!kind) return
    const now = Date.now()
    if (
      now - (lastShownAtRef.current[kind] ?? 0) <
      DOWNLOAD_TOAST_COOLDOWN_MS
    ) {
      return
    }
    lastShownAtRef.current[kind] = now
    const description =
      kind === 'quota-error'
        ? t('OfflineDownloads.storageQuota')
        : kind === 'needs-update'
          ? t('OfflineDownloads.statusNeedsUpdate')
          : t('OfflineDownloads.statusUnavailable')
    const retryLabel = t('OfflineEmptyState.retry')
    const handle = toast({
      description,
      variant: 'destructive',
      action: (
        <ToastAction altText={retryLabel} onClick={() => void retry()}>
          {retryLabel}
        </ToastAction>
      ),
    })
    toastIdRef.current = handle.id
  }, [status, retry, toast, dismiss, t])

  return null
}
