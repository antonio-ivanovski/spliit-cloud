/* oxlint-disable jsx-a11y/prefer-tag-over-role -- status role is retained for the live offline announcement. */
import { WifiOff } from 'lucide-react'
import { useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'

import { getDefaultConnectivityStore } from '@/lib/offline/connectivity'

/**
 * In-flow banner below the app header. Sticky so it stays visible, but it
 * occupies layout space so it cannot cover the page heading.
 *
 * Persistent only when disconnected/recovering or the server is unavailable:
 *
 * - Transport `unreachable` → offline, read-only copy (never promises sync).
 * - Distinct server failure (HTTP 5xx or captive portal) → outage copy.
 * - `unknown` while a recovery probe is in flight → reconnecting copy.
 *
 * Uses the shared connectivity store (navigator status plus failed-fetch latch
 * plus bounded liveness probes). DevTools "service worker offline" often leaves
 * `navigator.onLine` true.
 */
export function OfflineBanner() {
  const { t } = useTranslation()
  const snapshot = useSyncExternalStore(
    getDefaultConnectivityStore().subscribe,
    getDefaultConnectivityStore().getSnapshot,
    getDefaultConnectivityStore().getSnapshot,
  )

  // Synchronous browser hint so a freshly-set `navigator.onLine === false`
  // reports offline even before the store's `offline` event fires.
  // False-positive `navigator.onLine === true` never clears an `unreachable`
  // transport.
  const browserOffline =
    typeof navigator !== 'undefined' && navigator.onLine === false
  const isUnreachable = snapshot.transport === 'unreachable' || browserOffline
  const serverUnavailable = !isUnreachable && snapshot.serverFailure !== null
  const isRecovering =
    !isUnreachable &&
    !serverUnavailable &&
    snapshot.transport === 'unknown' &&
    snapshot.probeInFlight

  if (!isUnreachable && !serverUnavailable && !isRecovering) return null

  const message = isUnreachable
    ? t('OfflineBanner.message')
    : serverUnavailable
      ? t('OfflineBanner.serverUnavailable')
      : t('OfflineBanner.reconnecting')

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="offline-banner"
      className="sticky top-(--app-header-height) z-40 shrink-0 border-b bg-amber-100 text-amber-900 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:slide-in-from-top-full motion-reduce:animate-none dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100"
    >
      <div className="flex items-center justify-center gap-2 px-4 py-2 text-sm">
        <WifiOff className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span>{message}</span>
      </div>
    </div>
  )
}
