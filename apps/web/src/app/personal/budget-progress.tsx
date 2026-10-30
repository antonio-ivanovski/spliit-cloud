import { TrendingUp } from 'lucide-react'

import { useLocale } from '@/i18n/react'
import { getCurrency } from '@/lib/currency'
import { cn, formatCurrency } from '@/lib/utils'

import { usePersonalTranslation } from './personal-i18n'
import type { PersonalBudget, PersonalBudgetState } from './types'

const stateStyles: Record<PersonalBudgetState, { bar: string; text: string }> =
  {
    /*
     * `financial-positive`, not `primary`: "on track" is a money status, not
     * a brand accent. It stays the app's emerald even when a seasonal theme
     * repaints the primary, so it can never be confused with the amber
     * "trending" state next to it.
     */
    OK: { bar: 'bg-financial-positive', text: 'text-financial-positive' },
    TRENDING: {
      bar: 'bg-amber-500',
      text: 'text-amber-600 dark:text-amber-400',
    },
    OVER: { bar: 'bg-destructive', text: 'text-destructive' },
  }

type Props = {
  budget: PersonalBudget
  compact?: boolean
}

/**
 * Personal budget progress: spent/limit totals, a status-colored bar with a
 * projection marker, and remaining/over/projected captions. Status colors
 * mirror the group budget visuals (on-track green, trending amber, over red) —
 * the on-track green is the app's `financial-positive` token, so a seasonal
 * accent can never repaint it into the trending amber.
 */
export function PersonalBudgetProgress({ budget, compact = false }: Props) {
  const { t } = usePersonalTranslation()
  const locale = useLocale()
  const currency = getCurrency(budget.currencyCode)
  const visual = stateStyles[budget.state]
  const percentRaw =
    budget.amount > 0 ? (budget.spent / budget.amount) * 100 : 0
  const percent = Math.max(0, Math.min(100, percentRaw))
  const projectedRaw =
    budget.amount > 0 ? (budget.projected / budget.amount) * 100 : 0
  const projectedPercent = Math.max(0, Math.min(100, projectedRaw))
  const over = budget.remaining < 0

  const formatAmount = (amount: number) =>
    currency ? formatCurrency(currency, amount, locale) : String(amount)

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <p className="min-w-0 truncate text-sm font-semibold">{budget.name}</p>
        <p className="shrink-0 text-sm font-semibold tabular-nums">
          {formatAmount(budget.spent)}
          <span className="font-normal text-muted-foreground">
            {' / '}
            {formatAmount(budget.amount)}
          </span>
        </p>
      </div>
      <div className="relative">
        <div
          // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- custom fill + projection marker need divs for consistent rendering
          role="progressbar"
          aria-valuenow={Math.round(percent)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={t('budgets.progressLabel', { name: budget.name })}
          className="h-2 w-full overflow-hidden rounded-full bg-muted"
        >
          <div
            className={cn(
              'h-full rounded-full transition-[width] duration-500',
              visual.bar,
            )}
            style={{ width: `${percent}%` }}
          />
        </div>
        {projectedPercent > 0 && projectedPercent < 100 && (
          <div
            aria-hidden="true"
            data-testid="personal-budget-projection-tick"
            className="absolute top-1/2 h-3.5 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground ring-1 ring-background"
            style={{ left: `${projectedPercent}%` }}
          />
        )}
      </div>
      {!compact && (
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 text-xs tabular-nums">
          <span className={cn('font-medium', over && visual.text)}>
            {over
              ? t('budgets.overBy', {
                  amount: formatAmount(Math.abs(budget.remaining)),
                })
              : t('budgets.remaining', {
                  amount: formatAmount(budget.remaining),
                })}
          </span>
          <span className="inline-flex items-center gap-1 text-muted-foreground">
            {budget.state === 'TRENDING' && (
              <TrendingUp className="size-3.5" aria-hidden="true" />
            )}
            {t('budgets.projected', {
              amount: formatAmount(budget.projected),
            })}
          </span>
        </div>
      )}
    </div>
  )
}
