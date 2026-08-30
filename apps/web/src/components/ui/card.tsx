import * as React from 'react'

import { cn } from '@/lib/utils'

const Card = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      'motion-surface rounded-lg border bg-card text-card-foreground shadow-xs',
      className,
    )}
    {...props}
  />
))
Card.displayName = 'Card'

const CardHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn('flex flex-col space-y-1.5 p-4 sm:p-6', className)}
    {...props}
  />
))
CardHeader.displayName = 'CardHeader'

const CardTitle = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  // oxlint-disable-next-line jsx-a11y/heading-has-content -- CardTitle forwards children from consumers.
  <h3
    ref={ref}
    className={cn(
      'text-2xl font-semibold leading-none tracking-tight',
      className,
    )}
    {...props}
  />
))
CardTitle.displayName = 'CardTitle'

const CardDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p
    ref={ref}
    className={cn('text-sm text-muted-foreground', className)}
    {...props}
  />
))
CardDescription.displayName = 'CardDescription'

type CardContentProps = React.HTMLAttributes<HTMLDivElement> & {
  /** Use when the content is not preceded by a visible CardHeader. */
  spacing?: 'after-header' | 'standalone'
}

const CardContent = React.forwardRef<HTMLDivElement, CardContentProps>(
  ({ className, spacing = 'after-header', ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'px-4 pb-4 sm:px-6 sm:pb-6',
        spacing === 'standalone'
          ? 'pt-4 sm:pt-6'
          : 'pt-0 sm:pt-0',
        className,
      )}
      {...props}
    />
  ),
)
CardContent.displayName = 'CardContent'

const CardFooter = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      'flex items-center px-4 pb-4 sm:px-6 sm:pb-6',
      'pt-0 sm:pt-0',
      className,
    )}
    {...props}
  />
))
CardFooter.displayName = 'CardFooter'

export { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle }
