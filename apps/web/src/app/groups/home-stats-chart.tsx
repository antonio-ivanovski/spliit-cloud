import { useTranslation } from 'react-i18next'
// react-doctor-disable-next-line react-doctor/prefer-dynamic-import -- lazy-loaded by home-stats.tsx
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  type TooltipContentProps,
  XAxis,
  YAxis,
} from 'recharts'

import { useLocale } from '@/i18n/react'
import type { Currency } from '@/lib/currency'
import { formatCurrency, formatDateOnly } from '@/lib/utils'

import { getCategoryColor } from './[groupId]/stats/category-utils'
import { formatCompactCurrency } from './[groupId]/stats/chart-format'
import type { HomeStatsData } from './home-stats'

export function HomeStatsChart({
  timeline,
  currency,
  granularity,
}: {
  timeline: HomeStatsData['currencies'][number]['timeline']
  currency: Currency
  granularity: HomeStatsData['granularity']
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'Homepage.Activity' })
  const { t: tStats } = useTranslation(undefined, {
    keyPrefix: 'Stats.Dashboard',
  })
  const locale = useLocale()
  const rows = timeline.map((bucket) => ({
    ...bucket,
    label: formatDateOnly(
      new Date(`${bucket.date}T00:00:00Z`),
      locale,
      granularity === 'MONTH'
        ? { month: 'short', year: 'numeric' }
        : { day: 'numeric', month: 'short' },
    ),
  }))
  return (
    <section aria-label={t('trend')}>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="font-semibold tracking-tight">{t('trend')}</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {tStats('bucketedBy', {
              granularity: tStats(`granularity.${granularity}`),
            })}
          </p>
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {(['expenses', 'income'] as const).map((metric, index) => (
            <span key={metric} className="flex items-center gap-1.5">
              <span
                className="size-2 rounded-full"
                style={{ backgroundColor: getCategoryColor(index) }}
                aria-hidden
              />
              {t(metric)}
            </span>
          ))}
        </div>
      </div>
      <div className="h-76 min-h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={rows}
            accessibilityLayer
            margin={{ top: 8, right: 4, bottom: 0, left: 0 }}
          >
            <CartesianGrid
              vertical={false}
              stroke="currentColor"
              strokeOpacity={0.08}
            />
            <XAxis
              dataKey="label"
              axisLine={false}
              tickLine={false}
              tick={{ fill: 'currentColor', fontSize: 12, opacity: 0.62 }}
              interval="preserveStartEnd"
            />
            <YAxis
              tickFormatter={(value: number) =>
                formatCompactCurrency(currency, value, locale)
              }
              axisLine={false}
              tickLine={false}
              tick={{ fill: 'currentColor', fontSize: 12, opacity: 0.62 }}
              width={56}
            />
            <Tooltip
              cursor={{ fill: 'currentColor', fillOpacity: 0.045 }}
              content={({ active, payload }: TooltipContentProps) =>
                !active || !payload.length ? null : (
                  <div className="min-w-44 rounded-xl border bg-popover p-3 text-sm shadow-lg">
                    <p className="mb-2 text-xs font-medium text-muted-foreground">
                      {payload[0]?.payload.label}
                    </p>
                    <div className="space-y-1.5">
                      {payload.map((item) => (
                        <div
                          key={String(item.dataKey)}
                          className="flex items-center justify-between gap-5"
                        >
                          <span className="flex items-center gap-1.5 text-muted-foreground">
                            <span
                              className="size-2 rounded-full"
                              style={{ backgroundColor: item.color }}
                              aria-hidden
                            />
                            {item.name}
                          </span>
                          <span className="font-medium tabular-nums">
                            {formatCurrency(
                              currency,
                              Number(item.value),
                              locale,
                            )}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              }
            />
            <Bar
              dataKey="expenses"
              name={t('expenses')}
              fill={getCategoryColor(0)}
              radius={[6, 6, 0, 0]}
              maxBarSize={54}
              isAnimationActive={false}
            />
            <Bar
              dataKey="income"
              name={t('income')}
              fill={getCategoryColor(1)}
              radius={[6, 6, 0, 0]}
              maxBarSize={54}
              isAnimationActive={false}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  )
}
