import { ChevronRight, Coins, Hash, Percent, Users } from 'lucide-react'
import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'
import type { ExpenseFormItemValues } from '@spliit/domain'
type ItemSplitMode = ExpenseFormItemValues['splitMode']

const defaultSplitIcons = {
  EVENLY: Users,
  BY_SHARES: Hash,
  BY_PERCENTAGE: Percent,
  BY_AMOUNT: Coins,
} as const

export function DefaultSplitAction({
  splitMode,
  label,
  summary,
  editLabel,
  readOnly,
  onClick,
}: {
  splitMode: ItemSplitMode
  label: string
  summary: ReactNode
  editLabel: string
  readOnly?: boolean
  onClick: () => void
}) {
  const Icon = defaultSplitIcons[splitMode]
  const content = (
    <>
      <span
        aria-hidden="true"
        className={cn(
          'inline-flex size-9 shrink-0 items-center justify-center rounded-md transition-colors',
          readOnly
            ? 'bg-muted text-muted-foreground'
            : 'bg-primary/10 text-primary group-hover:bg-primary/15',
        )}
      >
        <Icon className="size-4" strokeWidth={2} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm leading-tight font-medium">{label}</span>
        <span className="mt-1 block text-xs leading-snug text-muted-foreground sm:text-sm">
          {summary}
        </span>
      </span>
      {!readOnly && (
        <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-muted-foreground transition-colors group-hover:text-foreground sm:text-sm">
          <span className="hidden sm:inline">{editLabel}</span>
          <ChevronRight className="size-4 rtl:rotate-180" aria-hidden="true" />
        </span>
      )}
    </>
  )

  if (readOnly) {
    return (
      <div className="flex items-center gap-3 border-y py-3">{content}</div>
    )
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={editLabel}
      className="group flex w-full items-center gap-3 border-y py-3 text-start transition-colors hover:bg-muted/30 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-hidden"
    >
      {content}
    </button>
  )
}
