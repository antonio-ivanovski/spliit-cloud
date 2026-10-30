import { Link } from '@tanstack/react-router'
import { ArrowRight, Plus, Wallet } from 'lucide-react'
import { useState } from 'react'

import { usePersonalFeature, usePersonalOverview } from '@/app/personal/api'
import { currentPersonalMonth } from '@/app/personal/month'
import { usePersonalTranslation } from '@/app/personal/personal-i18n'
import { PersonalQuickAdd } from '@/app/personal/quick-add'
import { Button } from '@/components/ui/button'
import { useLocale } from '@/i18n/react'
import { getCurrency } from '@/lib/currency'
import { formatCurrency } from '@/lib/utils'

/**
 * Compact Personal card on the home dashboard: this month's spend plus budget
 * room, with add/open actions. Hidden when the feature flag is off; hidden (not
 * erroring) while the API is still landing.
 */
export function PersonalHomeCard() {
  const { t } = usePersonalTranslation()
  const locale = useLocale()
  const { enabled, isLoading: flagLoading } = usePersonalFeature()
  const [quickAddOpen, setQuickAddOpen] = useState(false)
  const month = currentPersonalMonth()
  const overviewQuery = usePersonalOverview(month, {
    enabled: enabled && !flagLoading,
  })

  if (flagLoading || !enabled) return null
  if (overviewQuery.isPending) {
    return (
      <div
        className="rounded-lg border bg-card px-4 py-3"
        aria-busy="true"
        aria-label={t('loading')}
      >
        <div className="h-5 w-2/3 animate-pulse rounded bg-muted" />
        <div className="mt-2 h-8 w-1/3 animate-pulse rounded bg-muted" />
      </div>
    )
  }
  if (overviewQuery.isError || !overviewQuery.data) return null

  const overview = overviewQuery.data
  const currency = getCurrency(overview.currencyCode)
  const formatMinor = (amount: number) =>
    currency ? formatCurrency(currency, amount, locale) : String(amount)
  const left = overview.overallBudget ? overview.overallBudget.remaining : null

  return (
    <>
      <section
        aria-label={t('homeCard.title')}
        className="rounded-lg border bg-card px-4 py-3 shadow-xs"
      >
        <div className="flex items-center justify-between gap-3">
          <p className="flex min-w-0 items-center gap-2 text-sm font-medium">
            <span
              aria-hidden="true"
              className="grid size-8 shrink-0 place-items-center rounded-full bg-primary/10 text-primary"
            >
              <Wallet className="size-4" />
            </span>
            <span className="truncate">{t('homeCard.title')}</span>
          </p>
          <div className="flex shrink-0 items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 px-2 text-xs"
              onClick={() => setQuickAddOpen(true)}
            >
              <Plus className="me-1 size-3.5" aria-hidden="true" />
              {t('overview.addExpense')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 px-2 text-xs"
              nativeButton={false}
              render={<Link to="/personal" />}
            >
              {t('homeCard.open')}
              <ArrowRight
                className="ms-1 size-3.5 rtl:rotate-180"
                aria-hidden="true"
              />
            </Button>
          </div>
        </div>
        <div className="mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <p className="text-2xl font-semibold tracking-tight tabular-nums">
            {formatMinor(overview.spent)}
          </p>
          <p className="text-xs text-muted-foreground tabular-nums">
            {left != null && left >= 0
              ? t('homeCard.left', { amount: formatMinor(left) })
              : t('homeCard.spentMonth')}
          </p>
        </div>
      </section>
      <PersonalQuickAdd
        open={quickAddOpen}
        onOpenChange={setQuickAddOpen}
        defaultKind="EXPENSE"
      />
    </>
  )
}
