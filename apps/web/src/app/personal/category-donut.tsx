import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { CategoryIcon } from '@/app/groups/[groupId]/expenses/category-icon'
import {
  categoryFromId,
  categoryLabel,
  getCategoryColor,
} from '@/app/groups/[groupId]/stats/category-utils'
import { useLocale } from '@/i18n/react'
import { getCurrency } from '@/lib/currency'
import { formatCurrency } from '@/lib/utils'
import type { CategoryId } from '@spliit/domain'
// react-doctor-disable-next-line react-doctor/prefer-dynamic-import -- small donut, keep in the overview bundle.
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'

type Slice = { categoryId: string; amount: number; percentage: number }

type Props = {
  slices: Slice[]
  currencyCode: string
  maxRows?: number
}

/**
 * Category donut for the overview: a recharts donut with the top categories
 * plus a ranked list beneath. Percentages come from the server; the chart is
 * decorative (`aria-hidden`) while the list carries the accessible values.
 */
export function PersonalCategoryDonut({
  slices,
  currencyCode,
  maxRows = 6,
}: Props) {
  const { t: tCategories } = useTranslation(undefined, {
    keyPrefix: 'Categories',
  })
  const locale = useLocale()
  const currency = getCurrency(currencyCode)
  const rows = useMemo(() => slices.slice(0, maxRows), [slices, maxRows])
  const formatAmount = (amount: number) =>
    currency ? formatCurrency(currency, amount, locale) : String(amount)

  if (rows.length === 0) return null

  const data = rows.map((slice, index) => ({
    name: categoryLabel(tCategories, slice.categoryId as CategoryId),
    value: slice.amount,
    fill: getCategoryColor(index),
  }))

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
      <div className="mx-auto h-44 w-44 shrink-0" aria-hidden="true">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Tooltip formatter={(value) => [formatAmount(Number(value)), '']} />
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              innerRadius={52}
              outerRadius={72}
              paddingAngle={2}
              strokeWidth={0}
            >
              {data.map((entry) => (
                <Cell key={entry.name} fill={entry.fill} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ul className="min-w-0 flex-1 space-y-2.5">
        {rows.map((slice, index) => (
          <li
            key={slice.categoryId}
            className="flex items-center gap-2 text-sm"
          >
            <span
              aria-hidden="true"
              className="grid size-7 shrink-0 place-items-center rounded-md"
              style={{
                backgroundColor: `${getCategoryColor(index)}1a`,
                color: getCategoryColor(index),
              }}
            >
              <CategoryIcon
                category={categoryFromId(slice.categoryId as CategoryId)}
                className="size-3.5"
              />
            </span>
            <span className="min-w-0 flex-1 truncate">
              {categoryLabel(tCategories, slice.categoryId as CategoryId)}
            </span>
            <span className="shrink-0 font-medium tabular-nums">
              {formatAmount(slice.amount)}
            </span>
            <span className="w-10 shrink-0 text-end text-xs text-muted-foreground tabular-nums">
              {Math.round(slice.percentage * 100)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
