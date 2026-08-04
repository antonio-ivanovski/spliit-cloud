import * as React from 'react'

import { cn } from '@/lib/utils'

/**
 * Shared chrome for row-level action clusters: an inline segmented group with
 * internal dividers. Children should be ghost buttons (`rounded-none`);
 * destructive actions can carry the destructive text color classes.
 */
export function SegmentedActions({
  className,
  children,
}: {
  className?: string
  children: React.ReactNode
}) {
  return (
    <div
      className={cn(
        'inline-flex items-center divide-x divide-input overflow-hidden rounded-md border border-input bg-background shadow-xs',
        className,
      )}
    >
      {children}
    </div>
  )
}
