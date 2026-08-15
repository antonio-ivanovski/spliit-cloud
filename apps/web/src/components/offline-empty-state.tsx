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
