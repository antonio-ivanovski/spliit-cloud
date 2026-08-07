import { Radio as RadioPrimitive } from '@base-ui/react/radio'
import { RadioGroup as RadioGroupPrimitive } from '@base-ui/react/radio-group'
import { Circle } from 'lucide-react'
import * as React from 'react'

import { cn } from '@/lib/utils'

const RadioGroup = React.forwardRef<
  HTMLDivElement,
  RadioGroupPrimitive.Props
>(({ className, ...props }, ref) => {
  return (
    <RadioGroupPrimitive
      className={cn('grid gap-2', className)}
      {...props}
      ref={ref}
    />
  )
})
RadioGroup.displayName = 'RadioGroup'

type RadioGroupItemProps = Omit<RadioPrimitive.Root.Props, 'content'> & {
  card?: boolean
  content?: React.ReactNode
}

const RadioGroupItem = React.forwardRef<HTMLSpanElement, RadioGroupItemProps>(
  ({ className, card, content, children, disabled, ...props }, ref) => {
    if (card) {
      return (
        <div
          className={cn(
            'w-full rounded-lg border bg-card transition-colors',
            'has-data-[checked]:border-primary has-data-[checked]:bg-primary/4 has-data-[checked]:shadow-[inset_0_0_0_1px_var(--color-primary)]',
            'has-data-[unchecked]:border-border has-data-[unchecked]:hover:border-foreground/25 has-data-[unchecked]:hover:bg-muted/40',
            !disabled &&
              'has-data-[unchecked]:cursor-pointer has-data-[checked]:cursor-default',
            disabled && 'cursor-not-allowed opacity-50',
          )}
        >
          <RadioPrimitive.Root
            ref={ref}
            disabled={disabled}
            className={cn(
              'group flex w-full items-start gap-3 p-3 text-start data-[unchecked]:cursor-pointer data-[checked]:cursor-default focus:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card disabled:cursor-not-allowed',
              className,
            )}
            {...props}
          >
            {children}
          </RadioPrimitive.Root>
          {content && (
            <div className="w-full min-w-0 border-t px-6 pb-3 pt-3">
              {content}
            </div>
          )}
        </div>
      )
    }

    return (
      <RadioPrimitive.Root
        ref={ref}
        disabled={disabled}
        className={cn(
          'flex aspect-square h-4 w-4 items-center justify-center rounded-full border border-primary p-0 text-primary ring-offset-background focus:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        {...props}
      >
        {children}
        {!children && (
          <RadioPrimitive.Indicator className="flex items-center justify-center data-unchecked:hidden">
            <Circle className="h-2.5 w-2.5 fill-current text-current" />
          </RadioPrimitive.Indicator>
        )}
      </RadioPrimitive.Root>
    )
  },
)
RadioGroupItem.displayName = 'RadioGroupItem'

export { RadioGroup, RadioGroupItem }
