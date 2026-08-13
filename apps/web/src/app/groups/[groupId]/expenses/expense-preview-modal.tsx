import { Link, useNavigate } from '@tanstack/react-router'
import { FileInput } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { CategoryIcon } from '@/app/groups/[groupId]/expenses/category-icon'
import {
  CategorySideEffectBadge,
  getCategorySideEffectKind,
} from '@/app/groups/[groupId]/expenses/category-side-effect-badge'
import { ExpenseAttachmentsPreview } from '@/app/groups/[groupId]/expenses/expense-attachments-preview'
import { ExpenseComments } from '@/app/groups/[groupId]/expenses/expense-comments'
import { ExpenseItemsSummary } from '@/app/groups/[groupId]/expenses/expense-items-summary'
import {
  useDeleteExpenseMutation,
  useStopRecurrenceMutation,
} from '@/app/groups/[groupId]/expenses/expense-mutation-hooks'
import { ExpenseSplitBars } from '@/app/groups/[groupId]/expenses/expense-split-bars'
import { categoryLabel } from '@/app/groups/[groupId]/stats/category-utils'
import { DeletePopup } from '@/components/delete-popup'
import { EditButton } from '@/components/edit-button'
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
import type { BalanceExpense } from '@/lib/balances'
import { getBalances } from '@/lib/balances'
import { getCurrency } from '@/lib/currency'
import { formatExpenseClosed } from '@/lib/expense-display'
import { formatCurrency, getCurrencyFromGroup } from '@/lib/utils'
import { trpc } from '@/trpc/client'
import type { AppRouterOutput } from '@spliit/api/router'
import type { SplitMode } from '@spliit/domain'
import { calculatePaidByShares, calculateShares } from '@spliit/domain'

import {
  useCurrentGroup,
  useIsReadOnlyGroupViewer,
} from '../current-group-context'
import { useLinkInviteToken } from '../use-link-invite-token'
import { expenseShareRatioLabel } from './expense-share-ratio-label'
import {
  RecurringActionsMenu,
  type RecurringDeleteOption,
} from './recurring-actions-menu'
import { SeriesControls, type ExpenseSeriesMetadata } from './series-controls'
import { SeriesListDialog } from './series-list-dialog'
import type { SeriesMutationScope } from './series-scope-dialog'

export type Expense = NonNullable<
  AppRouterOutput['groups']['expenses']['get']['expense']
>

export type ExpensePreviewModalProps = {
  groupId: string
  expenseId: string
  returnTo?: string
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /** Called when the dialog closes, e.g. to restore the previous route. */
  onClose?: () => void
  /** Override the default navigation to the full expense edit page. */
  onEdit?: (scope?: SeriesMutationScope) => void
  /**
   * Override the default navigation that prefills the create form from this
   * expense.
   */
  onMakeCopy?: () => void
}

function toBalanceExpense(
  expense: Expense,
  participants: Array<{ id: string; name: string }>,
): BalanceExpense {
  const participant = (id: string) => ({
    id,
    name: participants.find((item) => item.id === id)?.name,
  })

  return {
    id: expense.id,
    amount: expense.amount,
    categoryId: expense.categoryId,
    splitMode: expense.splitMode,
    paidBySplitMode: expense.paidBySplitMode,
    originalAmount: expense.originalAmount,
    originalCurrency: expense.originalCurrency,
    conversionRate: expense.conversionRate,
    conversionSource: expense.conversionSource,
    paidByList: expense.paidByList.map((payer) => ({
      shares: payer.shares,
      participant: participant(payer.ledgerParticipantId),
    })),
    paidFor: expense.paidFor.map((entry) => ({
      shares: entry.shares,
      participant: participant(entry.ledgerParticipantId),
    })),
    items: expense.items.map((item) => ({
      amount: item.amount,
      splitMode: item.splitMode,
      paidFor: item.paidFor.map((entry) => ({
        participant: entry.ledgerParticipantId,
        shares: entry.shares,
      })),
    })),
    itemizedRemainder: expense.itemizedRemainder
      ? {
          splitMode: expense.itemizedRemainder.splitMode,
          paidFor: expense.itemizedRemainder.paidFor.map((entry) => ({
            participant: entry.ledgerParticipantId,
            shares: entry.shares,
          })),
        }
      : null,
  }
}

// react-doctor-disable-next-line react-doctor/no-giant-component -- cohesive preview modal, single responsibility
export function ExpensePreviewModal({
  groupId,
  expenseId,
  returnTo,
  open = true,
  onOpenChange,
  onClose,
  onEdit,
  onMakeCopy,
}: ExpensePreviewModalProps) {
  const { group, currentLedgerParticipantId, currentMember } = useCurrentGroup()
  const isReadOnlyGroupViewer = useIsReadOnlyGroupViewer()
  const linkInviteToken = useLinkInviteToken()
  const locale = useLocale()
  const navigate = useNavigate()
  const { toast } = useToast()
  const { t } = useTranslation(undefined, { keyPrefix: 'ExpensePreview' })
  const { t: tForm } = useTranslation(undefined, { keyPrefix: 'ExpenseForm' })
  const { t: tCard } = useTranslation(undefined, { keyPrefix: 'ExpenseCard' })
  const { t: tCategories } = useTranslation(undefined, {
    keyPrefix: 'Categories',
  })

  const { data, isLoading, error } = trpc.groups.expenses.get.useQuery(
    { groupId, expenseId, linkInviteToken },
    { enabled: open, retry: false },
  )

  const expense = data?.expense
  const [seriesListOpen, setSeriesListOpen] = useState(false)
  const series = useMemo<ExpenseSeriesMetadata | null>(() => {
    if (!expense) return null
    const raw = expense as typeof expense & {
      recurringSeriesId?: string | null
      recurrenceSequence?: number | null
      previousExpenseId?: string | null
      nextExpenseId?: string | null
      recurringSeries?: {
        id: string
        status?: ExpenseSeriesMetadata['status']
      } | null
      series?: { id: string; status?: ExpenseSeriesMetadata['status'] } | null
    }
    const related = raw.recurringSeries ?? raw.series
    const id = raw.recurringSeriesId ?? related?.id
    const sequence = raw.recurrenceSequence
    if (!id || sequence == null) return null
    return {
      id,
      sequence,
      status: related?.status,
      previousExpenseId: raw.previousExpenseId,
      nextExpenseId: raw.nextExpenseId,
    }
  }, [expense])
  const currency = group ? getCurrencyFromGroup(group) : undefined
  const canEdit = Boolean(expense?.permissions.canEdit)
  const canDelete = Boolean(expense?.permissions.canDelete)
  const canManageRecurrence = Boolean(expense?.permissions.canManageRecurrence)
  const canCopy = Boolean(
    expense &&
    group &&
    currentMember &&
    !group.archived &&
    !isReadOnlyGroupViewer,
  )
  const participants = group?.participants ?? []
  const balanceExpense = expense
    ? toBalanceExpense(expense, participants)
    : null
  const paidForShares =
    balanceExpense && expense ? calculateShares(balanceExpense) : {}
  const paidByShares = balanceExpense
    ? calculatePaidByShares(balanceExpense)
    : {}
  const splitModeLabel = (
    side: 'paidBy' | 'paidFor',
    mode: SplitMode,
  ): string => {
    if (side === 'paidBy') {
      switch (mode) {
        case 'EVENLY':
          return tForm('paidByOptionEvenly')
        case 'BY_SHARES':
          return tForm('paidByOptionByShares')
        case 'BY_PERCENTAGE':
          return tForm('paidByOptionByPercentage')
        case 'BY_AMOUNT':
          return tForm('paidByOptionByAmount')
        case 'ITEMIZED':
          return tForm('paidForOptionItemized')
      }
    }

    switch (mode) {
      case 'EVENLY':
        return tForm('paidForOptionEvenly')
      case 'BY_SHARES':
        return tForm('paidForOptionByShares')
      case 'BY_PERCENTAGE':
        return tForm('paidForOptionByPercentage')
      case 'BY_AMOUNT':
        return tForm('paidForOptionByAmount')
      case 'ITEMIZED':
        return tForm('paidForOptionItemized')
    }
  }

  const splitRows = (
    shares: Record<string, number>,
    sourceRows: Array<{ ledgerParticipantId: string; shares: number }>,
    mode: SplitMode,
  ) => {
    return Object.entries(shares).map(([id, amount]) => {
      const participant = participants.find((item) => item.id === id)
      return {
        id,
        name: participant?.name ?? id,
        amount,
        value: expenseShareRatioLabel(mode, sourceRows, id, locale),
        participant,
      }
    })
  }

  const paidByRows = expense
    ? splitRows(paidByShares, expense.paidByList, expense.paidBySplitMode)
    : []
  const paidForRows = expense
    ? splitRows(paidForShares, expense.paidFor, expense.splitMode)
    : []

  const handleOpenChange = (nextOpen: boolean) => {
    if (onOpenChange) {
      onOpenChange(nextOpen)
    } else if (!nextOpen && !onClose) {
      void navigate({
        to: '/groups/$groupId/expenses',
        params: { groupId },
      })
    }
    if (!nextOpen) onClose?.()
  }

  const handleEdit = async (scope?: SeriesMutationScope) => {
    if (onEdit) {
      onEdit(scope)
      return
    }
    await navigate({
      to: '/groups/$groupId/expenses/$expenseId/edit',
      params: { groupId, expenseId },
      search: {
        ...(scope ? { scope } : {}),
        ...(returnTo ? { returnTo } : {}),
      },
    })
  }

  const handleMakeCopy = () => {
    if (onMakeCopy) {
      onMakeCopy()
      return
    }
    toast({ description: tCard('copyToast') })
  }

  const { mutateAsync: deleteExpenseMutateAsync } = useDeleteExpenseMutation({
    linkInviteToken,
    onDeleted: onClose,
  })
  const { mutateAsync: stopRecurrenceMutateAsync } = useStopRecurrenceMutation({
    linkInviteToken,
  })
  const handleDelete = async (option?: RecurringDeleteOption) => {
    if (!option) {
      await deleteExpenseMutateAsync({ expenseId, groupId })
      return
    }
    const scope =
      option === 'OCCURRENCE' ? 'OCCURRENCE' : ('THIS_AND_FUTURE' as const)
    await deleteExpenseMutateAsync({
      expenseId,
      groupId,
      scope,
      ...(scope === 'THIS_AND_FUTURE'
        ? { stopRecurrence: option === 'THIS_AND_FUTURE_STOP' }
        : {}),
    } as Parameters<typeof deleteExpenseMutateAsync>[0])
  }
  const handleStopRecurrence = async () => {
    await stopRecurrenceMutateAsync({ groupId, expenseId })
  }

  const originalCurrency =
    expense?.originalCurrency &&
    currency &&
    expense.originalCurrency !== currency.code
      ? getCurrency(expense.originalCurrency)
      : undefined
  const showOriginalAmount =
    expense &&
    expense.originalAmount != null &&
    originalCurrency != null &&
    currency != null

  const activeBalance =
    expense && currentLedgerParticipantId && currency
      ? (getBalances([toBalanceExpense(expense, participants)])[
          currentLedgerParticipantId
        ]?.total ?? null)
      : null
  const categorySideEffect = getCategorySideEffectKind(expense?.categoryId)

  return (
    <ResponsiveDialog open={open} onOpenChange={handleOpenChange}>
      <ResponsiveDialogContent className="max-w-lg">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle className="flex items-center gap-2">
            {expense ? (
              <CategoryIcon
                category={expense.category}
                className="h-5 w-5 shrink-0 text-muted-foreground"
              />
            ) : null}
            <span className="truncate">{expense?.title ?? t('title')}</span>
            {categorySideEffect ? (
              <CategorySideEffectBadge kind={categorySideEffect} />
            ) : null}
          </ResponsiveDialogTitle>
          {categorySideEffect ? null : (
            <ResponsiveDialogDescription>
              {expense
                ? categoryLabel(tCategories, expense.categoryId)
                : t('title')}
            </ResponsiveDialogDescription>
          )}
        </ResponsiveDialogHeader>

        <ResponsiveDialogBody className="max-h-[70vh] space-y-5 overflow-y-auto">
          {isLoading && (
            <div className="space-y-4" aria-label={t('title')}>
              <Skeleton className="h-10 w-36" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-20 w-full" />
            </div>
          )}
          {!isLoading && error && (
            <p className="text-sm text-muted-foreground">{error.message}</p>
          )}
          {!isLoading && !error && expense && currency && (
            <div className="space-y-5">
              <div>
                <div className="text-3xl font-bold tracking-tight tabular-nums">
                  {formatCurrency(currency, expense.amount, locale)}
                </div>
                {showOriginalAmount && (
                  <div className="mt-1 text-sm text-muted-foreground tabular-nums">
                    {formatCurrency(
                      originalCurrency,
                      expense.originalAmount!,
                      locale,
                    )}
                  </div>
                )}
              </div>

              {(() => {
                const d = formatExpenseClosed(
                  expense as never,
                  locale,
                  undefined,
                  tForm('dateTimePicker.yourTime' as never),
                )
                return (
                  <div
                    className="text-sm text-muted-foreground"
                    title={d.tooltip}
                  >
                    {t('date')}:{' '}
                    <span className="text-foreground">{d.text}</span>
                  </div>
                )
              })()}

              <div className="space-y-4 border-t pt-4">
                <ExpenseSplitBars
                  label={t('paidBy')}
                  modeLabel={splitModeLabel('paidBy', expense.paidBySplitMode)}
                  rows={paidByRows}
                  currency={currency}
                  locale={locale}
                />
                <ExpenseSplitBars
                  label={t('paidFor')}
                  modeLabel={splitModeLabel('paidFor', expense.splitMode)}
                  rows={paidForRows}
                  currency={currency}
                  locale={locale}
                />
              </div>

              {currentLedgerParticipantId && (
                <div className="rounded-lg border bg-muted/30 px-4 py-3">
                  <div className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                    {t('yourBalance')}
                  </div>
                  <div className="mt-1 text-lg font-semibold tabular-nums">
                    {activeBalance == null ? (
                      tCard('notInvolved')
                    ) : (
                      <span
                        className={
                          activeBalance < 0 ? 'text-red-600' : 'text-green-600'
                        }
                      >
                        {formatCurrency(currency, activeBalance, locale)}
                      </span>
                    )}
                  </div>
                </div>
              )}

              {expense.notes?.trim() && (
                <div className="space-y-1">
                  <div className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                    {t('notes')}
                  </div>
                  <p className="text-sm break-words whitespace-pre-wrap text-muted-foreground">
                    {expense.notes.trim().length > 160
                      ? `${expense.notes.trim().slice(0, 160)}…`
                      : expense.notes.trim()}
                  </p>
                </div>
              )}

              <ExpenseItemsSummary
                items={expense.items}
                currency={currency}
                locale={locale}
              />

              <ExpenseAttachmentsPreview documents={expense.documents} />

              {series && (
                <SeriesControls
                  groupId={groupId}
                  series={series}
                  onViewSeries={() => setSeriesListOpen(true)}
                />
              )}
            </div>
          )}
          {expense && (
            <ExpenseComments groupId={groupId} expenseId={expenseId} />
          )}
        </ResponsiveDialogBody>

        <ResponsiveDialogFooter className="flex-row gap-2 sm:justify-end">
          {series ? (
            canManageRecurrence ? (
              <RecurringActionsMenu
                className="me-auto"
                seriesStatus={series.status}
                confirmationTarget={expense?.title ?? ''}
                onEdit={handleEdit}
                onDelete={(option) => handleDelete(option)}
                onStop={
                  series.status === 'CANCELLED' || series.status === 'COMPLETED'
                    ? undefined
                    : handleStopRecurrence
                }
              />
            ) : null
          ) : canDelete ? (
            <DeletePopup
              onDelete={() => handleDelete()}
              confirmationTarget={expense?.title ?? ''}
              className="me-auto"
            />
          ) : null}
          {canCopy && (
            <>
              <Button
                variant="outline"
                className="flex-1 sm:flex-none"
                render={
                  onMakeCopy ? undefined : (
                    <Link
                      to="/groups/$groupId/expenses/create"
                      params={{ groupId }}
                      search={{
                        fromExpenseId: expenseId,
                        ...(returnTo ? { returnTo } : {}),
                      }}
                    />
                  )
                }
                onClick={handleMakeCopy}
                data-testid="expense-make-copy"
              >
                <FileInput className="me-2 h-4 w-4" />
                {t('makeCopy')}
              </Button>
              {canEdit && !series && (
                <EditButton
                  label={t('edit')}
                  render={
                    onEdit ? undefined : (
                      <Link
                        to="/groups/$groupId/expenses/$expenseId/edit"
                        params={{ groupId, expenseId }}
                        search={returnTo ? { returnTo } : undefined}
                      />
                    )
                  }
                  onClick={onEdit ? () => void handleEdit() : undefined}
                />
              )}
            </>
          )}
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
      {series && (
        <SeriesListDialog
          groupId={groupId}
          seriesId={series.id}
          open={seriesListOpen}
          onOpenChange={setSeriesListOpen}
        />
      )}
    </ResponsiveDialog>
  )
}
