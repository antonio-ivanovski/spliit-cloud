import type { ComponentPropsWithoutRef } from 'react'

import { cn } from '@/lib/utils'

type PageShellProps = ComponentPropsWithoutRef<'main'> & {
  width?: 'md' | 'lg' | 'full'
}

const widthClasses = {
  md: 'max-w-(--breakpoint-md)',
  lg: 'max-w-(--breakpoint-lg)',
  full: 'max-w-none',
} as const

/** Shared top-level page width and mobile gutter owner. */
export function PageShell({
  width = 'md',
  className,
  ...props
}: PageShellProps) {
  return (
    <main
      className={cn(
        'mx-auto flex w-full min-w-0 flex-1',
        widthClasses[width],
        'px-1 [--page-inset:0.75rem] sm:px-4 sm:[--page-inset:0rem]',
        className,
      )}
      {...props}
    />
  )
}

/** Owns the one mobile gutter for content that is not itself a Card. */
export function PageInset({
  className,
  ...props
}: ComponentPropsWithoutRef<'div'>) {
  return (
    <div
      className={cn('px-[var(--page-inset,1rem)] sm:px-0', className)}
      {...props}
    />
  )
}
