import type { ReactNode } from 'react'

import { getCurrency, type Currency } from '@/lib/currency'

export function CurrencySection({
  currency,
  children,
}: {
  currency: Currency
  children: ReactNode
}) {
  const hasFlag = Boolean(currency.code && getCurrency(currency.code))
  const flagUrl = hasFlag
    ? `https://flagcdn.com/h24/${currency.code.slice(0, 2).toLowerCase()}.png`
    : undefined

  return (
    <section className="py-6 first:pt-0 last:pb-0">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-muted-foreground">
        {flagUrl ? (
          <img
            src={flagUrl}
            className="h-4 w-6 rounded-sm object-cover"
            alt=""
            aria-hidden="true"
          />
        ) : (
          <span
            aria-hidden="true"
            className="inline-flex h-4 w-6 items-center justify-center rounded-sm bg-muted text-[10px] font-medium"
          >
            {currency.symbol || '?'}
          </span>
        )}
        <span>{currency.code || currency.symbol}</span>
        {currency.code && currency.symbol && (
          <span className="font-normal text-muted-foreground/70">
            {currency.symbol}
          </span>
        )}
      </h3>
      {children}
    </section>
  )
}
