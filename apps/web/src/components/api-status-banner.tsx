import { CloudOff } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { getStatusPageUrl } from '@/lib/status-page'
import { useConnectivityStatus } from '@/lib/use-online-status'

/**
 * Error banner shown when the browser is online but the API cannot be reached
 * (connection failures or 5xx). Unlike {@link OfflineBanner}, it blames the
 * server — never the user's connection — and links to the deployment's status
 * page when one is configured (`VITE_STATUS_PAGE_URL`). Self-hosters without a
 * status page get the warning with no external link.
 */
export function ApiStatusBanner() {
  const status = useConnectivityStatus()
  const { t } = useTranslation()
  const statusPageUrl = getStatusPageUrl()

  if (status !== 'server-unreachable') return null

  return (
    <div
      role="alert"
      data-testid="api-status-banner"
      className="sticky top-(--app-header-height) z-40 shrink-0 border-b border-red-200 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-100"
    >
      <div className="flex items-center justify-center gap-2 px-4 py-2 text-sm">
        <CloudOff className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span>{t('ApiStatusBanner.message')}</span>
        {statusPageUrl ? (
          <a
            href={statusPageUrl}
            target="_blank"
            rel="noreferrer"
            className="shrink-0 font-medium underline underline-offset-2"
          >
            {t('ApiStatusBanner.statusLink')}
          </a>
        ) : null}
      </div>
    </div>
  )
}
