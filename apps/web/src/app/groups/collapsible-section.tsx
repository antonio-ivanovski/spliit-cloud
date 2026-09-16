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
   * Optional content rendered to the right of the title in the section header
   * (e.g., a small action button). It sits beside the collapse toggle — not
   * inside it — so it stays clickable without toggling and never pollutes the
   * toggle's accessible name.
   */
  headerAction?: ReactNode
  /** The section content that gets collapsed. */
  children: ReactNode
  /** Class names for the trigger header (margins, etc.). */
  triggerClassName?: string
  /** Class names for spacing the entire collapsible section. */
  rootClassName?: string
  /** Class names for the collapsible content wrapper. */
  contentClassName?: string
  /** Align the trigger with the route's non-card mobile content column. */
  insetHeader?: boolean
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
  rootClassName,
  contentClassName,
  insetHeader = false,
}: Props) {
  return (
    <Collapsible
      defaultOpen={readStoredOpen(storageKey, defaultOpen)}
      onOpenChange={(open) => writeStoredOpen(storageKey, open)}
      className={cn(
        'border-t border-border/70 pt-5 first:border-t-0 first:pt-0',
        rootClassName,
      )}
    >
      <div
        className={cn(
          'flex items-center justify-between gap-2 rounded-md py-1',
          insetHeader
            ? 'mx-3 w-[calc(100%-1.5rem)] sm:-mx-2 sm:w-full'
            : '-mx-2 w-full',
          triggerClassName,
        )}
      >
        <CollapsibleTrigger className="group flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md px-1 py-1 text-start transition-colors hover:bg-muted/40 hover:text-foreground/80">
          <ChevronDown
            aria-hidden
            className="h-4 w-4 shrink-0 -rotate-90 text-muted-foreground transition-transform duration-200 group-data-[panel-open]:rotate-0"
          />
          <span className="truncate font-semibold">{title}</span>
        </CollapsibleTrigger>
        {headerAction ? <span className="shrink-0">{headerAction}</span> : null}
      </div>
      <CollapsibleContent className={cn('pt-3', contentClassName)}>
        {children}
      </CollapsibleContent>
    </Collapsible>
  )
}
