import type { ComponentPropsWithoutRef } from 'react'

import { cn } from '@/lib/utils'

/**
 * A route-level surface for dense, chronological feeds.
 *
 * It escapes PageShell's 4px mobile card rail so rows and dividers can form one
 * continuous canvas. Desktop restores the same card treatment used by other
 * route-level sections.
 */
export function ScanSurface({
  className,
  ...props
}: ComponentPropsWithoutRef<'section'>) {
  return (
    <section
      data-scan-surface
      className={cn(
        'motion-surface -mx-1 min-w-0 text-foreground',
        'sm:mx-0 sm:rounded-lg sm:border sm:bg-card sm:text-card-foreground sm:shadow-xs',
        className,
      )}
      {...props}
    />
  )
}

/** Keeps date boundaries attached to the active mobile or desktop canvas. */
export function ScanStickyHeading({
  className,
  ...props
}: ComponentPropsWithoutRef<'div'>) {
  return (
    <div
      className={cn(
        'sticky top-(--app-header-height) bg-background px-4 py-1 text-xs font-semibold text-muted-foreground',
        'sm:bg-card sm:px-6',
        className,
      )}
      {...props}
    />
  )
}
