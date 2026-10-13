import { type ChartNoAxesCombined, LoaderCircle } from 'lucide-react'

import { Card, CardContent } from '@/components/ui/card'
import { useLocale } from '@/i18n/react'
import type { Currency } from '@/lib/currency'
import { formatCurrency } from '@/lib/utils'

export function StatsSummaryCard({
  title,
  amount,
  detail,
  currency,
  icon: Icon,
  isPending = false,
}: {
  title: string
  amount: number
  detail?: string
  currency: Currency
  icon: typeof ChartNoAxesCombined
  isPending?: boolean
}) {
  const locale = useLocale()
  return (
    <Card
      data-stats-surface="summary"
      className="relative overflow-hidden border-primary/10 bg-linear-to-br from-primary/7 via-card to-card shadow-none"
    >
      <CardContent spacing="standalone">
        <Icon
          className="absolute end-4 top-4 size-8 text-primary/15"
          aria-hidden
        />
        {isPending && (
          <LoaderCircle
            className="absolute end-4 bottom-4 size-4 animate-spin text-primary/60"
            aria-hidden
          />
        )}
        <p className="pe-8 text-sm text-muted-foreground">{title}</p>
        <p className="mt-2 text-2xl font-semibold tracking-tight tabular-nums">
          {formatCurrency(currency, amount, locale)}
        </p>
        {detail && (
          <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
        )}
      </CardContent>
    </Card>
  )
}
