import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  type TooltipContentProps,
  XAxis,
  YAxis,
} from 'recharts'

import type { BudgetDetail } from '@/app/groups/[groupId]/budgets/budget-types'
import { useLocale } from '@/i18n/react'
import type { Currency } from '@/lib/currency'
import { amountAsDecimal, formatCurrency, formatDateOnly } from '@/lib/utils'
import { resolveFormattingLocale } from '@spliit/domain'

type Props = {
  budget: BudgetDetail
  currency: Currency
}

type ChartPoint = {
  /** Milliseconds since epoch (UTC). */
  date: number
  /** Cumulative actual spend in cents. */
  cumulative: number
  /** Pace line value at this day (0..limit). */
  pace: number
  /** Cumulative spend including committed upcoming contributions. */
  committed: number | null
}

function startOfDayUtc(d: Date | string): number {
  const dt = d instanceof Date ? d : new Date(d)
  return Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate())
}

function tickFormatter(value: number, locale: string) {
  return formatDateOnly(new Date(value), locale, {
    day: 'numeric',
    month: 'short',
  })
}

function areaColor(trendStatus: 'ON_TRACK' | 'TRENDING_OVER' | 'OVER') {
  if (trendStatus === 'OVER') return 'hsl(var(--destructive))'
  if (trendStatus === 'TRENDING_OVER') return 'hsl(38 92% 50%)'
  return 'hsl(160 84% 39%)'
}

function getCompactCurrencyFormat(locale: string, code: string) {
  return new Intl.NumberFormat(resolveFormattingLocale(locale), {
    style: 'currency',
    currency: code,
    notation: 'compact',
    maximumFractionDigits: 1,
  })
}

function compactCurrency(currency: Currency, cents: number, locale: string) {
  const value = amountAsDecimal(cents, currency)
  if (!currency.code) {
    return `${new Intl.NumberFormat(resolveFormattingLocale(locale), { notation: 'compact', maximumFractionDigits: 1 }).format(value)} ${currency.symbol}`
  }
  return getCompactCurrencyFormat(locale, currency.code).format(value)
}

export function BudgetChart({ budget, currency }: Props) {
  const { t } = useTranslation(undefined, { keyPrefix: 'Budgets.chart' })
  const locale = useLocale()
  const period = budget.period

  const series = useMemo<ChartPoint[]>(() => {
    const dayMs = 86_400_000
    const startMs = startOfDayUtc(period.from)
    const endMs = startOfDayUtc(period.to)
    const days = Math.round((endMs - startMs) / dayMs) + 1
    const limit = period.limit
    const todayMs = startOfDayUtc(new Date())

    const dailySpent = new Map<number, number>()
    const upcomingByDay = new Map<number, number>()
    if (period.daily && period.daily.length > 0) {
      for (const point of period.daily) {
        const day = startOfDayUtc(point.date)
        dailySpent.set(day, point.spent)
        upcomingByDay.set(day, point.committed)
      }
    } else {
      for (const expense of budget.matchingExpenses) {
        const day = startOfDayUtc(expense.expenseDate)
        dailySpent.set(day, (dailySpent.get(day) ?? 0) + expense.contribution)
      }
      for (const expense of budget.upcomingExpenses) {
        const day = startOfDayUtc(expense.expenseDate)
        upcomingByDay.set(
          day,
          (upcomingByDay.get(day) ?? 0) + expense.contribution,
        )
      }
    }

    const data: ChartPoint[] = []
    let running = 0
    let committedRunning = 0
    for (let i = 0; i < days; i++) {
      const dayStart = startMs + i * dayMs
      running += dailySpent.get(dayStart) ?? 0
      const paceFraction = days <= 1 ? 0 : i / (days - 1)
      const paceValue = Math.round(paceFraction * limit)
      const committedDelta = upcomingByDay.get(dayStart) ?? 0
      committedRunning += committedDelta
      data.push({
        date: dayStart,
        // After today the actual spent line keeps its last known value so the
        // area slope flattens rather than disappearing.
        cumulative:
          dayStart <= todayMs ? running : (data.at(-1)?.cumulative ?? running),
        pace: paceValue,
        committed:
          committedRunning > 0
            ? running + committedRunning
            : dayStart >= todayMs
              ? running
              : null,
      })
    }
    return data
  }, [budget, period])

  if (series.length === 0) return null

  return (
    <section
      aria-label={t('sectionLabel')}
      data-testid="budget-chart-section"
      className="rounded-lg border bg-card p-3"
    >
      <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
        <span>{t('heading')}</span>
        <span className="flex items-center gap-2">
          <span className="flex items-center gap-1">
            <span className="size-2 rounded-full bg-emerald-500" />
            <span>{t('legendSpent')}</span>
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-0.5 w-3 bg-muted-foreground/70" />
            <span>{t('legendPace')}</span>
          </span>
          {period.committed > 0 && (
            <span className="flex items-center gap-1">
              <span className="inline-block h-0.5 w-3 border-t border-dashed border-primary" />
              <span>{t('legendCommitted')}</span>
            </span>
          )}
        </span>
      </div>
      <div className="h-44 w-full" data-testid="budget-chart-surface">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={series}
            margin={{ top: 6, right: 6, bottom: 0, left: 6 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis
              type="number"
              dataKey="date"
              domain={['dataMin', 'dataMax']}
              tickFormatter={(v: number) => tickFormatter(v, locale)}
              stroke="hsl(var(--muted-foreground))"
              tick={{ fontSize: 11 }}
              minTickGap={32}
            />
            <YAxis
              tickFormatter={(v: number) =>
                compactCurrency(currency, v, locale)
              }
              stroke="hsl(var(--muted-foreground))"
              tick={{ fontSize: 11 }}
              width={56}
            />
            <Tooltip
              content={(props) => (
                <ChartTooltip
                  {...(props as TooltipContentProps<number, string>)}
                  currency={currency}
                  locale={locale}
                />
              )}
            />
            <ReferenceLine
              y={period.limit}
              stroke="hsl(var(--muted-foreground))"
              strokeDasharray="2 4"
              label={{
                value: t('limitLine'),
                position: 'insideTopRight',
                fill: 'hsl(var(--muted-foreground))',
                fontSize: 10,
              }}
            />
            <Area
              type="monotone"
              dataKey="cumulative"
              stroke={areaColor(period.trendStatus)}
              fill={areaColor(period.trendStatus)}
              fillOpacity={0.18}
              strokeWidth={2}
              isAnimationActive={false}
              connectNulls
              dot={false}
            />
            <Line
              type="linear"
              dataKey="pace"
              stroke="hsl(var(--muted-foreground))"
              strokeWidth={1.5}
              strokeDasharray="4 4"
              dot={false}
              isAnimationActive={false}
            />
            {period.committed > 0 && (
              <Line
                type="linear"
                dataKey="committed"
                stroke="hsl(var(--primary))"
                strokeWidth={1.5}
                strokeDasharray="2 2"
                dot={false}
                isAnimationActive={false}
                connectNulls
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="sr-only" data-testid="budget-chart-summary">
        {t('srSummary', {
          spent: formatCurrency(currency, period.used, locale),
          limit: formatCurrency(currency, period.limit, locale),
          committed: formatCurrency(currency, period.committed, locale),
        })}
      </div>
    </section>
  )
}

function ChartTooltip({
  active,
  payload,
  currency,
  locale,
}: TooltipContentProps<number, string> & {
  currency: Currency
  locale: string
}) {
  if (!active || !payload || payload.length === 0) return null
  const point = payload[0]?.payload as ChartPoint | undefined
  if (!point) return null
  return (
    <div className="rounded-md border bg-card p-2 text-xs shadow-md">
      <div className="mb-1 font-medium">
        {tickFormatter(point.date, locale)}
      </div>
      <div className="text-emerald-600 tabular-nums dark:text-emerald-400">
        {formatCurrency(currency, point.cumulative ?? 0, locale)}
      </div>
      {point.committed != null && (
        <div className="text-primary tabular-nums">
          + {formatCurrency(currency, point.committed, locale)}
        </div>
      )}
    </div>
  )
}
