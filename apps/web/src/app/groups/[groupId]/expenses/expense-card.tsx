'use client'
import { ActiveUserBalance } from '@/app/groups/[groupId]/expenses/active-user-balance'
import { CategoryIcon } from '@/app/groups/[groupId]/expenses/category-icon'
import { DocumentsCount } from '@/app/groups/[groupId]/expenses/documents-count'
import Link from '@/components/link'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useLocale } from '@/i18n/react'
import { getGroupExpenses } from '@/lib/api'
import { Currency } from '@/lib/currency'
import { useRouter } from '@/lib/navigation'
import { cn, formatCurrency, formatDateOnly } from '@/lib/utils'
import { ChevronRight } from 'lucide-react'
import { Fragment } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { useIsPendingInvitee } from '../current-group-context'

type Expense = Awaited<ReturnType<typeof getGroupExpenses>>[number]

const participantsKey = {
  paidBy: 'ExpenseCard.paidBy',
  receivedBy: 'ExpenseCard.receivedBy',
} as const

function Participants({
  expense,
  participantCount,
}: {
  expense: Expense
  participantCount: number
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'ExpenseCard' })
  const paidFor =
    expense.paidFor.length == participantCount && participantCount >= 4 ? (
      <strong>{t('everyone')}</strong>
    ) : (
      expense.paidFor.map((paidFor, index) => (
        <Fragment key={index}>
          {index !== 0 && <>, </>}
          <strong>{paidFor.ledgerParticipant.name}</strong>
        </Fragment>
      ))
    )

  const i18nKey = participantsKey[expense.amount > 0 ? 'paidBy' : 'receivedBy']

  return (
    <Trans
      i18nKey={i18nKey}
      values={{
        paidBy: expense.paidBy.name,
        forCount: expense.paidFor.length,
      }}
      components={{
        strong: <strong />,
        paidFor: <>{paidFor}</>,
      }}
    />
  )
}

type Props = {
  expense: Expense
  currency: Currency
  groupId: string
  participantCount: number
}

export function ExpenseCard({
  expense,
  currency,
  groupId,
  participantCount,
}: Props) {
  const { t } = useTranslation(undefined, { keyPrefix: 'ExpenseCard' })
  const router = useRouter()
  const locale = useLocale()
  const isPendingInvitee = useIsPendingInvitee()
  // Pending invitees can browse the expense list but cannot edit; the
  // server rejects `groups.expenses.update`/`delete` for them anyway.
  const canEdit = !isPendingInvitee

  return (
    <div
      key={expense.id}
      data-testid={`expense-item-${expense.id}`}
      className={cn(
        'flex justify-between sm:mx-6 px-4 sm:rounded-lg sm:pr-2 sm:pl-4 py-4 text-sm gap-1 items-stretch',
        canEdit && 'cursor-pointer hover:bg-accent',
        expense.isReimbursement && 'italic',
      )}
      onClick={() => {
        if (!canEdit) return
        router.push({
          to: '/groups/$groupId/expenses/$expenseId/edit',
          params: { groupId, expenseId: expense.id },
        })
      }}
    >
      <CategoryIcon
        category={expense.category}
        className="w-4 h-4 mr-2 mt-0.5 text-muted-foreground"
      />
      <div className="flex-1">
        <div
          className={cn(
            'mb-1 flex items-center gap-2',
            expense.isReimbursement && 'italic',
          )}
          data-testid="expense-title"
        >
          <span>{expense.title}</span>
          {expense.isReimbursement && (
            <Badge variant="secondary" className="text-xs">
              {t('settlementBadge')}
            </Badge>
          )}
        </div>
        <div className="text-xs text-muted-foreground">
          <Participants expense={expense} participantCount={participantCount} />
        </div>
        <div className="text-xs text-muted-foreground">
          <ActiveUserBalance {...{ groupId, currency, expense }} />
        </div>
      </div>
      <div className="flex flex-col justify-between items-end">
        <div
          className={cn(
            'tabular-nums whitespace-nowrap',
            expense.isReimbursement ? 'italic' : 'font-bold',
          )}
          data-testid="expense-amount"
        >
          {formatCurrency(currency, expense.amount, locale)}
        </div>
        <div className="text-xs text-muted-foreground">
          <DocumentsCount count={expense._count.documents} />
        </div>
        <div
          className="text-xs text-muted-foreground"
          data-testid="expense-date"
        >
          {formatDateOnly(expense.expenseDate, locale, { dateStyle: 'medium' })}
        </div>
      </div>
      {canEdit && (
        <Button
          size="icon"
          variant="link"
          className="self-center hidden sm:flex"
          asChild
        >
          <Link href={`/groups/${groupId}/expenses/${expense.id}/edit`}>
            <ChevronRight className="w-4 h-4" />
          </Link>
        </Button>
      )}
    </div>
  )
}
