/* oxlint-disable jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events -- wrapper stops propagation for the optional action inside a trigger. */
import { ChevronDown } from 'lucide-react'
import type { ReactNode } from 'react'

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'

/**
 * Read a stored section-open preference from `localStorage` and fall back to
 * `defaultOpen`. Silently returns the default when `localStorage` is not
 * available (SSR, sandboxed environments) or the stored value is not a
 * boolean-shaped string.
 */
function readStoredOpen(storageKey: string, defaultOpen: boolean): boolean {
  if (typeof window === 'undefined') return defaultOpen
  try {
    const raw = window.localStorage.getItem(storageKey)
    if (raw === null) return defaultOpen
    if (raw === 'true') return true
    if (raw === 'false') return false
  } catch {
    // localStorage can throw (privacy mode, disabled cookies, etc.)
  }
  return defaultOpen
}

function writeStoredOpen(storageKey: string, open: boolean) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(storageKey, open ? 'true' : 'false')
  } catch {
    // ignore
  }
}

type Props = {
  /** Title rendered inside the trigger button. */
  title: ReactNode
  /** Whether the section is open by default. */
  defaultOpen: boolean
  /**
   * Storage key used to remember the user's open/closed choice. The same key
   * must be reused across renders for the same logical section so the
   * preference persists across reloads.
   */
  storageKey: string
  /**
   * Optional content rendered to the right of the title in the trigger header
   * (e.g., a small action button). It stays clickable and is not affected by
   * the collapse/expand toggle.
   */
  headerAction?: ReactNode
  /** The section content that gets collapsed. */
  children: ReactNode
  /** Class names for the trigger header (margins, etc.). */
  triggerClassName?: string
  /** Class names for the collapsible content wrapper. */
  contentClassName?: string
}

/**
 * A small collapsible section with a chevron-driven header. Used on the
 * homepage to group starred/groups/friends (default open) and archived/hidden
 * (default closed) buckets. Open/closed state is persisted per `storageKey` in
 * `localStorage` when available.
 *
 * Uses a light divider between sections so the homepage list stays structured
 * without competing with the cards themselves.
 */
export function CollapsibleSection({
  title,
  defaultOpen,
  storageKey,
  headerAction,
  children,
  triggerClassName,
  contentClassName,
}: Props) {
  return (
    <Collapsible
      defaultOpen={readStoredOpen(storageKey, defaultOpen)}
      onOpenChange={(open) => writeStoredOpen(storageKey, open)}
      className="border-t border-border/70 pt-5 first:border-t-0 first:pt-0"
    >
      <CollapsibleTrigger
        className={cn(
          'group -mx-2 flex w-full cursor-pointer items-center justify-between gap-2 rounded-md px-2 py-1 text-left transition-colors hover:bg-muted/40 hover:text-foreground/80',
          triggerClassName,
        )}
      >
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <ChevronDown
            aria-hidden
            className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 group-data-[state=closed]:-rotate-90 group-data-[state=open]:rotate-0"
          />
          <span className="truncate font-semibold">{title}</span>
        </span>
        {headerAction ? (
          <span
            // Stop propagation so clicking the action doesn't toggle the
            // collapsible. The action's own click handler still runs.
            onClick={(event) => event.stopPropagation()}
            className="relative z-10 shrink-0"
          >
            {headerAction}
          </span>
        ) : null}
      </CollapsibleTrigger>
      <CollapsibleContent className={cn('pt-3', contentClassName)}>
        {children}
      </CollapsibleContent>
    </Collapsible>
  )
}
