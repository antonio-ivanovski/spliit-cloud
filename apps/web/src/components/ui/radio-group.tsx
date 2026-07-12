

import * as RadioGroupPrimitive from '@radix-ui/react-radio-group'
import { Circle } from 'lucide-react'
import * as React from 'react'

import { cn } from '@/lib/utils'

const RadioGroup = React.forwardRef<
  React.ElementRef<typeof RadioGroupPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Root>
>(({ className, ...props }, ref) => {
  return (
    <RadioGroupPrimitive.Root
      className={cn('grid gap-2', className)}
      {...props}
      ref={ref}
    />
  )
})
RadioGroup.displayName = RadioGroupPrimitive.Root.displayName

type RadioGroupItemProps = Omit<
  React.ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Item>,
  'content'
> & {
  card?: boolean
  content?: React.ReactNode
}

const RadioGroupItem = React.forwardRef<
  React.ElementRef<typeof RadioGroupPrimitive.Item>,
  RadioGroupItemProps
>(({ className, card, content, children, disabled, ...props }, ref) => {
  if (card) {
    return (
      <div
        className={cn(
          'w-full rounded-lg border bg-card transition-colors',
          'has-data-[state=checked]:border-primary has-data-[state=checked]:bg-primary/4 has-data-[state=checked]:shadow-[inset_0_0_0_1px_var(--color-primary)]',
          'has-data-[state=unchecked]:border-border has-data-[state=unchecked]:hover:border-foreground/25 has-data-[state=unchecked]:hover:bg-muted/40',
          !disabled &&
            'has-data-[state=unchecked]:cursor-pointer has-data-[state=checked]:cursor-default',
          disabled && 'cursor-not-allowed opacity-50',
        )}
      >
        <RadioGroupPrimitive.Item
          ref={ref}
          disabled={disabled}
          className={cn(
            'group flex w-full items-start gap-3 p-3 text-left data-[state=unchecked]:cursor-pointer data-[state=checked]:cursor-default focus:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card disabled:cursor-not-allowed',
            className,
          )}
          {...props}
        >
          {children}
        </RadioGroupPrimitive.Item>
        {content && (
          <div className="w-full min-w-0 border-t px-6 pb-3 pt-3">{content}</div>
        )}
      </div>
    )
  }

  return (
    <RadioGroupPrimitive.Item
      ref={ref}
      disabled={disabled}
      className={cn(
        'aspect-square h-4 w-4 rounded-full border border-primary text-primary ring-offset-background focus:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      {children}
      {!children && (
        <RadioGroupPrimitive.Indicator className="flex items-center justify-center">
          <Circle className="h-2.5 w-2.5 fill-current text-current" />
        </RadioGroupPrimitive.Indicator>
      )}
    </RadioGroupPrimitive.Item>
  )
})
RadioGroupItem.displayName = RadioGroupPrimitive.Item.displayName

export { RadioGroup, RadioGroupItem }
