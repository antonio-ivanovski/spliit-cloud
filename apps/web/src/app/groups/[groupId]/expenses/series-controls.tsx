import Link from '@/components/link'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ChevronLeft, ChevronRight, Repeat2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useLinkInviteToken } from '../use-link-invite-token'

export type ExpenseSeriesMetadata = {
  id: string
  sequence: number
  status?: 'ACTIVE' | 'PAUSED' | 'COMPLETED' | 'CANCELLED'
  previousExpenseId?: string | null
  nextExpenseId?: string | null
}

export function RecurringBadge({ className }: { className?: string }) {
  const { t } = useTranslation(undefined, { keyPrefix: 'ExpenseSeries' })
  return (
    <Badge variant="outline" className={className}>
      <Repeat2 className="mr-1 h-3 w-3" aria-hidden="true" />
      {t('badge')}
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
  const linkInviteToken = useLinkInviteToken()
  const expenseHref = (expenseId: string) =>
    `/groups/${groupId}/expenses/${expenseId}${
      linkInviteToken ? `?invite=${encodeURIComponent(linkInviteToken)}` : ''
    }`

  return (
    <div className="flex flex-wrap items-center gap-2 border-t pt-4">
      <RecurringBadge />
      <span className="mr-auto text-sm text-muted-foreground">
        {t('occurrence', { sequence: series.sequence })}
      </span>
      {series.previousExpenseId ? (
        <Button variant="outline" size="sm" asChild>
          <Link href={expenseHref(series.previousExpenseId)}>
            <ChevronLeft className="mr-1 h-4 w-4" aria-hidden="true" />
            {t('previous')}
          </Link>
        </Button>
      ) : (
        <Button variant="outline" size="sm" disabled aria-label={t('previous')}>
          <ChevronLeft className="mr-1 h-4 w-4" aria-hidden="true" />
          {t('previous')}
        </Button>
      )}
      {series.nextExpenseId ? (
        <Button variant="outline" size="sm" asChild>
          <Link href={expenseHref(series.nextExpenseId)}>
            {t('next')}
            <ChevronRight className="ml-1 h-4 w-4" aria-hidden="true" />
          </Link>
        </Button>
      ) : (
        <Button variant="outline" size="sm" disabled aria-label={t('next')}>
          {t('next')}
          <ChevronRight className="ml-1 h-4 w-4" aria-hidden="true" />
        </Button>
      )}
      {onViewSeries ? (
        <Button variant="ghost" size="sm" onClick={onViewSeries}>
          {t('viewSeries')}
        </Button>
      ) : (
        <Button variant="ghost" size="sm" asChild>
          <Link
            href={`/groups/${groupId}/expenses?seriesId=${series.id}${
              linkInviteToken
                ? `&invite=${encodeURIComponent(linkInviteToken)}`
                : ''
            }`}
          >
            {t('viewSeries')}
          </Link>
        </Button>
      )}
    </div>
  )
}
