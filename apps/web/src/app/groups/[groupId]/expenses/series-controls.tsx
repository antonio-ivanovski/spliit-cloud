import { Link } from '@tanstack/react-router'
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Play,
  Repeat2,
  X,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export type ExpenseSeriesMetadata = {
  id: string
  sequence: number
  status?: 'ACTIVE' | 'PAUSED' | 'COMPLETED' | 'CANCELLED'
  previousExpenseId?: string | null
  nextExpenseId?: string | null
}

export function RecurringBadge({
  className,
  status,
}: {
  className?: string
  status?: ExpenseSeriesMetadata['status']
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'ExpenseSeries' })
  const isTerminal = status === 'CANCELLED' || status === 'COMPLETED'
  const isActive = status === 'ACTIVE' || status === 'PAUSED'
  const label = isTerminal
    ? status === 'CANCELLED'
      ? t('badgeStopped')
      : t('badgeCompleted')
    : t('badgeRunning')

  return (
    <Badge
      variant="outline"
      className={cn(
        className,
        isActive && 'border-green-500/50 text-green-700 dark:text-green-400',
        status === 'CANCELLED' && 'border-destructive/50 text-destructive',
        status === 'COMPLETED' &&
          'border-emerald-500/50 text-emerald-700 dark:text-emerald-400',
      )}
    >
      <Repeat2 className="me-1 h-3 w-3" aria-hidden="true" />
      {isActive && <Play className="me-0.5 h-2.5 w-2.5" aria-hidden="true" />}
      {status === 'CANCELLED' && (
        <X className="me-0.5 h-2.5 w-2.5" aria-hidden="true" />
      )}
      {status === 'COMPLETED' && (
        <Check className="me-0.5 h-2.5 w-2.5" aria-hidden="true" />
      )}
      <span className="sr-only">{t('badge')}: </span>
      {label}
    </Badge>
  )
}

export function SeriesControls({
  groupId,
  series,
  onViewSeries,
}: {
  groupId: string
  series: ExpenseSeriesMetadata
  onViewSeries?: () => void
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'ExpenseSeries' })

  return (
    <div className="flex flex-wrap items-center gap-2 border-t pt-4">
      <RecurringBadge status={series.status} />
      <span className="me-auto text-sm text-muted-foreground">
        {t('occurrence', { sequence: series.sequence })}
      </span>
      {series.previousExpenseId ? (
        <Button
          variant="outline"
          size="sm"
          render={
            <Link
              to="/groups/$groupId/expenses/$expenseId"
              params={{ groupId, expenseId: series.previousExpenseId }}
            />
          }
        >
          <ChevronLeft
            className="me-1 h-4 w-4 rtl:rotate-180"
            aria-hidden="true"
          />
          {t('previous')}
        </Button>
      ) : (
        <Button variant="outline" size="sm" disabled aria-label={t('previous')}>
          <ChevronLeft
            className="me-1 h-4 w-4 rtl:rotate-180"
            aria-hidden="true"
          />
          {t('previous')}
        </Button>
      )}
      {series.nextExpenseId ? (
        <Button
          variant="outline"
          size="sm"
          render={
            <Link
              to="/groups/$groupId/expenses/$expenseId"
              params={{ groupId, expenseId: series.nextExpenseId }}
            />
          }
        >
          {t('next')}
          <ChevronRight
            className="ms-1 h-4 w-4 rtl:rotate-180"
            aria-hidden="true"
          />
        </Button>
      ) : (
        <Button variant="outline" size="sm" disabled aria-label={t('next')}>
          {t('next')}
          <ChevronRight
            className="ms-1 h-4 w-4 rtl:rotate-180"
            aria-hidden="true"
          />
        </Button>
      )}
      {onViewSeries ? (
        <Button variant="ghost" size="sm" onClick={onViewSeries}>
          {t('viewSeries')}
        </Button>
      ) : (
        <Button
          variant="ghost"
          size="sm"
          render={
            <Link
              to="/groups/$groupId/expenses"
              params={{ groupId }}
              search={{ seriesId: series.id }}
            />
          }
        >
          {t('viewSeries')}
        </Button>
      )}
    </div>
  )
}
