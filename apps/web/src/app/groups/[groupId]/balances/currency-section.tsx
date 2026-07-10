import type { Currency } from '@/lib/currency'
import type { ReactNode } from 'react'

export function CurrencySection({
  currency,
  children,
}: {
  currency: Currency
  children: ReactNode
}) {
  return (
    <section className="py-6 first:pt-0 last:pb-0">
      <h3 className="mb-3 text-sm font-semibold text-muted-foreground">
        {currency.code || currency.symbol}
      </h3>
      {children}
    </section>
  )
}
