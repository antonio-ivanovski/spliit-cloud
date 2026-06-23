import { useLocale, useTranslations } from '@/i18n/react'
import { Currency } from '@/lib/currency'
import { formatCurrency } from '@/lib/utils'

type Props = {
  totalGroupSpendings: number
  currency: Currency
}

export function TotalsGroupSpending({ totalGroupSpendings, currency }: Props) {
  const locale = useLocale()
  const t = useTranslations('Stats.Totals')
  const balance = totalGroupSpendings < 0 ? 'groupEarnings' : 'groupSpendings'
  return (
    <div data-testid="total-group-spendings">
      <div className="text-muted-foreground">{t(balance)}</div>
      <div className="text-lg">
        {formatCurrency(currency, Math.abs(totalGroupSpendings), locale)}
      </div>
    </div>
  )
}
