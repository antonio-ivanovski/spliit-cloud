/* oxlint-disable jsx-a11y/prefer-tag-over-role -- status role is retained for the live offline announcement. */
import { WifiOff } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { useConnectivityStatus } from '@/lib/use-online-status'

/**
 * In-flow banner below the app header. Sticky so it stays visible, but it
 * occupies layout space so it cannot cover the page heading.
 *
 * Shown only when the browser itself is offline (`navigator.onLine` false).
 * When the browser is online but the API cannot be reached,
 * {@link ApiStatusBanner} takes over instead — the user is not offline, so we
 * must not say they are.
 */
export function OfflineBanner() {
  const status = useConnectivityStatus()
  const { t } = useTranslation()

  if (status !== 'offline') return null

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="offline-banner"
      className="sticky top-(--app-header-height) z-40 shrink-0 border-b bg-amber-100 text-amber-900 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:slide-in-from-top-full dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100"
    >
      <div className="flex items-center justify-center gap-2 px-4 py-2 text-sm">
        <WifiOff className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span>{t('OfflineBanner.message')}</span>
      </div>
    </div>
  )
}
