import { Link } from '@tanstack/react-router'
import {
  Archive,
  ArchiveRestore,
  Layers,
  RefreshCw,
  TrendingUp,
  Users,
} from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { BudgetChart } from '@/app/groups/[groupId]/budgets/budget-chart'
import {
  CategoryChipVisual,
  IconChipVisual,
  ParticipantChipVisual,
  ScopeChipList,
  categoryScopeLabel,
} from '@/app/groups/[groupId]/budgets/budget-scope'
import { resolveBudgetStatus } from '@/app/groups/[groupId]/budgets/budget-status'
import { normalizeBudgetDetail } from '@/app/groups/[groupId]/budgets/budget-types'
import { useCurrentGroup } from '@/app/groups/[groupId]/current-group-context'
import { ExpenseCard } from '@/app/groups/[groupId]/expenses/expense-card'
import { useGroupAccessSearch } from '@/app/groups/[groupId]/use-group-access-search'
import { DeletePopup } from '@/components/delete-popup'
import { EditButton } from '@/components/edit-button'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/ui/responsive-dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/components/ui/use-toast'
import { useLocale } from '@/i18n/react'
import {
  cn,
  formatCurrency,
  formatDateOnly,
  getCurrencyFromGroup,
} from '@/lib/utils'
import { trpc } from '@/trpc/client'
import { formatBudgetPeriodRange, getCategoryById } from '@spliit/domain'

import { useBudgetTranslation } from './budget-i18n'

function dateValue(value: Date | string) {
  return value instanceof Date ? value : new Date(value)
}

export function BudgetDetailModal({
  budgetId,
  onClose,
}: {
  budgetId: string
  onClose: () => void
}) {
  const t = useBudgetTranslation()
  const { t: tCommon } = useTranslation()
  const { t: tCategories } = useTranslation(undefined, {
    keyPrefix: 'Categories',
  })
  const locale = useLocale()
  const { groupId, group } = useCurrentGroup()
  const { linkInviteToken, viewKey } = useGroupAccessSearch()
  const [detailOpen, setDetailOpen] = useState(true)
  const { toast } = useToast()
  const utils = trpc.useUtils()
  const budgetQuery = trpc.groups.budgets.get.useQuery({
    groupId,
    budgetId,
    linkInviteToken,
    viewKey,
  })
  const archiveMutation = trpc.groups.budgets.archive.useMutation({
    onSuccess: async (_data, variables) => {
      await utils.groups.budgets.get.invalidate({ groupId, budgetId })
      await utils.groups.budgets.list.invalidate({ groupId })
      toast({
        description: variables.archived
          ? t('archivedSuccess')
          : t('unarchivedSuccess'),
        variant: 'success',
      })
    },
    onError: (error) =>
      toast({ description: error.message, variant: 'destructive' }),
  })
  const deleteMutation = trpc.groups.budgets.delete.useMutation({
    onSuccess: async () => {
      await utils.groups.budgets.list.invalidate({ groupId })
      onClose()
    },
    onError: (error) =>
      toast({ description: error.message, variant: 'destructive' }),
  })

  const rawBudget = budgetQuery.data?.budget
  const budget = rawBudget
    ? normalizeBudgetDetail(rawBudget as unknown as Record<string, unknown>)
    : null
  const canEdit = Boolean(budget?.permissions.canEdit)
  const canArchive = Boolean(budget?.permissions.canArchive)
  const canDelete = Boolean(budget?.permissions.canDelete)
  const currency = group ? getCurrencyFromGroup(group) : null
  const period = budget?.period
  const lifecycle = budget?.archived ? 'ARCHIVED' : period?.lifecycle
  const { isOver, isTrending, visual, isScheduled, isCompleted, isArchived } =
    period
      ? resolveBudgetStatus({ ...period, lifecycle })
      : {
          isOver: false,
          isTrending: false,
          isScheduled: false,
          isCompleted: false,
          isArchived: false,
          visual: {
            badgeVariant: 'success',
            barClass: 'bg-emerald-500',
            textClass: 'text-emerald-600',
            dotClass: 'bg-emerald-500',
            iconClass: 'text-emerald-600',
          } as const,
        }
  const statusLabel = isArchived
    ? t('status.archived')
    : isScheduled
      ? t('status.scheduled')
      : isCompleted
        ? t('status.completed')
        : isOver
          ? t('status.over')
          : isTrending
            ? t('status.trending')
            : t('status.onTrack')
  const hasExceededLimit = period ? period.remaining < 0 && !isScheduled : false
  const periodRange = period
    ? formatBudgetPeriodRange(
        budget.periodType,
        dateValue(period.from),
        dateValue(period.to),
        (date) => formatDateOnly(date, locale, { dateStyle: 'medium' }),
      )
    : null
  const categoryItems = budget
    ? budget.categoryScope === 'ALL'
      ? [
          {
            id: 'all',
            label: t('allCategories'),
            leading: <IconChipVisual icon={Layers} />,
          },
        ]
      : budget.categoryNodeIds.map((id) => {
          const category = getCategoryById(id)
          return {
            id,
            label: categoryScopeLabel(tCategories, id),
            leading: category ? (
              <CategoryChipVisual category={category} />
            ) : undefined,
          }
        })
    : []
  const participantItems = budget
    ? budget.participantScope === 'ALL'
      ? [
          {
            id: 'all',
            label: t('allParticipants'),
            leading: <IconChipVisual icon={Users} />,
          },
        ]
      : budget.participantIds.map((id) => {
          const participant = group?.participants.find((p) => p.id === id)
          return {
            id,
            label: participant?.name ?? id,
            leading: participant ? (
              <ParticipantChipVisual participant={participant} />
            ) : undefined,
          }
        })
    : []

  return (
    <>
      <ResponsiveDialog
        open={detailOpen}
        onOpenChange={(open) => {
          if (!open) onClose()
          else setDetailOpen(open)
        }}
      >
        <ResponsiveDialogContent className="max-w-xl">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle className="truncate">
              {budget?.name ?? t('detailTitle')}
            </ResponsiveDialogTitle>
            <ResponsiveDialogDescription>
              {periodRange ?? t('detailTitle')}
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>

          <ResponsiveDialogBody className="max-h-[70vh] space-y-5 overflow-y-auto">
            {budgetQuery.isLoading && (
              <div className="space-y-4" aria-label={t('detailTitle')}>
                <Skeleton className="h-10 w-36" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-20 w-full" />
              </div>
            )}
            {!budgetQuery.isLoading && budgetQuery.error && (
              <div className="flex flex-col items-start gap-3">
                <p role="alert" className="text-sm text-destructive">
                  {budgetQuery.error.message}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void budgetQuery.refetch()}
                >
                  <RefreshCw className="me-2 size-4" aria-hidden="true" />
                  {t('retry')}
                </Button>
              </div>
            )}
            {budget && period && currency && (
              <>
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-3xl font-bold tracking-tight tabular-nums">
                        {formatCurrency(currency, period.used, locale)}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {t('ofLimit', {
                          amount: formatCurrency(
                            currency,
                            period.limit,
                            locale,
                          ),
                        })}
                      </p>
                      {period.committed > 0 && (
                        <p className="text-xs text-muted-foreground tabular-nums">
                          {t('committedSubline', {
                            amount: formatCurrency(
                              currency,
                              period.committed,
                              locale,
                            ),
                          })}
                        </p>
                      )}
                    </div>
                    <Badge
                      variant={visual.badgeVariant}
                      className="shrink-0 gap-1"
                    >
                      {isTrending && (
                        <TrendingUp className="size-3.5" aria-hidden="true" />
                      )}
                      {statusLabel}
                    </Badge>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm">
                    <span
                      className={cn(
                        'font-medium tabular-nums',
                        (isOver || hasExceededLimit) && visual.textClass,
                      )}
                    >
                      {isOver || hasExceededLimit
                        ? t('overBy', {
                            amount: formatCurrency(
                              currency,
                              Math.abs(period.remaining),
                              locale,
                            ),
                          })
                        : t('remaining', {
                            amount: formatCurrency(
                              currency,
                              period.remaining,
                              locale,
                            ),
                          })}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {isScheduled
                        ? (period.daysUntilStart ?? 0) === 0
                          ? t('startsToday')
                          : t('startsIn', {
                              count: period.daysUntilStart ?? 0,
                            })
                        : isCompleted
                          ? t('completed')
                          : isArchived
                            ? t('archived')
                            : t('daysRemaining', {
                                count: period.daysRemaining,
                              })}
                    </span>
                  </div>
                  {period.projected != null &&
                    !isArchived &&
                    !isScheduled &&
                    !isCompleted && (
                      <p className="text-xs text-muted-foreground tabular-nums">
                        {t('projected', {
                          amount: formatCurrency(
                            currency,
                            period.projected,
                            locale,
                          ),
                        })}
                      </p>
                    )}
                </div>

                <div className="space-y-3 border-t pt-4">
                  <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                    {t('scope')}
                  </h3>
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">
                      {t('form.categories')}
                    </p>
                    <ScopeChipList items={categoryItems} />
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">
                      {t('form.participants')}
                    </p>
                    <ScopeChipList items={participantItems} />
                  </div>
                </div>

                <div className="space-y-2 border-t pt-4">
                  <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                    {t('form.notifications')}
                  </h3>
                  {budget.notifyTrending || budget.notifyOver ? (
                    <div className="flex flex-wrap gap-2">
                      {budget.notifyTrending && (
                        <Badge variant="secondary">
                          {t('form.notifyTrending')}
                        </Badge>
                      )}
                      {budget.notifyOver && (
                        <Badge variant="secondary">
                          {t('form.notifyOver')}
                        </Badge>
                      )}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      {t('notificationsOff')}
                    </p>
                  )}
                </div>

                <div data-testid="budget-chart-host">
                  <BudgetChart budget={budget} currency={currency} />
                </div>

                <div className="space-y-1 border-t pt-4">
                  <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                    {t('matchingExpenses')}
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    {t('matchingExpensesDescription')}
                  </p>
                  {budget.matchingExpenses.length === 0 ? (
                    <p className="py-4 text-center text-sm text-muted-foreground">
                      {t('noMatchingExpenses')}
                    </p>
                  ) : (
                    <ul className="-mx-4 divide-y">
                      {budget.matchingExpenses.map((expense) => (
                        <li key={expense.id}>
                          <ExpenseCard
                            expense={expense}
                            currency={currency}
                            groupId={groupId}
                            participantCount={group?.participants.length ?? 0}
                            contributionAmount={expense.contribution}
                          />
                        </li>
                      ))}
                    </ul>
                  )}
                  {(period.matchingExpensesTotal ??
                    budget.matchingExpenses.length) >
                    budget.matchingExpenses.length && (
                    <p className="pt-3 text-xs text-muted-foreground tabular-nums">
                      {t('moreExpenses', {
                        count:
                          (period.matchingExpensesTotal ?? 0) -
                          budget.matchingExpenses.length,
                      })}
                    </p>
                  )}
                </div>

                <div className="space-y-1 border-t pt-4">
                  <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                    {t('upcoming')}
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    {t('upcomingDescription')}
                  </p>
                  {budget.upcomingExpenses.length === 0 ? (
                    <p className="py-4 text-center text-sm text-muted-foreground">
                      {t('noUpcoming')}
                    </p>
                  ) : (
                    <ul className="-mx-4 divide-y">
                      {budget.upcomingExpenses.map((expense) => (
                        <li key={expense.id}>
                          <ExpenseCard
                            expense={expense}
                            currency={currency}
                            groupId={groupId}
                            participantCount={group?.participants.length ?? 0}
                            contributionAmount={expense.contribution}
                          />
                        </li>
                      ))}
                    </ul>
                  )}
                  {(period.upcomingExpensesTotal ??
                    budget.upcomingExpenses.length) >
                    budget.upcomingExpenses.length && (
                    <p className="pt-3 text-xs text-muted-foreground tabular-nums">
                      {t('moreUpcomingExpenses', {
                        count:
                          (period.upcomingExpensesTotal ?? 0) -
                          budget.upcomingExpenses.length,
                      })}
                    </p>
                  )}
                  {budget.upcomingExpenses.length > 0 && (
                    <p className="pt-3 text-xs text-muted-foreground tabular-nums">
                      {t('upcomingTotal', {
                        amount: formatCurrency(
                          currency,
                          period.committed,
                          locale,
                        ),
                      })}
                    </p>
                  )}
                </div>

                <div className="space-y-1 border-t pt-4">
                  <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                    {t('history')}
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    {t('historyDescription')}
                  </p>
                  {budget.history.length === 0 ? (
                    <p className="py-4 text-center text-sm text-muted-foreground">
                      {t('noHistory')}
                    </p>
                  ) : (
                    <div className="divide-y">
                      {budget.history.map((historyPeriod, index) => (
                        <div
                          key={`${String(historyPeriod.from)}-${index}`}
                          className="flex items-center justify-between gap-3 py-2.5 text-sm"
                        >
                          <span className="flex items-center gap-2">
                            <span
                              aria-hidden="true"
                              className={cn(
                                'size-2 shrink-0 rounded-full',
                                historyPeriod.trendStatus === 'OVER'
                                  ? 'bg-destructive'
                                  : 'bg-emerald-500',
                              )}
                            />
                            {historyPeriod.label ??
                              formatBudgetPeriodRange(
                                budget.periodType,
                                dateValue(historyPeriod.from),
                                dateValue(historyPeriod.to),
                                (date) =>
                                  formatDateOnly(date, locale, {
                                    dateStyle: 'medium',
                                  }),
                              )}
                          </span>
                          <span
                            className={cn(
                              'tabular-nums',
                              historyPeriod.trendStatus === 'OVER'
                                ? 'text-destructive'
                                : 'text-emerald-600 dark:text-emerald-400',
                            )}
                          >
                            {formatCurrency(
                              currency,
                              historyPeriod.used,
                              locale,
                            )}{' '}
                            /{' '}
                            {formatCurrency(
                              currency,
                              historyPeriod.limit,
                              locale,
                            )}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </ResponsiveDialogBody>

          <ResponsiveDialogFooter className="flex-row gap-2 sm:justify-end">
            {budget && (canEdit || canArchive || canDelete) && (
              <>
                {canDelete && (
                  <DeletePopup
                    className="me-auto"
                    labels={{
                      label: t('delete'),
                      title: t('delete'),
                      description: t('deleteDescription'),
                      deleting: t('deleting'),
                    }}
                    onDelete={async () => {
                      await deleteMutation.mutateAsync({
                        groupId,
                        budgetId,
                      })
                    }}
                  />
                )}
                {budget.archived && canArchive ? (
                  <Button
                    variant="outline"
                    className="flex-1 sm:flex-none"
                    onClick={() =>
                      archiveMutation.mutate({
                        groupId,
                        budgetId,
                        archived: false,
                      })
                    }
                    disabled={archiveMutation.isPending}
                  >
                    <ArchiveRestore
                      className="me-2 size-4"
                      aria-hidden="true"
                    />
                    {tCommon('Groups.bannerUnarchive')}
                  </Button>
                ) : !budget.archived ? (
                  <>
                    {canArchive && (
                      <Button
                        variant="outline"
                        className="flex-1 sm:flex-none"
                        onClick={() =>
                          archiveMutation.mutate({
                            groupId,
                            budgetId,
                            archived: true,
                          })
                        }
                        disabled={archiveMutation.isPending}
                      >
                        <Archive className="me-2 size-4" aria-hidden="true" />
                        {t('archive')}
                      </Button>
                    )}
                    {canEdit && (
                      <EditButton
                        label={t('edit')}
                        nativeButton={false}
                        render={
                          <Link
                            to="/groups/$groupId/budgets/$budgetId/edit"
                            params={{ groupId, budgetId }}
                          />
                        }
                      />
                    )}
                  </>
                ) : null}
              </>
            )}
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </>
  )
}
