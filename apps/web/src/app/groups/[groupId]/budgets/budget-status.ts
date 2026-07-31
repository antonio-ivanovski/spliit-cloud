export type TrendStatus = 'ON_TRACK' | 'TRENDING_OVER' | 'OVER'
export type BudgetLifecycle = 'SCHEDULED' | 'ACTIVE' | 'COMPLETED' | 'ARCHIVED'

export type BudgetStatusVisual = {
  badgeVariant: 'destructive' | 'warning' | 'success' | 'secondary'
  barClass: string
  textClass: string
  dotClass: string
  iconClass: string
}

export type ResolvedBudgetStatus = {
  isOver: boolean
  isTrending: boolean
  isOnTrack: boolean
  isScheduled: boolean
  isCompleted: boolean
  isArchived: boolean
  visual: BudgetStatusVisual
}

export function resolveBudgetStatus(period: {
  trendStatus: TrendStatus
  remaining: number
  lifecycle?: BudgetLifecycle
}): ResolvedBudgetStatus {
  const lifecycle = period.lifecycle ?? 'ACTIVE'
  const isArchived = lifecycle === 'ARCHIVED'
  const isScheduled = lifecycle === 'SCHEDULED'
  const isCompleted = lifecycle === 'COMPLETED'
  const isOver = period.trendStatus === 'OVER' || period.remaining < 0
  const isTrending = period.trendStatus === 'TRENDING_OVER'
  const isOnTrack = !isOver && !isTrending && !isScheduled && !isCompleted
  return {
    isOver: isArchived || isScheduled || isCompleted ? false : isOver,
    isTrending: isArchived || isScheduled || isCompleted ? false : isTrending,
    isOnTrack,
    isScheduled,
    isCompleted,
    isArchived,
    visual:
      isArchived || isScheduled || isCompleted
        ? INACTIVE_VISUAL
        : isOver
          ? OVER_VISUAL
          : isTrending
            ? TRENDING_VISUAL
            : ON_TRACK_VISUAL,
  }
}

const INACTIVE_VISUAL: BudgetStatusVisual = {
  badgeVariant: 'secondary',
  barClass: 'bg-muted-foreground/50',
  textClass: 'text-muted-foreground',
  dotClass: 'bg-muted-foreground/50',
  iconClass: 'text-muted-foreground',
}

const OVER_VISUAL: BudgetStatusVisual = {
  badgeVariant: 'destructive',
  barClass: 'bg-destructive',
  textClass: 'text-destructive',
  dotClass: 'bg-destructive',
  iconClass: 'text-destructive',
}

const TRENDING_VISUAL: BudgetStatusVisual = {
  badgeVariant: 'warning',
  barClass: 'bg-amber-500',
  textClass: 'text-amber-600 dark:text-amber-400',
  dotClass: 'bg-amber-500',
  iconClass: 'text-amber-500',
}

const ON_TRACK_VISUAL: BudgetStatusVisual = {
  badgeVariant: 'success',
  barClass: 'bg-emerald-500',
  textClass: 'text-emerald-600 dark:text-emerald-400',
  dotClass: 'bg-emerald-500',
  iconClass: 'text-emerald-600 dark:text-emerald-400',
}
