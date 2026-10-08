import { Link } from '@tanstack/react-router'
import { SearchX } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * Shared "not found" card. Visual sibling of {@link ApiErrorEmptyState} and
 * {@link OfflineEmptyState} (centered muted icon, title + description, actions
 * row) — but the copy blames the URL, never the server or connection.
 *
 * Defaults to the generic page copy (`NotFoundPage.title/description`); callers
 * with a known-missing resource (deleted expense/budget) pass their own
 * title/description and hide the home link.
 */
export function NotFoundPage({
  variant = 'page',
  title,
  description,
  onRetry,
  retryLabel,
  showHomeLink = true,
  homeLabel,
  showBackButton = true,
  backLabel,
  onBack,
  actions,
}: {
  variant?: 'card' | 'page' | 'plain'
  title?: string
  description?: string
  onRetry?: () => void
  retryLabel?: string
  showHomeLink?: boolean
  homeLabel?: string
  showBackButton?: boolean
  backLabel?: string
  onBack?: () => void
  actions?: ReactNode
}) {
  const { t } = useTranslation()
  const resolvedTitle = title ?? t('NotFoundPage.title')
  const resolvedDescription = description ?? t('NotFoundPage.description')

  const handleBack = () => {
    if (onBack) {
      onBack()
    } else if (typeof window !== 'undefined') {
      window.history.back()
    }
  }

  return (
    <div
      data-testid="not-found-page"
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
        <SearchX className="size-6" aria-hidden="true" />
      </span>
      <div className="max-w-md">
        <h2 className="font-medium">{resolvedTitle}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {resolvedDescription}
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        {onRetry ? (
          <Button type="button" variant="outline" size="sm" onClick={onRetry}>
            {retryLabel ?? t('NotFoundPage.retry')}
          </Button>
        ) : null}
        {showHomeLink ? (
          <Button
            type="button"
            variant={onRetry ? 'ghost' : 'outline'}
            size="sm"
            nativeButton={false}
            render={<Link to="/" />}
          >
            {homeLabel ?? t('NotFoundPage.goHome')}
          </Button>
        ) : null}
        {showBackButton ? (
          <Button type="button" variant="ghost" size="sm" onClick={handleBack}>
            {backLabel ?? t('NotFoundPage.goBack')}
          </Button>
        ) : null}
        {actions}
      </div>
    </div>
  )
}
