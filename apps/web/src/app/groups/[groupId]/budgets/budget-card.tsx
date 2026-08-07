import {
  ArrowUpRight,
  CalendarDays,
  Layers,
  TrendingUp,
  Users,
} from 'lucide-react'
import type { ComponentProps } from 'react'
import { useTranslation } from 'react-i18next'

import {
  CategoryChipVisual,
  IconChipVisual,
  ParticipantChipVisual,
  ScopeChipList,
  categoryScopeLabel,
} from '@/app/groups/[groupId]/budgets/budget-scope'
import { resolveBudgetStatus } from '@/app/groups/[groupId]/budgets/budget-status'
import { BudgetUsageBar } from '@/app/groups/[groupId]/budgets/budget-usage-bar'
import Link from '@/components/link'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { useLocale } from '@/i18n/react'
import { getCurrencyFromGroup } from '@/lib/currency'
import { cn, formatCurrency, formatDateOnly } from '@/lib/utils'
import { formatBudgetPeriodRange, getCategoryById } from '@spliit/domain'

import { useBudgetTranslation } from './budget-i18n'
import type { BudgetSummary } from './budget-types'

type Participant = ComponentProps<typeof ParticipantChipVisual>['participant']

type Props = {
  budget: BudgetSummary
  groupId: string
  group: {
    currency: string
    currencyCode: string | null
    participants: Array<Participant>
  }
  compact?: boolean
}

function dateValue(value: Date | string) {
  return value instanceof Date ? value : new Date(value)
}

export function BudgetCard({ budget, groupId, group, compact = false }: Props) {
  const t = useBudgetTranslation()
  const { t: tCategories } = useTranslation(undefined, {
    keyPrefix: 'Categories',
  })
  const locale = useLocale()
  const period = budget.period
  const currency = getCurrencyFromGroup(group)
  const lifecycle = budget.archived ? 'ARCHIVED' : period.lifecycle
  const { isOver, isTrending, visual, isScheduled, isCompleted, isArchived } =
    resolveBudgetStatus({ ...period, lifecycle })
  const hasExceededLimit = period.remaining < 0 && !isScheduled
  const statusLabel = isArchived
    ? t('status.archived')
    : isScheduled
      ? t('status.scheduled')
      : isCompleted
        ? t('status.completed')
        : isOver
          ? t('status.over')
          : isTrending
            ? t('status.trending')
            : t('status.onTrack')
  const statusBadge = (className?: string) => (
    <Badge
      variant={visual.badgeVariant}
      className={cn('shrink-0 gap-1', className)}
    >
      {isTrending && <TrendingUp className="size-3.5" aria-hidden="true" />}
      {statusLabel}
    </Badge>
  )

  const categoryItems =
    budget.categoryScope === 'ALL'
      ? [
          {
            id: 'all',
            label: t('allCategories'),
            leading: <IconChipVisual icon={Layers} size="sm" />,
          },
        ]
      : budget.categoryNodeIds.map((id) => {
          const category = getCategoryById(id)
          return {
            id,
            label: categoryScopeLabel(tCategories, id),
            leading: category ? (
              <CategoryChipVisual category={category} size="sm" />
            ) : undefined,
          }
        })
  const participantItems =
    budget.participantScope === 'ALL'
      ? [
          {
            id: 'all',
            label: t('allParticipants'),
            leading: <IconChipVisual icon={Users} size="sm" />,
          },
        ]
      : budget.participantIds.map((pid) => {
          const participant = group.participants.find((p) => p.id === pid)
          return {
            id: pid,
            label: participant?.name ?? pid,
            leading: participant ? (
              <ParticipantChipVisual participant={participant} size="sm" />
            ) : undefined,
          }
        })

  return (
    <Link
      href={`/groups/${groupId}/budgets/${budget.id}`}
      className="block rounded-lg outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Card className="mobile-surface transition-shadow hover:shadow-md">
        <CardContent className="space-y-3 p-4 sm:p-5">
          <div className="flex flex-col gap-3 sm:grid sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start sm:gap-6">
            <div className="min-w-0 space-y-1">
              <div className="flex items-center justify-between gap-3">
                <span className="min-w-0 truncate text-base font-semibold sm:text-lg">
                  {budget.name}
                </span>
                {statusBadge('sm:hidden')}
              </div>
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
                <CalendarDays className="size-3.5" aria-hidden="true" />
                <span>
                  {formatBudgetPeriodRange(
                    budget.periodType,
                    dateValue(period.from),
                    dateValue(period.to),
                    (date) =>
                      formatDateOnly(date, locale, { dateStyle: 'medium' }),
                  )}
                </span>
                {isScheduled ? (
                  <span className="text-xs">
                    {(period.daysUntilStart ?? 0) === 0
                      ? t('startsToday')
                      : t('startsIn', {
                          count: period.daysUntilStart ?? 0,
                        })}
                  </span>
                ) : isCompleted ? (
                  <span className="text-xs">{t('completed')}</span>
                ) : (
                  <span className="text-xs">
                    {t('daysRemaining', { count: period.daysRemaining })}
                  </span>
                )}
              </p>
              <div className="space-y-1 pt-0.5">
                <ScopeChipList items={categoryItems} size="sm" />
                <ScopeChipList items={participantItems} size="sm" />
              </div>
            </div>
            <div className="flex items-end justify-between gap-2 sm:flex-col sm:items-end sm:gap-1">
              {statusBadge('hidden sm:inline-flex')}
              <div className="sm:text-end">
                <p className="text-2xl font-semibold tabular-nums">
                  {formatCurrency(currency, period.used, locale)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t('ofLimit', {
                    amount: formatCurrency(currency, period.limit, locale),
                  })}
                </p>
              </div>
              <div className="text-end">
                <p
                  className={cn(
                    'text-sm font-medium tabular-nums',
                    (isOver || hasExceededLimit) && visual.textClass,
                  )}
                >
                  {isOver || hasExceededLimit
                    ? t('overBy', {
                        amount: formatCurrency(
                          currency,
                          Math.abs(period.remaining),
                          locale,
                        ),
                      })
                    : t('remaining', {
                        amount: formatCurrency(
                          currency,
                          period.remaining,
                          locale,
                        ),
                      })}
                </p>
                {period.projected != null &&
                  !compact &&
                  !isArchived &&
                  !isScheduled &&
                  !isCompleted && (
                    <p className="text-xs text-muted-foreground">
                      {t('projected', {
                        amount: formatCurrency(
                          currency,
                          period.projected,
                          locale,
                        ),
                      })}
                    </p>
                  )}
              </div>
            </div>
          </div>
          <BudgetUsageBar
            used={period.used}
            limit={period.limit}
            daysElapsed={Math.max(
              0,
              (period.daysTotal ?? period.daysRemaining + 1) -
                period.daysRemaining,
            )}
            daysTotal={period.daysTotal ?? period.daysRemaining + 1}
            visual={visual}
            ariaLabel={t('progressLabel', {
              percentage: Math.round(period.percentage),
            })}
          />
          <div className="flex items-center justify-end gap-3 text-xs text-muted-foreground">
            <span className="inline-flex shrink-0 items-center gap-1">
              {t('viewDetails')}
              <ArrowUpRight className="size-3.5" aria-hidden="true" />
            </span>
          </div>
        </CardContent>
      </Card>
    </Link>
  )
}

export function BudgetCardSkeleton() {
  return (
    <Card className="mobile-surface">
      <CardContent className="space-y-4 p-4 sm:p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="w-full max-w-xs space-y-2">
            <div className="h-5 w-2/3 animate-pulse rounded bg-muted" />
            <div className="h-4 w-full animate-pulse rounded bg-muted" />
          </div>
          <div className="h-8 w-24 animate-pulse rounded bg-muted" />
        </div>
        <div className="h-2 w-full animate-pulse rounded bg-muted" />
      </CardContent>
    </Card>
  )
}
