import type { TFunction } from 'i18next'
import { X, type LucideIcon } from 'lucide-react'
import type { ComponentProps, ReactNode } from 'react'

import { CategoryIcon } from '@/app/groups/[groupId]/expenses/category-icon'
import { categoryLabel } from '@/app/groups/[groupId]/stats/category-utils'
import { ParticipantAvatar } from '@/components/participant-avatar'
import { cn } from '@/lib/utils'
import { type Category, getCategoryById } from '@spliit/domain'

type ChipSize = 'md' | 'sm'

/**
 * Display label for a selected category (parent or child), with unknown-id
 * fallback.
 */
export function categoryScopeLabel(
  tCategories: TFunction,
  categoryId: string,
): string {
  const category = getCategoryById(categoryId)
  if (!category) return categoryId
  return categoryLabel(tCategories, category.id)
}

/** Ringed circular lead visual shared by category and "all" chips. */
function ChipCircle({
  children,
  size = 'md',
}: {
  children: ReactNode
  size?: ChipSize
}) {
  return (
    <span
      className={cn(
        'flex shrink-0 items-center justify-center rounded-full bg-background ring-1 ring-border/60',
        size === 'sm' ? 'size-5' : 'size-6',
      )}
    >
      {children}
    </span>
  )
}

export function CategoryChipVisual({
  category,
  size = 'md',
}: {
  category: Category
  size?: ChipSize
}) {
  return (
    <ChipCircle size={size}>
      <CategoryIcon
        category={category}
        className={cn(
          'text-muted-foreground',
          size === 'sm' ? 'size-3' : 'size-3.5',
        )}
      />
    </ChipCircle>
  )
}

export function IconChipVisual({
  icon: Icon,
  size = 'md',
}: {
  icon: LucideIcon
  size?: ChipSize
}) {
  return (
    <ChipCircle size={size}>
      <Icon
        className={cn(
          'text-muted-foreground',
          size === 'sm' ? 'size-3' : 'size-3.5',
        )}
        aria-hidden="true"
      />
    </ChipCircle>
  )
}

export function ParticipantChipVisual({
  participant,
  size = 'md',
}: {
  participant: ComponentProps<typeof ParticipantAvatar>['participant']
  size?: ChipSize
}) {
  return (
    <ParticipantAvatar
      participant={participant}
      size={size}
      className="shrink-0"
    />
  )
}

export type ScopeItem = {
  id: string
  label: string
  /** Leading visual: category icon, participant avatar, or an "all" icon. */
  leading?: ReactNode
}

type ScopeChipListProps = {
  items: ScopeItem[]
  /** When provided, each chip renders a remove (X) button calling this. */
  onRemove?: (id: string) => void
  /** Accessible label for the remove button. */
  removeLabel?: string
  /** Sizing variant: `sm` for compact surfaces (cards), default `md`. */
  size?: ChipSize
}

/** Pill chips with a leading avatar/icon, used for budget scope selections. */
export function ScopeChipList({
  items,
  onRemove,
  removeLabel,
  size = 'md',
}: ScopeChipListProps) {
  if (items.length === 0) return null
  const sm = size === 'sm'
  return (
    <div
      className={cn('flex flex-wrap items-center', sm ? 'gap-1' : 'gap-1.5')}
    >
      {items.map((item) => (
        <span
          key={item.id}
          className={cn(
            'inline-flex max-w-full items-center rounded-full border border-border/70 bg-muted/40 font-medium text-foreground',
            sm ? 'gap-1.5 py-0.5 pl-1 text-xs' : 'gap-2 py-1 pl-1.5 text-sm',
            onRemove ? (sm ? 'pr-1' : 'pr-1.5') : sm ? 'pr-2' : 'pr-3',
          )}
        >
          {item.leading}
          <span className="truncate">{item.label}</span>
          {onRemove && (
            <button
              type="button"
              onClick={() => onRemove(item.id)}
              aria-label={removeLabel}
              className={cn(
                'inline-flex shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground',
                sm ? 'size-3.5' : 'size-4',
              )}
            >
              <X
                className={cn(sm ? 'size-2.5' : 'size-3')}
                aria-hidden="true"
              />
            </button>
          )}
        </span>
      ))}
    </div>
  )
}
