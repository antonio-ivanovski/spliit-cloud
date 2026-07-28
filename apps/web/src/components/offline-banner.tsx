/* oxlint-disable jsx-a11y/prefer-tag-over-role -- status role is retained for the live offline announcement. */
import { WifiOff } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { useOnlineStatus } from '@/lib/use-online-status'

/**
 * Top-of-viewport banner that surfaces when the browser goes offline.
 *
 * Uses `navigator.onLine` plus the `online` / `offline` window events. State
 * changes are driven by the browser — not a network probe — so the banner
 * appears immediately when connectivity drops, even before any in-flight
 * requests fail.
 */
export function OfflineBanner() {
  const isOnline = useOnlineStatus()
  const { t } = useTranslation()

  if (isOnline) return null

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="offline-banner"
      className="fixed inset-x-0 top-(--app-header-height) z-40 border-b bg-amber-100 text-amber-900 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:slide-in-from-top-full dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100"
    >
      <div className="flex items-center justify-center gap-2 px-4 py-2 text-sm">
        <WifiOff className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span>{t('OfflineBanner.message')}</span>
      </div>
    </div>
  )
}
