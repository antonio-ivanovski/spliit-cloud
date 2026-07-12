import { CategoryIcon } from '@/app/groups/[groupId]/expenses/category-icon'
import { ExpenseAttachmentsPreview } from '@/app/groups/[groupId]/expenses/expense-attachments-preview'
import { ExpenseItemsSummary } from '@/app/groups/[groupId]/expenses/expense-items-summary'
import { useDeleteExpenseMutation } from '@/app/groups/[groupId]/expenses/expense-mutation-hooks'
import { ExpenseSplitBars } from '@/app/groups/[groupId]/expenses/expense-split-bars'
import { categoryLabel } from '@/app/groups/[groupId]/stats/category-utils'
import { DeletePopup } from '@/components/delete-popup'
import { QueryErrorState } from '@/components/query-error-state'
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
import type { BalanceExpense } from '@/lib/balances'
import { getBalances } from '@/lib/balances'
import { getCurrency } from '@/lib/currency'
import {
  formatCurrency,
  formatDateOnly,
  getCurrencyFromGroup,
} from '@/lib/utils'
import { trpc } from '@/trpc/client'
import type { AppRouterOutput } from '@spliit/api/router'
import { calculatePaidByShares, calculateShares } from '@spliit/domain'
import { useNavigate } from '@tanstack/react-router'
import { FileInput, Pencil } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useCurrentGroup, useIsPendingInvitee } from '../current-group-context'
import { useLinkInviteToken } from '../use-link-invite-token'

type Expense = NonNullable<
  AppRouterOutput['groups']['expenses']['get']['expense']
>

export type ExpensePreviewModalProps = {
  groupId: string
  expenseId: string
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /** Called when the dialog closes, e.g. to restore the previous route. */
  onClose?: () => void
  /** Override the default navigation to the full expense edit page. */
  onEdit?: () => void
  /** Override the default navigation that prefills the create form from this expense. */
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
    isReimbursement: expense.isReimbursement,
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

export function ExpensePreviewModal({
  groupId,
  expenseId,
  open = true,
  onOpenChange,
  onClose,
  onEdit,
  onMakeCopy,
}: ExpensePreviewModalProps) {
  const { group, currentLedgerParticipantId } = useCurrentGroup()
  const isPendingInvitee = useIsPendingInvitee()
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

  const { data, isLoading, error, refetch } = trpc.groups.expenses.get.useQuery(
    { groupId, expenseId, linkInviteToken },
    { enabled: open, retry: false },
  )

  const expense = data?.expense
  const currency = group ? getCurrencyFromGroup(group) : undefined
  const canEdit = Boolean(
    expense && group && !group.archived && !isPendingInvitee,
  )
  const participants = group?.participants ?? []
  const balanceExpense = expense
    ? toBalanceExpense(expense, participants)
    : null
  const paidForShares =
    balanceExpense && expense
      ? calculateShares({
          ...balanceExpense,
          isReimbursement: expense.isReimbursement,
        })
      : {}
  const paidByShares = balanceExpense
    ? calculatePaidByShares({
        ...balanceExpense,
        isReimbursement: expense?.isReimbursement ?? false,
      })
    : {}
  const splitRows = (shares: Record<string, number>) =>
    Object.entries(shares).map(([id, amount]) => {
      const participant = participants.find((item) => item.id === id)
      return {
        id,
        name: participant?.name ?? id,
        amount,
        participant,
      }
    })

  const handleOpenChange = (nextOpen: boolean) => {
    if (onOpenChange) {
      onOpenChange(nextOpen)
    } else if (!nextOpen && !onClose) {
      navigate({
        to: '/groups/$groupId/expenses',
        params: { groupId },
      })
    }
    if (!nextOpen) onClose?.()
  }

  const handleEdit = () => {
    if (onEdit) {
      onEdit()
      return
    }
    navigate({
      to: '/groups/$groupId/expenses/$expenseId/edit',
      params: { groupId, expenseId },
    })
  }

  const handleMakeCopy = () => {
    if (onMakeCopy) {
      onMakeCopy()
      return
    }
    toast({ description: tCard('copyToast') })
    navigate({
      to: '/groups/$groupId/expenses/create',
      params: { groupId },
      search: { fromExpenseId: expenseId },
    })
  }

  const { mutateAsync: deleteExpenseMutateAsync } = useDeleteExpenseMutation({
    linkInviteToken,
  })
  const handleDelete = async () => {
    await deleteExpenseMutateAsync({ expenseId, groupId })
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
            {expense?.isReimbursement && (
              <Badge variant="secondary" className="shrink-0 text-xs">
                {tForm('reimbursement')}
              </Badge>
            )}
          </ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            {expense
              ? categoryLabel(tCategories, expense.categoryId)
              : t('title')}
          </ResponsiveDialogDescription>
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
          {!isLoading && error && !expense && (
            <QueryErrorState
              compact
              onRetry={() => void refetch()}
              onBack={() => handleOpenChange(false)}
            />
          )}
          {!isLoading && expense && currency && (
            <div className="space-y-5">
              <div>
                <div className="text-3xl font-bold tabular-nums tracking-tight">
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

              <div className="text-sm text-muted-foreground">
                {t('date')}:{' '}
                <span className="text-foreground">
                  {formatDateOnly(expense.expenseDate, locale, {
                    dateStyle: 'medium',
                  })}
                </span>
              </div>

              <div className="space-y-4 border-t pt-4">
                <ExpenseSplitBars
                  label={t('paidBy')}
                  rows={splitRows(paidByShares)}
                  currency={currency}
                  locale={locale}
                />
                <ExpenseSplitBars
                  label={t('paidFor')}
                  rows={splitRows(paidForShares)}
                  currency={currency}
                  locale={locale}
                />
              </div>

              {currentLedgerParticipantId && (
                <div className="rounded-lg border bg-muted/30 px-4 py-3">
                  <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
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
                  <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {t('notes')}
                  </div>
                  <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">
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
            </div>
          )}
        </ResponsiveDialogBody>

        <ResponsiveDialogFooter className="flex-row gap-2 sm:justify-end">
          {canEdit && (
            <DeletePopup onDelete={handleDelete} className="mr-auto" />
          )}
          {canEdit && (
            <>
              <Button
                type="button"
                variant="outline"
                className="flex-1 sm:flex-none"
                onClick={handleMakeCopy}
                data-testid="expense-make-copy"
              >
                <FileInput className="mr-2 h-4 w-4" />
                {t('makeCopy')}
              </Button>
              <Button
                type="button"
                className="flex-1 sm:flex-none"
                onClick={handleEdit}
              >
                <Pencil className="mr-2 h-4 w-4" />
                {t('edit')}
              </Button>
            </>
          )}
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}
