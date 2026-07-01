import { useLocale } from '@/i18n/react'
import type { Currency } from '@/lib/currency'
import { formatCurrency } from '@/lib/utils'

export function ParticipantRowAmountPreview({
  amount,
  currency,
}: {
  amount: number | null
  currency: Currency
}) {
  const locale = useLocale()
  if (amount == null || Number.isNaN(amount)) return null
  return (
    <span className="text-muted-foreground ml-2">
      ({formatCurrency(currency, Math.round(amount), locale)})
    </span>
  )
}
