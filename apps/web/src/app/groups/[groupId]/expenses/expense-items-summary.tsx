import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { Currency } from '@/lib/currency'
import { formatCurrency } from '@/lib/utils'

import { ExpenseItemsOverflowToggle } from './expense-items-overflow-toggle'

type Item = {
  id: string
  title: string
  amount: number
}

export function ExpenseItemsSummary({
  items,
  currency,
  locale,
}: {
  items: Item[]
  currency: Currency
  locale: string
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'ExpenseCard' })
  const [expanded, setExpanded] = useState(false)
  if (items.length === 0) return null

  const maxPreview = 3
  const remaining = items.length - maxPreview
  const visibleItems =
    expanded || remaining <= 0 ? items : items.slice(0, maxPreview)

  return (
    <section className="space-y-2">
      <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {t('items.title')}
      </h3>
      <div className="space-y-1 text-sm">
        {visibleItems.map((item) => (
          <div key={item.id} className="flex items-center gap-3">
            <span className="min-w-0 flex-1 truncate">{item.title}</span>
            <span className="shrink-0 text-muted-foreground tabular-nums">
              {formatCurrency(currency, item.amount, locale)}
            </span>
          </div>
        ))}
        {remaining > 0 && (
          <ExpenseItemsOverflowToggle
            expanded={expanded}
            remaining={remaining}
            onToggle={() => setExpanded((open) => !open)}
          />
        )}
      </div>
    </section>
  )
}
