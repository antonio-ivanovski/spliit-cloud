import { useLocale } from '@/i18n/react'
import { Currency } from '@/lib/currency'
import { cn, formatCurrency } from '@/lib/utils'
import { useTranslation } from 'react-i18next'

export function TotalsYourShare({
  totalParticipantShare = 0,
  currency,
}: {
  totalParticipantShare?: number
  currency: Currency
}) {
  const locale = useLocale()
  const { t } = useTranslation(undefined, { keyPrefix: 'Stats.Totals' })

  return (
    <div data-testid="your-total-share">
      <div className="text-muted-foreground">{t('yourShare')}</div>
      <div
        className={cn(
          'text-lg',
          totalParticipantShare < 0 ? 'text-green-600' : 'text-red-600',
        )}
      >
        {formatCurrency(currency, Math.abs(totalParticipantShare), locale)}
      </div>
    </div>
  )
}
