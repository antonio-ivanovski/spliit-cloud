import type { ComponentProps } from 'react'

import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import type { Currency } from '@spliit/domain'

export function AmountInput({
  currency,
  className,
  containerClassName,
  ...props
}: ComponentProps<typeof Input> & {
  currency?: Currency
  containerClassName?: string
}) {
  return (
    <div className={cn('relative w-fit', containerClassName)}>
      <Input
        {...props}
        className={cn(
          currency ? 'pe-10' : 'pe-3',
          'text-end tabular-nums',
          className,
        )}
      />
      {currency && (
        <span className="pointer-events-none absolute inset-y-0 end-2 flex items-center text-[11px] font-medium text-muted-foreground">
          {currency.symbol}
        </span>
      )}
    </div>
  )
}
