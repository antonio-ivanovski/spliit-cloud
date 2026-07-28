import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { useLocale } from '@/i18n/react'
import type { Currency } from '@/lib/currency'
import { formatCurrency } from '@/lib/utils'

import { CategoryIcon } from '../expenses/category-icon'
import {
  categoryFromId,
  categoryLabel,
  getCategoryColor,
} from './category-utils'
import type { StatsDashboardData } from './dashboard-types'

type Props = {
  data: StatsDashboardData
  currency: Currency
}

function usePercentFormatter(locale: string) {
  return useMemo(
    () =>
      new Intl.NumberFormat(locale, {
        style: 'percent',
        maximumFractionDigits: 0,
      }),
    [locale],
  )
}

export function CategoryBreakdown({ data, currency }: Props) {
  const { t } = useTranslation(undefined, { keyPrefix: 'Stats.Dashboard' })
  const locale = useLocale()
  const percentFormatter = usePercentFormatter(locale)

  return (
    <section aria-labelledby="category-breakdown-title">
      <h2
        id="category-breakdown-title"
        className="font-semibold tracking-tight"
      >
        {t('categories')}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {t('categoriesDescription')}
      </p>
      <div className="mt-5 space-y-4">
        {data.categories.slice(0, 6).map((category, index) => (
          <div key={category.categoryId}>
            <div className="mb-1.5 flex items-center gap-2 text-sm">
              <span
                className="grid size-7 place-items-center rounded-md"
                style={{
                  backgroundColor: `${getCategoryColor(index)}1a`,
                  color: getCategoryColor(index),
                }}
              >
                <CategoryIcon
                  category={categoryFromId(category.categoryId)}
                  className="size-3.5"
                />
              </span>
              <span className="min-w-0 flex-1 truncate">
                {categoryLabel(t, category.categoryId)}
              </span>
              <span className="font-medium tabular-nums">
                {formatCurrency(currency, category.amount, locale)}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${Math.max(category.percentage * 100, 3)}%`,
                    backgroundColor: getCategoryColor(index),
                  }}
                />
              </div>
              <span className="w-9 text-right text-xs text-muted-foreground tabular-nums">
                {percentFormatter.format(category.percentage)}
              </span>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
