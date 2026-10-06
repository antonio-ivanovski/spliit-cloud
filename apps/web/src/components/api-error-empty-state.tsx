import { CloudOff } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { getStatusPageUrl } from '@/lib/status-page'
import { cn } from '@/lib/utils'

/**
 * Empty state for screens with no in-session data when the browser is online
 * but the API cannot be reached. Mirrors {@link OfflineEmptyState} layout so
 * the two states are visually siblings — but the copy blames the server, and a
 * status-page link is offered only when the deployment configured one
 * (`VITE_STATUS_PAGE_URL`; hidden for self-hosters without a status page).
 */
export function ApiErrorEmptyState({
  variant = 'card',
  onRetry,
}: {
  variant?: 'card' | 'page' | 'plain'
  onRetry?: () => void
}) {
  const { t } = useTranslation()
  const statusPageUrl = getStatusPageUrl()

  return (
    <div
      role="alert"
      data-testid="api-error-empty-state"
      className={cn(
        'flex flex-col items-center justify-center gap-3 text-center',
        variant === 'page'
          ? 'flex-1 px-4 py-10'
          : variant === 'plain'
            ? 'py-4'
            : 'rounded-lg border bg-card px-4 py-10',
      )}
    >
      <span className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <CloudOff className="size-6" aria-hidden="true" />
      </span>
      <div className="max-w-md">
        <h2 className="font-medium">{t('ApiErrorEmptyState.title')}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('ApiErrorEmptyState.description')}
        </p>
      </div>
      <div className="flex items-center justify-center gap-2">
        {onRetry ? (
          <Button type="button" variant="outline" size="sm" onClick={onRetry}>
            {t('ApiErrorEmptyState.retry')}
          </Button>
        ) : null}
        {statusPageUrl ? (
          <a
            href={statusPageUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md px-3 text-sm font-medium text-muted-foreground underline-offset-4 hover:bg-accent hover:text-accent-foreground hover:underline"
          >
            {t('ApiStatusBanner.statusLink')}
          </a>
        ) : null}
      </div>
    </div>
  )
}
