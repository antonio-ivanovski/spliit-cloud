import { MoreHorizontal } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import type { CategoryId } from '@spliit/domain'
// react-doctor-disable-next-line react-doctor/prefer-dynamic-import -- file is lazy-loaded via React.lazy() from spending-chart.tsx
import {
  Bar,
  BarChart,
  type BarShapeProps,
  CartesianGrid,
  Rectangle,
  ResponsiveContainer,
  Tooltip,
  type TooltipContentProps,
  XAxis,
  YAxis,
} from 'recharts'

import { useLocale } from '@/i18n/react'
import type { Currency } from '@/lib/currency'
import { amountAsDecimal, formatCurrency, formatDateOnly } from '@/lib/utils'

import { CategoryIcon } from '../expenses/category-icon'
import {
  categoryFromId,
  categoryLabel,
  getCategoryColor,
  otherCategoryColor,
} from './category-utils'
import type { StatsDashboardData } from './dashboard-types'

type Props = {
  data: StatsDashboardData
  currency: Currency
}

type ChartRow = {
  label: string
  date: Date
  isGap: boolean
  total: number
  other: number
} & Partial<Record<CategoryId, number>>

type StackKey = CategoryId | 'other'

type CategoryBarShapeProps = BarShapeProps & {
  categoryId: StackKey
}

function formatBucket(
  date: Date,
  granularity: 'DAY' | 'WEEK' | 'MONTH',
  locale: string,
) {
  const includeYear = date.getUTCFullYear() !== new Date().getUTCFullYear()
  return formatDateOnly(date, locale, {
    ...(granularity === 'MONTH'
      ? { month: 'short' }
      : { day: 'numeric', month: 'short' }),
    ...(includeYear ? { year: '2-digit' } : {}),
  })
}

const compactNumberFormatCache = new Map<string, Intl.NumberFormat>()
const currencyNumberFormatCache = new Map<string, Intl.NumberFormat>()

function getCompactNumberFormat(locale: string) {
  let fmt = compactNumberFormatCache.get(locale)
  if (!fmt) {
    fmt = new Intl.NumberFormat(locale, {
      notation: 'compact',
      maximumFractionDigits: 1,
    })
    compactNumberFormatCache.set(locale, fmt)
  }
  return fmt
}

function getCurrencyNumberFormat(locale: string, currencyCode: string) {
  const key = `${locale}:${currencyCode}`
  let fmt = currencyNumberFormatCache.get(key)
  if (!fmt) {
    fmt = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: currencyCode,
      notation: 'compact',
      maximumFractionDigits: 1,
    })
    currencyNumberFormatCache.set(key, fmt)
  }
  return fmt
}

function formatCompactCurrency(
  currency: Currency,
  amount: number,
  locale: string,
) {
  const value = amountAsDecimal(amount, currency)
  const numberFormat = getCompactNumberFormat(locale)

  if (!currency.code) return `${numberFormat.format(value)} ${currency.symbol}`

  return getCurrencyNumberFormat(locale, currency.code).format(value)
}

function CategoryBarShape({
  categoryId,
  payload,
  value,
  x,
  y,
  width,
  height,
  fill,
  ...rectangleProps
}: CategoryBarShapeProps) {
  const row = payload as ChartRow | undefined
  const stackEnd = Array.isArray(value) ? value[1] : value
  const isTopSegment =
    row != null && Math.abs(Number(stackEnd) - row.total) < 0.5
  const canShowIcon = categoryId !== 'other' && width >= 28 && height >= 36
  const iconSize = height >= 64 ? 13 : 10
  const iconOffset = (iconSize + 6) / 2

  return (
    <g>
      <Rectangle
        {...rectangleProps}
        x={x}
        y={y}
        width={width}
        height={height}
        fill={fill}
        radius={isTopSegment ? [6, 6, 0, 0] : 0}
      />
      {canShowIcon && x != null && y != null && (
        <g
          aria-hidden
          pointerEvents="none"
          transform={`translate(${x + width / 2 - iconOffset}, ${y + height / 2 - iconOffset})`}
        >
          <rect
            width={iconSize + 6}
            height={iconSize + 6}
            rx={3}
            fill="rgb(255 255 255 / 0.16)"
          />
          <CategoryIcon
            category={categoryFromId(categoryId)}
            x={3}
            y={3}
            width={iconSize}
            height={iconSize}
            color="rgb(255 255 255 / 0.82)"
            strokeWidth={2.25}
          />
        </g>
      )}
    </g>
  )
}

const granularityKey = {
  DAY: 'granularity.DAY',
  WEEK: 'granularity.WEEK',
  MONTH: 'granularity.MONTH',
} as const

export function SpendingChart({ data, currency }: Props) {
  const { t } = useTranslation(undefined, { keyPrefix: 'Stats.Dashboard' })
  const locale = useLocale()
  const period = data.period
  const categories = data.categories.slice(0, 5)
  const chartData = useMemo<Array<ChartRow>>(() => {
    if (!period) return []
    return data.timeline.map((item) => {
      if (item.type === 'gap') {
        return {
          label: '⋯',
          date: item.start,
          isGap: true,
          total: 0,
          other: 0,
        }
      }
      const row: ChartRow = {
        label: formatBucket(item.start, period.granularity, locale),
        date: item.start,
        isGap: false,
        total: item.total,
        other: item.total,
      }
      const categoryMap = new Map(
        item.categories.map((c) => [c.categoryId, c.amount]),
      )
      for (const category of categories) {
        const amount = categoryMap.get(category.categoryId) ?? 0
        row[category.categoryId] = amount
        row.other -= amount
      }
      return row
    })
  }, [categories, data.timeline, locale, period])

  if (!period || chartData.length === 0) return null
  const currencyLabel = currency.code || currency.symbol

  const renderTooltip = ({ active, payload }: TooltipContentProps) => {
    const row = payload[0]?.payload as ChartRow | undefined
    if (!active || !row || row.isGap) return null

    return (
      <div className="min-w-44 rounded-xl border bg-popover p-3 text-sm shadow-lg">
        <p className="mb-2 text-xs font-medium text-muted-foreground">
          {formatBucket(row.date, period.granularity, locale)}
        </p>
        <div className="space-y-1.5">
          {payload.map((item) => {
            const amount = Number(item.value ?? 0)
            if (amount <= 0) return null
            const categoryId =
              typeof item.dataKey === 'string' ? item.dataKey : undefined
            const category = categories.find(
              (candidate) => candidate.categoryId === categoryId,
            )
            return (
              <div
                key={String(item.dataKey)}
                className="flex items-center justify-between gap-5"
              >
                <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
                  <span
                    className="grid size-5 shrink-0 place-items-center rounded-sm"
                    style={{
                      backgroundColor: `${item.color ?? otherCategoryColor}1a`,
                      color: item.color ?? otherCategoryColor,
                    }}
                  >
                    {category ? (
                      <CategoryIcon
                        category={categoryFromId(category.categoryId)}
                        className="size-3"
                      />
                    ) : (
                      <MoreHorizontal className="size-3" />
                    )}
                  </span>
                  <span className="truncate">
                    {category
                      ? categoryLabel(t, category.categoryId)
                      : t('other')}
                  </span>
                </span>
                <span className="font-medium tabular-nums">
                  {formatCurrency(currency, amount, locale)}
                </span>
              </div>
            )
          })}
        </div>
        <div className="mt-2 flex items-center justify-between border-t pt-2 font-medium">
          <span>{currencyLabel}</span>
          <span className="tabular-nums">
            {formatCurrency(currency, row.total, locale)}
          </span>
        </div>
      </div>
    )
  }

  return (
    <section aria-labelledby="spending-over-time-title">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2
            id="spending-over-time-title"
            className="font-semibold tracking-tight"
          >
            {t('spendingOverTime')}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('bucketedBy', {
              granularity: t(granularityKey[period.granularity]),
            })}
          </p>
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {categories.map((category, index) => (
            <span
              key={category.categoryId}
              className="flex items-center gap-1.5"
            >
              <span
                aria-hidden
                className="grid size-5 place-items-center rounded-sm"
                style={{
                  backgroundColor: `${getCategoryColor(index)}1a`,
                  color: getCategoryColor(index),
                }}
              >
                <CategoryIcon
                  category={categoryFromId(category.categoryId)}
                  className="size-3"
                />
              </span>
              {categoryLabel(t, category.categoryId)}
            </span>
          ))}
          {data.categories.length > categories.length && (
            <span className="flex items-center gap-1.5">
              <span
                aria-hidden
                className="grid size-5 place-items-center rounded-sm"
                style={{
                  backgroundColor: `${otherCategoryColor}1a`,
                  color: otherCategoryColor,
                }}
              >
                <MoreHorizontal className="size-3" />
              </span>
              {t('other')}
            </span>
          )}
        </div>
      </div>
      <div className="h-76 min-h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={chartData}
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
              axisLine={false}
              tickLine={false}
              width={56}
              tick={{ fill: 'currentColor', fontSize: 12, opacity: 0.62 }}
              tickFormatter={(amount: number) =>
                formatCompactCurrency(currency, amount, locale)
              }
            />
            <Tooltip
              cursor={{ fill: 'currentColor', fillOpacity: 0.045 }}
              content={renderTooltip}
            />
            {categories.map((category, index) => (
              <Bar
                key={category.categoryId}
                dataKey={category.categoryId}
                name={categoryLabel(t, category.categoryId)}
                stackId="spending"
                fill={getCategoryColor(index)}
                shape={(props: BarShapeProps) => (
                  <CategoryBarShape
                    {...props}
                    categoryId={category.categoryId}
                  />
                )}
                maxBarSize={54}
              />
            ))}
            {data.categories.length > categories.length && (
              <Bar
                dataKey="other"
                name={t('other')}
                stackId="spending"
                fill={otherCategoryColor}
                shape={(props: BarShapeProps) => (
                  <CategoryBarShape {...props} categoryId="other" />
                )}
                maxBarSize={54}
              />
            )}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  )
}
