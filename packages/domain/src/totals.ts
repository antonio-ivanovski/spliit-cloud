import type { SplitMode } from './enums'

export type TotalsExpense = {
  id?: string
  amount: number
  splitMode: SplitMode
  paidBySplitMode: SplitMode
  isReimbursement: boolean
  paidByList: Array<{
    shares: number
    participant: { id: string; name?: string }
  }>
  paidFor: Array<{
    shares: number
    participant: { id: string; name?: string }
  }>
  originalAmount?: number | null
  originalCurrency?: string | null
  conversionRate?: number | string | null
  [key: string]: unknown
}

export function getTotalGroupSpending(expenses: TotalsExpense[]): number {
  return expenses.reduce(
    (total, expense) =>
      expense.isReimbursement ? total : total + expense.amount,
    0,
  )
}

export function getTotalActiveUserPaidFor(
  activeUserId: string | null,
  expenses: TotalsExpense[],
): number {
  return expenses.reduce((total, expense) => {
    if (expense.isReimbursement) return total
    for (const paidBy of expense.paidByList) {
      if (paidBy.participant.id === activeUserId) {
        return total + calculatePaidByShare(activeUserId, expense)
      }
    }
    return total
  }, 0)
}

export function calculatePaidByShare(
  participantId: string | null,
  expense: Pick<
    TotalsExpense,
    | 'amount'
    | 'paidByList'
    | 'paidBySplitMode'
    | 'isReimbursement'
    | 'originalAmount'
    | 'originalCurrency'
    | 'conversionRate'
  >,
): number {
  if (expense.isReimbursement) return 0

  const paidBys = expense.paidByList
  const userPaidBy = paidBys.find(
    (paidBy) => paidBy.participant.id === participantId,
  )

  if (!userPaidBy) return 0

  // When the expense was paid in a foreign currency, shares are in
  // original currency and must be converted to ledger currency to
  // match getBalances()'s unit on balances.paid.
  const useOriginal = Boolean(
    expense.originalCurrency && expense.conversionRate,
  )
  const conversionRate = useOriginal ? Number(expense.conversionRate) : 1
  const base = useOriginal
    ? (expense.originalAmount ?? expense.amount)
    : expense.amount
  const shares = Number(userPaidBy.shares)

  let dividedAmount: number
  switch (expense.paidBySplitMode) {
    case 'EVENLY':
      dividedAmount = base / paidBys.length
      break
    case 'BY_AMOUNT':
      dividedAmount = shares
      break
    case 'BY_PERCENTAGE':
      dividedAmount = (base * shares) / 10000
      break
    case 'BY_SHARES':
      const totalShares = paidBys.reduce(
        (sum, paidBy) => sum + Number(paidBy.shares),
        0,
      )
      dividedAmount = (base * shares) / totalShares
      break
    default:
      return 0
  }

  return useOriginal
    ? Math.round(dividedAmount * conversionRate)
    : dividedAmount
}

export function calculateShare(
  participantId: string | null,
  expense: Pick<
    TotalsExpense,
    'amount' | 'paidFor' | 'splitMode' | 'isReimbursement'
  >,
): number {
  if (expense.isReimbursement) return 0

  const paidFors = expense.paidFor
  const userPaidFor = paidFors.find(
    (paidFor) => paidFor.participant.id === participantId,
  )

  if (!userPaidFor) return 0

  const shares = Number(userPaidFor.shares)

  switch (expense.splitMode) {
    case 'EVENLY':
      // Divide the total expense evenly among all participants
      return expense.amount / paidFors.length
    case 'BY_AMOUNT':
      // Directly add the user's share if the split mode is BY_AMOUNT
      return shares
    case 'BY_PERCENTAGE':
      // Calculate the user's share based on their percentage of the total expense
      return (expense.amount * shares) / 10000 // Assuming shares are out of 10000 for percentage
    case 'BY_SHARES':
      // Calculate the user's share based on their shares relative to the total shares
      const totalShares = paidFors.reduce(
        (sum, paidFor) => sum + Number(paidFor.shares),
        0,
      )
      return (expense.amount * shares) / totalShares
    default:
      return 0
  }
}

export function getTotalActiveUserShare(
  activeUserId: string | null,
  expenses: TotalsExpense[],
): number {
  const total = expenses.reduce(
    (sum, expense) => sum + calculateShare(activeUserId, expense),
    0,
  )

  return parseFloat(total.toFixed(2))
}
