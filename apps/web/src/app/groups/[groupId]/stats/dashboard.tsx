import { CategoryBreakdown } from '@/app/groups/[groupId]/stats/category-breakdown'
import { ParticipantBreakdown } from '@/app/groups/[groupId]/stats/participant-breakdown'
import { StatsPeriodPicker } from '@/app/groups/[groupId]/stats/period-picker'
import { SpendingChart } from '@/app/groups/[groupId]/stats/spending-chart'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useLocale } from '@/i18n/react'
import { getCurrencyFromGroup, type Currency } from '@/lib/currency'
import { formatCurrency } from '@/lib/utils'
import { trpc } from '@/trpc/client'
import { keepPreviousData } from '@tanstack/react-query'
import {
  CalendarDays,
  ChartNoAxesCombined,
  LoaderCircle,
  ReceiptText,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useCurrentGroup } from '../current-group-context'
import { useLinkInviteToken } from '../use-link-invite-token'
import type { StatsCustomRange, StatsPeriod } from './dashboard-types'

function formatDateInput(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function SummaryCard({
  title,
  amount,
  detail,
  currency,
  icon: Icon,
  isPending = false,
}: {
  title: string
  amount: number
  detail: string
  currency: Currency
  icon: typeof ChartNoAxesCombined
  isPending?: boolean
}) {
  const locale = useLocale()
  return (
    <Card className="relative overflow-hidden border-primary/10 bg-linear-to-br from-primary/7 via-card to-card shadow-none">
      <CardContent className="p-5">
        <Icon
          className="absolute right-4 top-4 size-8 text-primary/15"
          aria-hidden
        />
        {isPending && (
          <LoaderCircle
            className="absolute bottom-4 right-4 size-4 animate-spin text-primary/60"
            aria-hidden
          />
        )}
        <p className="text-sm text-muted-foreground">{title}</p>
        <p className="mt-2 text-2xl font-semibold tracking-tight tabular-nums">
          {formatCurrency(currency, amount, locale)}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
      </CardContent>
    </Card>
  )
}

function DashboardLoading() {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Skeleton className="h-32" />
        <Skeleton className="h-32" />
      </div>
      <Skeleton className="h-80" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-72" />
        <Skeleton className="h-72" />
      </div>
    </div>
  )
}

export function StatsDashboard() {
  const { t } = useTranslation(undefined, { keyPrefix: 'Stats.Dashboard' })
  const { groupId, group } = useCurrentGroup()
  const linkInviteToken = useLinkInviteToken()
  const locale = useLocale()
  const dateRange = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      }),
    [locale],
  )
  const [period, setPeriod] = useState<StatsPeriod>('LATEST_ACTIVITY')
  const [customRange, setCustomRange] = useState<StatsCustomRange | null>(null)
  const { data, error, refetch, isFetching } = trpc.groups.stats.get.useQuery(
    {
      groupId,
      linkInviteToken,
      period,
      customRange:
        period === 'CUSTOM' && customRange
          ? {
              from: new Date(`${customRange.from}T00:00:00.000Z`),
              to: new Date(`${customRange.to}T00:00:00.000Z`),
            }
          : undefined,
    },
    { placeholderData: keepPreviousData },
  )

  if (error && !data) {
    return (
      <Card className="border-destructive/30 shadow-none">
        <CardContent className="flex min-h-56 flex-col items-center justify-center gap-3 p-6 text-center">
          <p className="text-sm text-muted-foreground">{t('error')}</p>
          <button
            type="button"
            className="text-sm font-medium text-primary underline-offset-4 hover:underline"
            onClick={() => refetch()}
          >
            {t('retry')}
          </button>
        </CardContent>
      </Card>
    )
  }

  if (!data || !group) return <DashboardLoading />

  const { dashboard } = data
  const currency = getCurrencyFromGroup(group)
  if (!dashboard.period) {
    return (
      <Card className="border-dashed shadow-none">
        <CardContent className="flex min-h-72 flex-col items-center justify-center p-6 text-center">
          <ReceiptText className="size-8 text-primary/60" aria-hidden />
          <h2 className="mt-4 font-semibold">{t('emptyTitle')}</h2>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">
            {t('emptyDescription')}
          </p>
        </CardContent>
      </Card>
    )
  }
  const activePeriod = dashboard.period
  const periodDates = `${dateRange.format(activePeriod.from)} – ${dateRange.format(activePeriod.to)}`

  const handlePeriodChange = (nextPeriod: StatsPeriod) => {
    if (nextPeriod === 'CUSTOM' && !customRange) {
      setCustomRange({
        from: formatDateInput(activePeriod.from),
        to: formatDateInput(activePeriod.to),
      })
    }
    setPeriod(nextPeriod)
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col justify-between gap-4 rounded-xl border bg-linear-to-br from-primary/8 via-background to-background p-5 sm:flex-row sm:items-center">
        <div>
          <p className="text-sm font-medium">{t('title')}</p>
          <div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
            <CalendarDays className="size-3.5" aria-hidden />
            <span>{periodDates}</span>
          </div>
        </div>
        <StatsPeriodPicker
          value={period}
          customRange={customRange}
          onValueChange={handlePeriodChange}
          onCustomRangeChange={setCustomRange}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <SummaryCard
          title={t('lifetime')}
          amount={dashboard.lifetimeTotal}
          detail={t('lifetimeDescription')}
          currency={currency}
          icon={ChartNoAxesCombined}
        />
        <SummaryCard
          title={t('selectedPeriod')}
          amount={dashboard.period.total}
          detail={t('expenseCount', { count: dashboard.period.expenseCount })}
          currency={currency}
          icon={ReceiptText}
          isPending={isFetching}
        />
      </div>

      <Card className="relative overflow-hidden shadow-none">
        {isFetching && (
          <span
            className="absolute inset-x-0 top-0 h-0.5 animate-pulse bg-primary/70"
            aria-hidden
          />
        )}
        <CardContent className="p-5 sm:p-6" aria-busy={isFetching}>
          <SpendingChart data={dashboard} currency={currency} />
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="relative overflow-hidden shadow-none">
          {isFetching && (
            <span
              className="absolute inset-x-0 top-0 h-0.5 animate-pulse bg-primary/70"
              aria-hidden
            />
          )}
          <CardContent className="p-5 sm:p-6" aria-busy={isFetching}>
            <CategoryBreakdown data={dashboard} currency={currency} />
          </CardContent>
        </Card>
        <Card className="relative overflow-hidden shadow-none">
          {isFetching && (
            <span
              className="absolute inset-x-0 top-0 h-0.5 animate-pulse bg-primary/70"
              aria-hidden
            />
          )}
          <CardContent className="p-5 sm:p-6" aria-busy={isFetching}>
            <ParticipantBreakdown data={dashboard} currency={currency} />
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
