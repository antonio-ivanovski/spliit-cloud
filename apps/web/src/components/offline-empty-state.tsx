/* oxlint-disable jsx-a11y/prefer-tag-over-role -- status role is retained for the live offline announcement. */
import { WifiOff } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export function OfflineEmptyState({
  variant = 'card',
  title,
  description,
  detail,
  onRetry,
}: {
  variant?: 'card' | 'page' | 'plain'
  title?: string
  description?: string
  detail?: string
  onRetry?: () => void
}) {
  const { t } = useTranslation()

  return (
    <div
      role="status"
      data-testid="offline-empty-state"
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
        <WifiOff className="size-6" aria-hidden="true" />
      </span>
      <div className="max-w-md">
        <h2 className="font-medium">{title ?? t('OfflineEmptyState.title')}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {description ?? t('OfflineEmptyState.description')}
        </p>
        {detail ? (
          <p className="mt-2 text-sm text-muted-foreground">{detail}</p>
        ) : null}
      </div>
      {onRetry ? (
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
          {t('OfflineEmptyState.retry')}
        </Button>
      ) : null}
    </div>
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
 * Missing-data state: explains what is absent, offers Retry only when recovery
 * is possible, plus a link back to groups. Never a generic error.
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
