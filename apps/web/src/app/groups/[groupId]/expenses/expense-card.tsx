/* oxlint-disable jsx-a11y/prefer-tag-over-role -- card is an interactive container with a nested link button. */
import { useNavigate } from '@tanstack/react-router'
import { ChevronRight } from 'lucide-react'
import { Trans, useTranslation } from 'react-i18next'

import { ActiveUserBalance } from '@/app/groups/[groupId]/expenses/active-user-balance'
import { CategoryIcon } from '@/app/groups/[groupId]/expenses/category-icon'
import { DocumentsCount } from '@/app/groups/[groupId]/expenses/documents-count'
import Link from '@/components/link'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useLocale } from '@/i18n/react'
import type { getGroupExpenses } from '@/lib/api'
import { getCurrency, type Currency } from '@/lib/currency'
import { cn, formatCurrency, formatDateOnly } from '@/lib/utils'

import { RecurringBadge } from './series-controls'

type Expense = Awaited<ReturnType<typeof getGroupExpenses>>[number]

const participantsKey = {
  paidBy: 'ExpenseCard.paidBy',
  paidByMultiple: 'ExpenseCard.paidByMultiple',
  receivedBy: 'ExpenseCard.receivedBy',
  receivedByMultiple: 'ExpenseCard.receivedByMultiple',
} as const

function ItemsPreview({
  items,
  currency,
  locale,
}: {
  items: Expense['items']
  currency: Currency
  locale: string
}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'ExpenseCard' })
  if (items.length === 0) return null

  const maxPreview = 2
  const previewItems = items.slice(0, maxPreview)
  const remaining = items.length - maxPreview

  return (
    <div className="text-xs text-muted-foreground">
      {previewItems.map((item) => (
        <div key={item.id}>
          {item.title} <span className="text-muted-foreground/50">·</span>{' '}
          {formatCurrency(currency, item.amount, locale)}
        </div>
      ))}
      {remaining > 0 && <div>{t('items.more', { count: remaining })}</div>}
    </div>
  )
}

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
        <span key={index}>
          {index !== 0 && <>, </>}
          <strong>{paidFor.ledgerParticipant.name}</strong>
        </span>
      ))
    )

  const isMultiPayer = expense.paidByList.length > 1
  const direction = expense.amount > 0 ? 'paidBy' : 'receivedBy'
  const i18nKey = isMultiPayer
    ? participantsKey[`${direction}Multiple`]
    : participantsKey[direction]

  if (isMultiPayer) {
    // Decision #13: sort payers alphabetically by resolved display name.
    const sortedPaidByList = expense.paidByList.toSorted((a, b) =>
      a.ledgerParticipant.name.localeCompare(b.ledgerParticipant.name),
    )
    const paidByNames = sortedPaidByList.map((pb, index) => (
      <span key={pb.ledgerParticipant.id}>
        {index !== 0 && <>, </>}
        <strong>{pb.ledgerParticipant.name}</strong>
      </span>
    ))
    return (
      <Trans
        i18nKey={i18nKey}
        values={{ forCount: expense.paidFor.length }}
        components={{
          paidByNames: <span>{paidByNames}</span>,
          paidFor: <span>{paidFor}</span>,
        }}
      />
    )
  }

  return (
    <Trans
      i18nKey={i18nKey}
      values={{
        paidBy: expense.paidByList[0].ledgerParticipant.name,
        forCount: expense.paidFor.length,
      }}
      components={{
        strong: <strong />,
        paidFor: <span>{paidFor}</span>,
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
  const navigate = useNavigate()
  const locale = useLocale()
  const originalCurrency =
    expense.originalCurrency && expense.originalCurrency !== currency.code
      ? getCurrency(expense.originalCurrency)
      : undefined
  const originalAmount = expense.originalAmount ?? undefined
  const showOriginalAmount =
    originalCurrency !== undefined && originalAmount !== undefined
  const seriesId = (
    expense as typeof expense & {
      recurringSeriesId?: string | null
    }
  ).recurringSeriesId
  const seriesStatus =
    (
      expense as typeof expense & {
        recurringSeriesStatus?:
          | 'ACTIVE'
          | 'PAUSED'
          | 'COMPLETED'
          | 'CANCELLED'
          | null
      }
    ).recurringSeriesStatus ?? undefined

  return (
    <div
      key={expense.id}
      data-testid={`expense-item-${expense.id}`}
      className={cn(
        'motion-surface motion-surface-interactive flex cursor-pointer items-stretch justify-between gap-1 px-4 py-4 text-sm hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-hidden sm:mx-6 sm:rounded-lg sm:pr-2 sm:pl-4',
        expense.isReimbursement && 'italic',
      )}
      role="button"
      tabIndex={0}
      onClick={() => {
        void navigate({
          to: '/groups/$groupId/expenses/$expenseId',
          params: { groupId, expenseId: expense.id },
        })
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          void navigate({
            to: '/groups/$groupId/expenses/$expenseId',
            params: { groupId, expenseId: expense.id },
          })
        }
      }}
    >
      <CategoryIcon
        category={expense.category}
        className="mt-0.5 mr-2 h-4 w-4 text-muted-foreground"
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
          {seriesId && (
            <RecurringBadge className="text-[0.68rem]" status={seriesStatus} />
          )}
        </div>
        <div className="text-xs text-muted-foreground">
          <Participants expense={expense} participantCount={participantCount} />
        </div>
        <ItemsPreview
          items={expense.items}
          currency={currency}
          locale={locale}
        />
        <div className="text-xs text-muted-foreground">
          <ActiveUserBalance {...{ groupId, currency, expense }} />
        </div>
      </div>
      <div className="flex flex-col items-end justify-between">
        <div
          className={cn(
            'whitespace-nowrap tabular-nums',
            expense.isReimbursement ? 'italic' : 'font-bold',
          )}
          data-testid="expense-amount"
        >
          {formatCurrency(currency, expense.amount, locale)}
        </div>
        {showOriginalAmount && (
          <div
            className="mt-0.5 flex items-center gap-1 text-xs whitespace-nowrap text-muted-foreground tabular-nums"
            data-testid="expense-original-amount"
          >
            <span>
              {formatCurrency(originalCurrency, originalAmount, locale)}
            </span>
          </div>
        )}
        <div className="text-xs text-muted-foreground">
          <DocumentsCount count={expense.documentCount} />
        </div>
        <div
          className="text-xs text-muted-foreground"
          data-testid="expense-date"
        >
          {formatDateOnly(expense.expenseDate, locale, { dateStyle: 'medium' })}
        </div>
      </div>
      <Button
        size="icon"
        variant="link"
        className="hidden self-center sm:flex"
        asChild
      >
        <Link href={`/groups/${groupId}/expenses/${expense.id}`}>
          <ChevronRight className="h-4 w-4" />
        </Link>
      </Button>
    </div>
  )
}
