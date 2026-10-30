import { Link } from '@tanstack/react-router'
import {
  ArrowDownRight,
  ArrowUpRight,
  CalendarClock,
  PiggyBank,
  Plus,
  ReceiptText,
  RefreshCw,
  Users,
  Wallet,
} from 'lucide-react'
import { useState } from 'react'

import { useDocumentTitle } from '@/components/document-title'
import { PageInset } from '@/components/layout/page-shell'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useLocale } from '@/i18n/react'
import { getCurrency } from '@/lib/currency'
import { cn, formatCurrency } from '@/lib/utils'

import { usePersonalOverview, usePersonalRecurringUpcoming } from './api'
import { PersonalBudgetProgress } from './budget-progress'
import { PersonalCategoryDonut } from './category-donut'
import { PersonalEntryRow } from './entry-row'
import { MonthSwitcher } from './month-switcher'
import { usePersonalTranslation } from './personal-i18n'
import { PersonalQuickAdd } from './quick-add'
import type { PersonalOverview } from './types'

type ViewProps = {
  overview: PersonalOverview | undefined
  month: string
  onMonthChange: (month: string) => void
}

function formatAmount(
  currencyCode: string,
  amount: number,
  locale: string,
): string {
  const currency = getCurrency(currencyCode)
  return currency ? formatCurrency(currency, amount, locale) : String(amount)
}

function HeroCard({ overview }: { overview: PersonalOverview }) {
  const { t } = usePersonalTranslation()
  const locale = useLocale()
  const { currencyCode, spent, income, net, delta } = overview
  const deltaUp = delta > 0

  return (
    <Card className="overflow-hidden border-primary/10 bg-linear-to-br from-primary/8 via-card to-card">
      <CardContent spacing="standalone" className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <p className="text-sm text-muted-foreground">
              {t('overview.spent')}
            </p>
            <p className="mt-1 text-3xl font-bold tracking-tight tabular-nums sm:text-4xl">
              {formatAmount(currencyCode, spent, locale)}
            </p>
            {delta !== 0 && (
              <p
                className={cn(
                  'mt-1 flex items-center gap-1 text-xs tabular-nums',
                  deltaUp
                    ? 'text-amber-600 dark:text-amber-400'
                    : 'text-green-600 dark:text-green-400',
                )}
              >
                {deltaUp ? (
                  <ArrowUpRight className="size-3.5" aria-hidden="true" />
                ) : (
                  <ArrowDownRight className="size-3.5" aria-hidden="true" />
                )}
                {t('overview.delta', {
                  amount: formatAmount(currencyCode, Math.abs(delta), locale),
                })}
              </p>
            )}
          </div>
          <div className="flex gap-6 sm:flex-col sm:justify-center sm:gap-2">
            <div>
              <p className="text-sm text-muted-foreground">
                {t('overview.income')}
              </p>
              <p className="mt-0.5 text-lg font-semibold text-green-600 tabular-nums dark:text-green-400">
                +{formatAmount(currencyCode, income, locale)}
              </p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">
                {t('overview.net')}
              </p>
              <p
                className={cn(
                  'mt-0.5 text-lg font-semibold tabular-nums',
                  net < 0 && 'text-destructive',
                )}
              >
                {net < 0 ? '−' : '+'}
                {formatAmount(currencyCode, Math.abs(net), locale)}
              </p>
            </div>
          </div>
          <div className="sm:border-s sm:ps-4">
            <p className="text-sm text-muted-foreground">
              {t('overview.overallBudget')}
            </p>
            <div className="mt-2">
              {overview.overallBudget ? (
                <PersonalBudgetProgress
                  budget={overview.overallBudget}
                  compact
                />
              ) : (
                <p className="text-xs text-muted-foreground">
                  {t('overview.noOverallBudget')}
                </p>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function SharedGroupsCard({ overview }: { overview: PersonalOverview }) {
  const { t } = usePersonalTranslation()
  const locale = useLocale()
  const { shared, currencyCode } = overview

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <Users className="size-4 text-muted-foreground" aria-hidden="true" />
          {t('overview.sharedTitle')}
        </CardTitle>
        <Link
          to="/personal/settings"
          className="shrink-0 text-xs font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          {t('overview.sharedManage')}
        </Link>
      </CardHeader>
      <CardContent className="space-y-3">
        {!shared.enabled ? (
          <p className="text-sm text-muted-foreground">
            {t('overview.sharedDisabled')}{' '}
            <Link
              to="/personal/settings"
              className="font-medium text-primary underline-offset-4 hover:underline"
            >
              {t('overview.sharedEnableCta')}
            </Link>
          </p>
        ) : shared.count === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t('overview.sharedEmpty')}
          </p>
        ) : (
          <>
            <p className="text-sm">
              <strong className="font-semibold tabular-nums">
                {t('overview.sharedSummary', { count: shared.count })}
              </strong>{' '}
              <span className="text-muted-foreground">
                {formatAmount(currencyCode, shared.amount, locale)}
              </span>
            </p>
            <ul className="divide-y divide-border/60">
              {shared.groups.map((group) => (
                <li
                  key={group.groupId}
                  className="flex items-center justify-between gap-3 py-2 text-sm"
                >
                  <span className="min-w-0 truncate">{group.name}</span>
                  <span className="shrink-0 text-muted-foreground tabular-nums">
                    {t('overview.sharedGroupCount', { count: group.count })}
                    {' · '}
                    {formatAmount(currencyCode, group.amount, locale)}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  )
}

/**
 * Compact upcoming-planned card (next 3 occurrences, overdue highlighted).
 * Hidden when there is nothing planned. Links to `/personal/recurring`.
 */
function UpcomingPlannedCard() {
  const { t } = usePersonalTranslation()
  const locale = useLocale()
  const upcomingQuery = usePersonalRecurringUpcoming(3)
  const items = upcomingQuery.data?.occurrences ?? []
  if (upcomingQuery.isPending || upcomingQuery.isError || items.length === 0) {
    return null
  }
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <CalendarClock
            className="size-4 text-muted-foreground"
            aria-hidden="true"
          />
          {t('overview.upcomingTitle')}
        </CardTitle>
        <Link
          to="/personal/recurring"
          className="shrink-0 text-xs font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          {t('overview.upcomingViewAll')}
        </Link>
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-border/60">
          {items.map((item) => (
            <li
              key={`${item.seriesId}:${item.sequence}`}
              className="flex items-center justify-between gap-3 py-2 text-sm"
            >
              <span className="min-w-0">
                <span className="block truncate font-medium">
                  {item.title ?? item.categoryId}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {item.date}
                  {item.overdue && (
                    <Badge variant="destructive" className="ms-1.5 text-[10px]">
                      {t('recurring.overdue')}
                    </Badge>
                  )}
                </span>
              </span>
              <span className="shrink-0 text-muted-foreground tabular-nums">
                {item.kind === 'INCOME' ? '+' : '−'}
                {(() => {
                  const currency = getCurrency(item.currencyCode)
                  return currency
                    ? formatCurrency(currency, item.amount, locale)
                    : String(item.amount)
                })()}
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}

/**
 * Presentational overview: hero totals, category donut, budgets, shared groups,
 * and recent entries. Data-agnostic so tests render fixtures directly; the page
 * component below wires queries and the quick-add dialog.
 */
export function PersonalOverviewView({
  overview,
  month,
  onMonthChange,
}: ViewProps) {
  const { t } = usePersonalTranslation()
  const [quickAddOpen, setQuickAddOpen] = useState(false)

  const isEmpty =
    overview != null &&
    overview.spent === 0 &&
    overview.income === 0 &&
    overview.categories.length === 0 &&
    overview.recent.length === 0 &&
    overview.budgets.length === 0

  return (
    <div className="flex flex-col gap-4 sm:gap-5">
      <PageInset>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <MonthSwitcher month={month} onChange={onMonthChange} />
          </div>
          <Button
            type="button"
            size="sm"
            className="shrink-0"
            onClick={() => setQuickAddOpen(true)}
          >
            <Plus className="me-1.5 size-4" aria-hidden="true" />
            {t('overview.addExpense')}
          </Button>
        </div>
      </PageInset>

      {overview == null || isEmpty ? (
        <PageInset>
          <Card className="border-dashed">
            <CardContent
              spacing="standalone"
              className="flex min-h-72 flex-col items-center justify-center gap-3 text-center"
            >
              {overview == null ? null : (
                <>
                  <span className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <Wallet className="size-6" aria-hidden="true" />
                  </span>
                  <h2 className="font-semibold">{t('overview.emptyTitle')}</h2>
                  <p className="max-w-sm text-sm text-muted-foreground">
                    {t('overview.emptyDescription')}
                  </p>
                  <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
                    <Button type="button" onClick={() => setQuickAddOpen(true)}>
                      <Plus className="me-1.5 size-4" aria-hidden="true" />
                      {t('overview.addExpense')}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      nativeButton={false}
                      render={<Link to="/personal/settings" />}
                    >
                      <Users className="me-1.5 size-4" aria-hidden="true" />
                      {t('overview.includeGroups')}
                    </Button>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </PageInset>
      ) : (
        <>
          <HeroCard overview={overview} />
          <div className="grid gap-4 sm:gap-5 lg:grid-cols-2">
            <Card>
              <CardHeader className="space-y-0 pb-2">
                <CardTitle className="text-base">
                  {t('overview.categoriesTitle')}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {overview.categories.length > 0 ? (
                  <PersonalCategoryDonut
                    slices={overview.categories}
                    currencyCode={overview.currencyCode}
                  />
                ) : (
                  <p className="py-4 text-center text-sm text-muted-foreground">
                    {t('overview.categoriesEmpty')}
                  </p>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <PiggyBank
                    className="size-4 text-muted-foreground"
                    aria-hidden="true"
                  />
                  {t('overview.budgetsTitle')}
                </CardTitle>
                <Link
                  to="/personal/budgets"
                  className="shrink-0 text-xs font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                >
                  {t('overview.viewAll')}
                </Link>
              </CardHeader>
              <CardContent>
                {overview.budgets.length > 0 ? (
                  <ul className="space-y-4">
                    {overview.budgets.slice(0, 3).map((budget) => (
                      <li key={budget.id}>
                        <PersonalBudgetProgress budget={budget} />
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="py-4 text-center text-sm text-muted-foreground">
                    {t('overview.budgetsEmpty')}{' '}
                    <Link
                      to="/personal/budgets"
                      className="font-medium text-primary underline-offset-4 hover:underline"
                    >
                      {t('overview.budgetsCreateCta')}
                    </Link>
                  </p>
                )}
              </CardContent>
            </Card>
          </div>
          <SharedGroupsCard overview={overview} />
          <UpcomingPlannedCard />
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <ReceiptText
                  className="size-4 text-muted-foreground"
                  aria-hidden="true"
                />
                {t('overview.recentTitle')}
              </CardTitle>
              {overview.recent.length > 0 && (
                <Link
                  to="/personal/transactions"
                  className="shrink-0 text-xs font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                >
                  {t('overview.viewAll')}
                </Link>
              )}
            </CardHeader>
            <CardContent>
              {overview.recent.length > 0 ? (
                <ul className="divide-y divide-border/60">
                  {overview.recent.map((entry) => (
                    <PersonalEntryRow
                      key={entry.id}
                      entry={entry}
                      currencyCode={overview.currencyCode}
                    />
                  ))}
                </ul>
              ) : (
                <p className="py-4 text-center text-sm text-muted-foreground">
                  {t('overview.recentEmpty')}
                </p>
              )}
            </CardContent>
          </Card>
        </>
      )}

      <PersonalQuickAdd
        open={quickAddOpen}
        onOpenChange={setQuickAddOpen}
        defaultKind="EXPENSE"
      />
    </div>
  )
}

export type PersonalOverviewPageProps = {
  month: string
  onMonthChange: (month: string) => void
}

export function PersonalOverviewPage({
  month,
  onMonthChange,
}: PersonalOverviewPageProps) {
  const { t } = usePersonalTranslation()
  useDocumentTitle(t('overview.documentTitle'))
  const overviewQuery = usePersonalOverview(month)

  if (overviewQuery.isPending) {
    return (
      <div
        className="flex flex-col gap-4 sm:gap-5"
        aria-busy="true"
        aria-label={t('loading')}
      >
        <div className="h-44 animate-pulse rounded-xl bg-muted" />
        <div className="grid gap-4 sm:gap-5 lg:grid-cols-2">
          <div className="h-64 animate-pulse rounded-xl bg-muted" />
          <div className="h-64 animate-pulse rounded-xl bg-muted" />
        </div>
      </div>
    )
  }

  if (overviewQuery.isError || !overviewQuery.data) {
    return (
      <div className="flex flex-col gap-4">
        <PageInset>
          <MonthSwitcher month={month} onChange={onMonthChange} />
        </PageInset>
        <Card className="border-destructive/30">
          <CardContent
            spacing="standalone"
            className="flex min-h-56 flex-col items-center justify-center gap-3 text-center"
          >
            <p role="alert" className="text-sm text-muted-foreground">
              {overviewQuery.error instanceof Error
                ? overviewQuery.error.message
                : t('overview.error')}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void overviewQuery.refetch()}
            >
              <RefreshCw className="me-2 size-4" aria-hidden="true" />
              {t('retry')}
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <PersonalOverviewView
      overview={overviewQuery.data}
      month={month}
      onMonthChange={onMonthChange}
    />
  )
}
