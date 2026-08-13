import { Link, type LinkProps } from '@tanstack/react-router'
import { ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'

import { ActiveUserBalance } from '@/app/groups/[groupId]/expenses/active-user-balance'
import { CategoryIcon } from '@/app/groups/[groupId]/expenses/category-icon'
import { DocumentsCount } from '@/app/groups/[groupId]/expenses/documents-count'
import { useSyncedAccountPreferences } from '@/components/account-preferences-sync'
import { Badge } from '@/components/ui/badge'
import { useLocale } from '@/i18n/react'
import type { getGroupExpenses } from '@/lib/api'
import { getCurrency, type Currency } from '@/lib/currency'
import { formatExpenseClosed } from '@/lib/expense-display'
import { cn, formatCurrency } from '@/lib/utils'
import { isSettlementCategory } from '@spliit/domain'

import { ExpenseItemsOverflowToggle } from './expense-items-overflow-toggle'
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
  const [expanded, setExpanded] = useState(false)
  if (items.length === 0) return null

  const maxPreview = 2
  const remaining = items.length - maxPreview
  const visibleItems =
    expanded || remaining <= 0 ? items : items.slice(0, maxPreview)

  return (
    <div className="text-xs text-muted-foreground">
      {visibleItems.map((item) => (
        <div key={item.id}>
          {item.title} <span className="text-muted-foreground/50">·</span>{' '}
          {formatCurrency(currency, item.amount, locale)}
        </div>
      ))}
      {remaining > 0 && (
        <ExpenseItemsOverflowToggle
          expanded={expanded}
          remaining={remaining}
          onToggle={() => setExpanded((open) => !open)}
        />
      )}
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
  const locale = useLocale()
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
      a.ledgerParticipant.name.localeCompare(b.ledgerParticipant.name, locale, {
        sensitivity: 'base',
      }),
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
  /**
   * Optional override of the amount shown on the right. When set and different
   * from `expense.amount`, the override is shown as the primary amount and the
   * full expense amount is shown muted beneath it. Used by the budget modal to
   * surface each expense's contribution toward the budget.
   */
  contributionAmount?: number
  /** Optional internal return path when opened from another expense feed. */
  returnTo?: string
  /** Link to the global `/expenses` overlay instead of the group expense route. */
  expensesSearch?: LinkProps['search']
  /** Optional group label shown when the card is rendered across groups. */
  groupLabel?: string
}

export function ExpenseCard({
  expense,
  currency,
  groupId,
  participantCount,
  contributionAmount,
  returnTo,
  expensesSearch,
  groupLabel,
}: Props) {
  const showContribution =
    typeof contributionAmount === 'number' &&
    contributionAmount !== expense.amount
  const { t } = useTranslation(undefined, { keyPrefix: 'ExpenseCard' })
  const { t: tForm } = useTranslation(undefined, { keyPrefix: 'ExpenseForm' })
  const locale = useLocale()
  const accountPreferences = useSyncedAccountPreferences()
  const closed = formatExpenseClosed(
    expense as never,
    locale,
    accountPreferences?.timeZone ?? undefined,
    tForm('dateTimePicker.yourTime' as never),
  )
  const whenLabel = [closed.shortDate, closed.time, closed.tzHint]
    .filter(Boolean)
    .join(' · ')
  const originalCurrency =
    expense.originalCurrency && expense.originalCurrency !== currency.code
      ? getCurrency(expense.originalCurrency)
      : undefined
  const originalAmount = expense.originalAmount ?? undefined
  const showOriginalAmount =
    originalCurrency !== undefined && originalAmount !== undefined
  const seriesId = expense.recurringSeriesId
  const seriesStatus = expense.recurringSeriesStatus ?? undefined
  const overlayClassName =
    'absolute inset-0 z-0 rounded-[inherit] outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'

  return (
    <div
      key={expense.id}
      data-testid={`expense-item-${expense.id}`}
      className={cn(
        'motion-surface motion-surface-interactive relative flex items-stretch justify-between gap-1 px-4 py-4 text-sm hover:bg-accent sm:mx-6 sm:rounded-lg sm:ps-4 sm:pe-2',
        isSettlementCategory(expense.categoryId) && 'italic',
      )}
    >
      {expensesSearch ? (
        <Link
          to="/expenses"
          search={expensesSearch}
          className={overlayClassName}
          aria-label={expense.title}
        />
      ) : (
        <Link
          to="/groups/$groupId/expenses/$expenseId"
          params={{ groupId, expenseId: expense.id }}
          search={returnTo ? { returnTo } : undefined}
          className={overlayClassName}
          aria-label={expense.title}
        />
      )}
      <CategoryIcon
        category={expense.category}
        className="me-2 mt-0.5 h-4 w-4 text-muted-foreground"
      />
      <div className="min-w-0 flex-1">
        {groupLabel && (
          <div className="mb-1 text-[0.68rem] font-medium tracking-wide text-muted-foreground uppercase">
            {groupLabel}
          </div>
        )}
        <div
          className={cn(
            'mb-1 flex min-w-0 items-center gap-2',
            isSettlementCategory(expense.categoryId) && 'italic',
          )}
          data-testid="expense-title"
        >
          <span className="min-w-0 break-words">{expense.title}</span>
          {isSettlementCategory(expense.categoryId) && (
            <Badge variant="secondary" className="shrink-0 text-xs">
              {t('settlementBadge')}
            </Badge>
          )}
          {seriesId && (
            <RecurringBadge
              className="shrink-0 text-[0.68rem]"
              status={seriesStatus}
            />
          )}
        </div>
        {whenLabel ? (
          <div
            className="mb-1 text-xs text-muted-foreground"
            data-testid="expense-date"
            title={closed.tooltip}
          >
            {whenLabel}
          </div>
        ) : null}
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
      <div className="flex shrink-0 flex-col items-end">
        <div
          className={cn(
            'whitespace-nowrap tabular-nums',
            isSettlementCategory(expense.categoryId) ? 'italic' : 'font-bold',
          )}
          data-testid="expense-amount"
        >
          {showContribution
            ? formatCurrency(currency, contributionAmount, locale)
            : formatCurrency(currency, expense.amount, locale)}
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
        {showContribution && (
          <div
            className="text-xs whitespace-nowrap text-muted-foreground tabular-nums"
            data-testid="expense-amount-total"
          >
            {formatCurrency(currency, expense.amount, locale)}
          </div>
        )}
        <div className="text-xs text-muted-foreground">
          <DocumentsCount count={expense.documentCount} />
        </div>
      </div>
      <ChevronRight
        className="pointer-events-none hidden h-4 w-4 self-center sm:flex rtl:rotate-180"
        aria-hidden="true"
      />
    </div>
  )
}
