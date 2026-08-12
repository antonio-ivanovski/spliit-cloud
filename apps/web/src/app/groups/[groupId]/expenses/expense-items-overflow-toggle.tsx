import { ChevronDown, ChevronUp } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { cn } from '@/lib/utils'

export function ExpenseItemsOverflowToggle({
  expanded,
  remaining,
  onToggle,
  className,
}: {
  expanded: boolean
  remaining: number
  onToggle: () => void
  className?: string
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'ExpenseCard' })
  const Chevron = expanded ? ChevronUp : ChevronDown

  return (
    <button
      type="button"
      aria-expanded={expanded}
      data-testid="expense-items-overflow-toggle"
      className={cn(
        'inline-flex cursor-pointer items-center gap-0.5 text-xs text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden',
        className,
      )}
      onClick={(event) => {
        event.stopPropagation()
        onToggle()
      }}
      onKeyDown={(event) => {
        event.stopPropagation()
      }}
    >
      {expanded ? t('items.showLess') : t('items.more', { count: remaining })}
      <Chevron className="h-3 w-3" aria-hidden="true" />
    </button>
  )
}
