import type { ReactNode } from 'react'

/** Shared presentation; preset loading and mutations remain with the caller. */
export function SplitPresetPanel({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <fieldset
      aria-label={label}
      className="mt-2 w-full min-w-0 rounded-lg border border-border/70 bg-muted/25 p-3 text-xs shadow-xs"
    >
      {children}
    </fieldset>
  )
}
