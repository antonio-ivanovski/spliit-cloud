import type { Currency } from '@/lib/currency'
import { formatCurrency } from '@/lib/utils'
import { useTranslation } from 'react-i18next'

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
  if (items.length === 0) return null
  const visibleItems = items.slice(0, 3)
  const remaining = items.length - visibleItems.length

  return (
    <section className="space-y-2">
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {t('items.title')}
      </h3>
      <div className="space-y-1 text-sm">
        {visibleItems.map((item) => (
          <div key={item.id} className="flex items-center gap-3">
            <span className="min-w-0 flex-1 truncate">{item.title}</span>
            <span className="shrink-0 tabular-nums text-muted-foreground">
              {formatCurrency(currency, item.amount, locale)}
            </span>
          </div>
        ))}
        {remaining > 0 && (
          <div className="text-xs text-muted-foreground">
            {t('items.more', { count: remaining })}
          </div>
        )}
      </div>
    </section>
  )
}
