import { useLocale } from '@/i18n/react'
import { cn, formatCurrency } from '@/lib/utils'
import type { Currency, SplitMode } from '@spliit/domain'
import { useTranslation } from 'react-i18next'

/**
 * Footer summary for the "Paid by" and "Paid for" participant lists.
 * For `BY_AMOUNT` and `BY_PERCENTAGE` it tells the user how much is
 * missing or overflowing vs the expense target; for `EVENLY` and
 * `BY_SHARES` it shows a static muted label.
 *
 * Call sites are responsible for normalising shares to the unit the
 * component expects per mode: minor units for BY_AMOUNT, percent for
 * BY_PERCENTAGE, raw weights for BY_SHARES, irrelevant for EVENLY.
 */
export function ParticipantDistributionFooter({
  splitMode,
  targetAmount,
  shares,
  currency,
  paidByCount,
  dataTestId,
}: {
  splitMode: SplitMode
  targetAmount: number
  shares: number[]
  currency: Currency
  paidByCount: number
  dataTestId?: string
}) {
  const { t } = useTranslation(undefined, {
    keyPrefix: 'ExpenseForm.ParticipantDistribution',
  })
  const locale = useLocale()

  let message: string | null = null
  let colorClass = ''

  if (splitMode === 'BY_AMOUNT') {
    const sum = shares.reduce((s, x) => s + x, 0)
    const diff = targetAmount - sum
    const formattedTotal = formatCurrency(currency, targetAmount, locale)
    if (Math.abs(diff) < 0.5) {
      message = t('matches', { total: formattedTotal })
      colorClass = 'text-emerald-600'
    } else if (diff > 0) {
      const formattedMissing = formatCurrency(currency, diff, locale)
      message = t('missing', {
        missing: formattedMissing,
        total: formattedTotal,
      })
      colorClass = 'text-red-600'
    } else {
      const formattedExtra = formatCurrency(currency, -diff, locale)
      message = t('surplus', {
        extra: formattedExtra,
        total: formattedTotal,
      })
      colorClass = 'text-red-600'
    }
  } else if (splitMode === 'BY_PERCENTAGE') {
    const sum = shares.reduce((s, x) => s + x, 0)
    const diff = 100 - sum
    if (Math.abs(diff) < 0.001) {
      message = t('percentageMatches')
      colorClass = 'text-emerald-600'
    } else {
      const pct = (Math.round(diff * 100) / 100).toString()
      message =
        diff > 0
          ? t('percentageMissing', { pct })
          : t('percentageSurplus', { pct: (-diff).toString() })
      colorClass = 'text-red-600'
    }
  } else if (splitMode === 'EVENLY' && paidByCount > 0) {
    const evenAmount = targetAmount / paidByCount
    const formattedAmount = formatCurrency(
      currency,
      Math.round(evenAmount),
      locale,
    )
    message = t('evenlySplit', {
      amount: formattedAmount,
      count: paidByCount,
    })
    colorClass = 'text-muted-foreground'
  } else if (splitMode === 'BY_SHARES') {
    const sum = shares.reduce((s, x) => s + x, 0)
    message = t('sharesTotal', { sum })
    colorClass = 'text-muted-foreground'
  }

  if (!message) return null

  return (
    <div
      data-testid={dataTestId}
      className={cn(
        'mt-2 text-sm font-medium flex justify-end items-baseline gap-2',
        colorClass,
      )}
    >
      <span>{message}</span>
    </div>
  )
}
