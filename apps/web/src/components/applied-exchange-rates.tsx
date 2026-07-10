import { Card, CardContent } from '@/components/ui/card'
import { Calendar, Globe } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export type AppliedExchangeRateMode = 'perDate' | 'fixed'

type Props = {
  modes: Record<string, AppliedExchangeRateMode>
  rates: Record<string, number> | null | undefined
  embedded?: boolean
}

function formatRate(rate: number): string {
  return rate.toFixed(4)
}

export function AppliedExchangeRates({
  modes,
  rates,
  embedded = false,
}: Props) {
  const { t } = useTranslation()
  if (Object.keys(modes).length === 0) return null

  type RateRow = { date: string; rate: number }
  const ratesByPair: Record<string, RateRow[]> = {}

  if (rates) {
    for (const key of Object.keys(rates)) {
      const [date, base, target] = key.split('|')
      const pairKey = `${base}|${target}`
      const list = ratesByPair[pairKey] ?? (ratesByPair[pairKey] = [])
      list.push({ date, rate: rates[key] })
    }
  }

  for (const rows of Object.values(ratesByPair)) {
    rows.sort((a, b) => a.date.localeCompare(b.date))
  }

  const content = (
    <div className="flex flex-col gap-3">
      <p className="text-sm font-medium">
        {t('Groups.Import.Confirm.appliedExchangeRatesLabel')}
      </p>
      <ul className="flex flex-col gap-3 text-sm">
        {Object.keys(modes).map((pairKey) => {
          const [base, target] = pairKey.split('|')
          const mode = modes[pairKey]
          const rows = ratesByPair[pairKey] ?? []
          const isPerDate = mode === 'perDate'

          return (
            <li key={pairKey} className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2 text-foreground">
                {isPerDate ? (
                  <Calendar className="h-4 w-4 shrink-0 text-muted-foreground" />
                ) : (
                  <Globe className="h-4 w-4 shrink-0 text-muted-foreground" />
                )}
                <span className="font-medium tracking-tight">
                  {t('Groups.Import.CurrencyConversion.pairSection', {
                    source: base,
                    target,
                  })}
                </span>
                <span className="ml-auto rounded-full bg-muted px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  {isPerDate
                    ? t('Groups.Import.Confirm.conversionPerDate')
                    : t('Groups.Import.Confirm.conversionFixed')}
                </span>
              </div>
              {isPerDate ? (
                rows.length > 0 ? (
                  <ul className="ml-6 flex flex-col gap-1 text-xs">
                    {rows.map((row) => (
                      <li
                        key={row.date}
                        className="flex items-baseline gap-3 text-muted-foreground"
                      >
                        <span className="font-mono tabular-nums">
                          {row.date}
                        </span>
                        <span className="font-mono tabular-nums text-foreground">
                          {t('Groups.Import.CurrencyConversion.fixedRateRow', {
                            source: base,
                            rate: formatRate(row.rate),
                            target,
                          })}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="ml-6 text-xs text-muted-foreground">—</p>
                )
              ) : rows.length > 0 ? (
                <p className="ml-6 font-mono text-xs tabular-nums text-foreground">
                  {t('Groups.Import.CurrencyConversion.fixedRateRow', {
                    source: base,
                    rate: formatRate(rows[0].rate),
                    target,
                  })}
                </p>
              ) : (
                <p className="ml-6 text-xs text-muted-foreground">—</p>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )

  if (embedded) return content

  return (
    <Card>
      <CardContent className="p-4">{content}</CardContent>
    </Card>
  )
}
