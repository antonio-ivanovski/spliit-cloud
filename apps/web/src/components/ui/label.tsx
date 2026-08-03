import { cva, type VariantProps } from 'class-variance-authority'
import * as React from 'react'

import { cn } from '@/lib/utils'

const labelVariants = cva(
  'text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70',
)

const Label = React.forwardRef<
  HTMLLabelElement,
  React.ComponentPropsWithoutRef<'label'> & VariantProps<typeof labelVariants>
>(({ className, ...props }, ref) => (
  // oxlint-disable-next-line jsx-a11y/label-has-associated-control -- Label forwards htmlFor/children from consumers.
  <label ref={ref} className={cn(labelVariants(), className)} {...props} />
))
Label.displayName = 'Label'

export { Label }
