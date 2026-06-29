'use client'
import { Money } from '@/components/money'
import { getBalances, type BalanceExpense } from '@/lib/balances'
import { Currency } from '@/lib/currency'
import { useActiveUser } from '@/lib/hooks'
import { useTranslation } from 'react-i18next'

type GroupExpense = Awaited<
  ReturnType<typeof import('@/lib/api').getGroupExpenses>
>[number]

type Props = {
  groupId: string
  currency: Currency
  expense: GroupExpense
}

/**
 * Convert the new ledger-participant-based expense shape returned by
 * `getGroupExpenses` into the participant-like shape the domain balance
 * functions expect. Keeps the balance math untouched.
 */
function toBalanceExpense(expense: GroupExpense): BalanceExpense {
  return {
    ...expense,
    paidByList: expense.paidByList.map((pb) => ({
      shares: pb.shares,
      participant: pb.ledgerParticipant,
    })),
    paidBySplitMode: expense.paidBySplitMode,
    paidFor: expense.paidFor.map((pf) => ({
      shares: pf.shares,
      participant: pf.ledgerParticipant,
    })),
  }
}

export function ActiveUserBalance({ groupId, currency, expense }: Props) {
  const { t } = useTranslation(undefined, { keyPrefix: 'ExpenseCard' })
  const activeUserId = useActiveUser(groupId)
  if (activeUserId === null || activeUserId === '' || activeUserId === 'None') {
    return null
  }

  const balances = getBalances([toBalanceExpense(expense)])
  let fmtBalance = <>{t('notInvolved')}</>
  if (Object.hasOwn(balances, activeUserId)) {
    const balance = balances[activeUserId]
    let balanceDetail = <></>
    if (balance.paid > 0 && balance.paidFor > 0) {
      balanceDetail = (
        <>
          {' ('}
          <Money {...{ currency, amount: balance.paid }} />
          {' - '}
          <Money {...{ currency, amount: balance.paidFor }} />
          {')'}
        </>
      )
    }
    fmtBalance = (
      <>
        {t('yourBalance')}{' '}
        <Money {...{ currency, amount: balance.total }} bold colored />
        {balanceDetail}
      </>
    )
  }
  return <div className="text-xs text-muted-foreground">{fmtBalance}</div>
}
