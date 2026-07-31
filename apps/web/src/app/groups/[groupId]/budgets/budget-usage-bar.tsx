import type { BudgetStatusVisual } from '@/app/groups/[groupId]/budgets/budget-status'
import { cn } from '@/lib/utils'

import { useBudgetTranslation } from './budget-i18n'

type Props = {
  used: number
  limit: number
  daysElapsed: number
  daysTotal: number
  /** Bar styling derived from the resolved status. */
  visual: BudgetStatusVisual
  /** Optional override label for screen readers. */
  ariaLabel?: string
  /**
   * Lower bound for expected progress to display the pace marker. The pace tick
   * is hidden when the period is at its very start (0/0) — nothing to anchor.
   */
  showPace?: boolean
  className?: string
}

/**
 * Budget consumption bar: the fill shows how much of the budget is used, and
 * the marker shows the expected pace (where spending should be by now). Both
 * are labeled with an always-visible caption underneath.
 */
export function BudgetUsageBar({
  used,
  limit,
  daysElapsed,
  daysTotal,
  visual,
  ariaLabel,
  showPace = true,
  className,
}: Props) {
  const t = useBudgetTranslation()
  const percentRaw = limit > 0 ? (used / limit) * 100 : 0
  const percent = Math.max(0, Math.min(100, percentRaw))
  const pacePercent =
    daysTotal > 0
      ? Math.max(0, Math.min(100, (daysElapsed / daysTotal) * 100))
      : 0
  const showTick = showPace && pacePercent > 0 && pacePercent < 100

  return (
    <div className={cn('space-y-1.5', className)}>
      <div className="relative">
        <div
          // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- custom-styled bar needs divs for consistent cross-browser fill and pace-marker rendering.
          role="progressbar"
          aria-valuenow={Math.round(percent)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={ariaLabel}
          data-testid="budget-usage-track"
          className="h-2 w-full overflow-hidden rounded-full bg-muted"
        >
          <div
            data-testid="budget-usage-fill"
            className={cn(
              'h-full rounded-full transition-[width] duration-500',
              visual.barClass,
            )}
            style={{ width: `${percent}%` }}
          />
        </div>
        {showTick && (
          <div
            aria-hidden="true"
            data-testid="budget-usage-pace-tick"
            className="absolute top-1/2 h-3.5 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground ring-1 ring-background"
            style={{ left: `${pacePercent}%` }}
          />
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 text-xs text-muted-foreground tabular-nums">
        <span>{t('progressLabel', { percentage: Math.round(percent) })}</span>
        {showTick && (
          <span>
            {t('paceTooltip', { elapsed: daysElapsed, total: daysTotal })}
          </span>
        )}
      </div>
    </div>
  )
}
