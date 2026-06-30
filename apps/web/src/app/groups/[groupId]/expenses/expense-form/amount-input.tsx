import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import type { Currency } from '@spliit/domain'
import type { ComponentProps } from 'react'

export function AmountInput({
  currency,
  className,
  ...props
}: ComponentProps<typeof Input> & {
  currency: Currency
}) {
  return (
    <div className="relative w-fit">
      <Input
        {...props}
        className={cn('pr-10 text-right tabular-nums', className)}
      />
      <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-[11px] font-medium text-muted-foreground">
        {currency.symbol}
      </span>
    </div>
  )
}
