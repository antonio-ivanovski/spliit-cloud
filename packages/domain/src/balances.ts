import { match } from 'ts-pattern'
import type { SplitMode } from './enums'

type ParticipantLike = { id: string; name?: string }

type PayerShare = {
  shares: number
  participant: ParticipantLike
}

export type BalanceExpense = {
  id?: string
  amount: number
  splitMode: SplitMode
  paidBySplitMode: SplitMode
  paidByList: PayerShare[]
  paidFor: PayerShare[]
  originalAmount?: number | null
  originalCurrency?: string | null
  conversionRate?: number | string | null
  [key: string]: unknown
}

export type Balances = Record<
  string,
  { paid: number; paidFor: number; total: number }
>

export type Reimbursement = {
  from: string
  to: string
  amount: number
}

function isOriginalCurrency(expense: BalanceExpense): boolean {
  return Boolean(expense.originalCurrency && expense.conversionRate)
}

export function getBalances(expenses: BalanceExpense[]): Balances {
  const balances: Balances = {}

  for (const expense of expenses) {
    const paidBys = expense.paidByList
    const paidFors = expense.paidFor
    const useOriginal = isOriginalCurrency(expense)
    // When the expense was paid in a foreign currency, paidByList.shares
    // are in original currency, summing to originalAmount. Dividing by
    // expense.amount (ledger cents) would mix currencies, so we divide
    // against originalAmount and convert to ledger at the end.
    const payerBase = useOriginal
      ? (expense.originalAmount ?? expense.amount)
      : expense.amount
    const conversionRate = useOriginal ? Number(expense.conversionRate) : 1

    const totalPaidByShares = paidBys.reduce(
      (sum, paidBy) => sum + paidBy.shares,
      0,
    )
    let remaining = payerBase
    paidBys.forEach((paidBy, index) => {
      const paidById = paidBy.participant.id
      if (!balances[paidById])
        balances[paidById] = { paid: 0, paidFor: 0, total: 0 }

      const isLast = index === paidBys.length - 1

      const [shares, totalShares] = match(expense.paidBySplitMode)
        .with('EVENLY', () => [1, paidBys.length] as const)
        .with('BY_SHARES', () => [paidBy.shares, totalPaidByShares] as const)
        .with(
          'BY_PERCENTAGE',
          () => [paidBy.shares, totalPaidByShares] as const,
        )
        .with('BY_AMOUNT', () => [paidBy.shares, totalPaidByShares] as const)
        .exhaustive()

      const dividedAmount = isLast
        ? remaining
        : (payerBase * shares) / totalShares
      remaining -= dividedAmount
      const ledgerCurrencyPaid = useOriginal
        ? Math.round(dividedAmount * conversionRate)
        : dividedAmount
      balances[paidById].paid += ledgerCurrencyPaid
    })

    const totalPaidForShares = paidFors.reduce(
      (sum, paidFor) => sum + paidFor.shares,
      0,
    )
    remaining = expense.amount
    paidFors.forEach((paidFor, index) => {
      if (!balances[paidFor.participant.id])
        balances[paidFor.participant.id] = { paid: 0, paidFor: 0, total: 0 }

      const isLast = index === paidFors.length - 1

      const [shares, totalShares] = match(expense.splitMode)
        .with('EVENLY', () => [1, paidFors.length] as const)
        .with('BY_SHARES', () => [paidFor.shares, totalPaidForShares] as const)
        .with(
          'BY_PERCENTAGE',
          () => [paidFor.shares, totalPaidForShares] as const,
        )
        .with('BY_AMOUNT', () => [paidFor.shares, totalPaidForShares] as const)
        .exhaustive()

      const dividedAmount = isLast
        ? remaining
        : (expense.amount * shares) / totalShares
      remaining -= dividedAmount
      balances[paidFor.participant.id].paidFor += dividedAmount
    })
  }

  // rounding and add total
  for (const participantId in balances) {
    // add +0 to avoid negative zeros
    balances[participantId].paidFor =
      Math.round(balances[participantId].paidFor) + 0
    balances[participantId].paid = Math.round(balances[participantId].paid) + 0

    balances[participantId].total =
      balances[participantId].paid - balances[participantId].paidFor
  }
  return balances
}

export function getPublicBalances(reimbursements: Reimbursement[]): Balances {
  const balances: Balances = {}
  reimbursements.forEach((reimbursement) => {
    if (!balances[reimbursement.from])
      balances[reimbursement.from] = { paid: 0, paidFor: 0, total: 0 }

    if (!balances[reimbursement.to])
      balances[reimbursement.to] = { paid: 0, paidFor: 0, total: 0 }

    balances[reimbursement.from].paidFor += reimbursement.amount
    balances[reimbursement.from].total -= reimbursement.amount

    balances[reimbursement.to].paid += reimbursement.amount
    balances[reimbursement.to].total += reimbursement.amount
  })
  return balances
}

/**
 * A comparator that is stable across reimbursements.
 * This ensures that a participant executing a suggested reimbursement
 * does not result in completely new repayment suggestions.
 */
function compareBalancesForReimbursements(b1: any, b2: any): number {
  // positive balances come before negative balances
  if (b1.total > 0 && 0 > b2.total) {
    return -1
  } else if (b2.total > 0 && 0 > b1.total) {
    return 1
  }
  // if signs match, sort based on userid
  return b1.participantId < b2.participantId ? -1 : 1
}

export function getSuggestedReimbursements(
  balances: Balances,
): Reimbursement[] {
  const balancesArray = Object.entries(balances)
    .map(([participantId, { total }]) => ({ participantId, total }))
    .filter((b) => b.total !== 0)
  balancesArray.sort(compareBalancesForReimbursements)
  const reimbursements: Reimbursement[] = []
  while (balancesArray.length > 1) {
    const first = balancesArray[0]
    const last = balancesArray[balancesArray.length - 1]
    const amount = first.total + last.total
    if (first.total > -last.total) {
      reimbursements.push({
        from: last.participantId,
        to: first.participantId,
        amount: -last.total,
      })
      first.total = amount
      balancesArray.pop()
    } else {
      reimbursements.push({
        from: last.participantId,
        to: first.participantId,
        amount: first.total,
      })
      last.total = amount
      balancesArray.shift()
    }
  }
  return reimbursements.filter(({ amount }) => Math.round(amount) + 0 !== 0)
}
