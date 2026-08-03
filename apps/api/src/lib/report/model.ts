import type { ConversionSource, SplitMode } from '@spliit/domain'
import {
  calculatePaidByShares,
  calculateShares,
  getBalances,
  getPublicBalances,
  getSuggestedReimbursements,
} from '@spliit/domain'

import { endOfReportDay, formatIsoDate } from './dates'

/**
 * Database row shape fed to `buildExpenseReport`. Money is integer cents and
 * `BY_PERCENTAGE` shares are basis points; all financial math is delegated to
 * the domain package.
 */
export type ReportExpenseRow = {
  id: string
  amount: number
  expenseDate: Date
  createdAt: Date
  categoryId: string
  isReimbursement: boolean
  title: string
  splitMode: SplitMode
  paidBySplitMode: SplitMode
  originalAmount: number | null
  originalCurrency: string | null
  conversionRate: number | string | null
  conversionSource: ConversionSource | null
  paidByList: Array<{ ledgerParticipantId: string; shares: number }>
  paidFor: Array<{ ledgerParticipantId: string; shares: number }>
  items?: Array<{
    amount: number
    splitMode: SplitMode
    paidFor: Array<{ ledgerParticipantId: string; shares: number }>
  }>
  itemizedRemainder?: {
    splitMode: SplitMode
    paidFor: Array<{ ledgerParticipantId: string; shares: number }>
  } | null
}

export type ReportParticipant = {
  id: string
  name: string
  removed: boolean
}

export type ReportParticipantSummary = ReportParticipant & {
  /** Sum of calculated paid-by amounts for regular expenses in `from..to`. */
  periodPaid: number
  /** Sum of calculated paid-for amounts for regular expenses in `from..to`. */
  periodShare: number
  /** Public (post-settlement) balance as of end of `to`, in cents. */
  balanceAsOf: number
}

export type ReportCategoryTotal = {
  categoryId: string
  amount: number
}

export type ReportExpenseDetail = {
  id: string
  date: string
  title: string
  categoryId: string
  amount: number
  originalAmount: number | null
  originalCurrency: string | null
  conversionRate: number | string | null
  conversionSource: ConversionSource | null
  payers: Array<{ participantId: string; amount: number }>
  shares: Array<{ participantId: string; amount: number }>
}

export type ReportReimbursement = {
  date: string
  fromIds: string[]
  toIds: string[]
  amount: number
}

export type ExpenseReportModel = {
  groupName: string
  currencyCode: string
  currencySymbol: string
  currencyDecimalDigits: number
  from: string
  to: string
  period: {
    total: number
    expenseCount: number
    categories: ReportCategoryTotal[]
  }
  participants: ReportParticipantSummary[]
  settlements: Array<{ from: string; to: string; amount: number }>
  reimbursements: ReportReimbursement[]
  expenses: ReportExpenseDetail[]
}

type BalanceLike = Parameters<typeof getBalances>[0][number] & {
  isReimbursement: boolean
}

function compareByDateCreated(
  a: ReportExpenseRow,
  b: ReportExpenseRow,
): number {
  const dateDiff = a.expenseDate.getTime() - b.expenseDate.getTime()
  if (dateDiff !== 0) return dateDiff
  return a.createdAt.getTime() - b.createdAt.getTime()
}

function toBalanceLike(row: ReportExpenseRow): BalanceLike {
  return {
    id: row.id,
    amount: row.amount,
    splitMode: row.splitMode,
    paidBySplitMode: row.paidBySplitMode,
    isReimbursement: row.isReimbursement,
    originalAmount: row.originalAmount,
    originalCurrency: row.originalCurrency,
    conversionRate: row.conversionRate,
    conversionSource: row.conversionSource,
    paidByList: row.paidByList.map((share) => ({
      shares: share.shares,
      participant: { id: share.ledgerParticipantId },
    })),
    paidFor: row.paidFor.map((share) => ({
      shares: share.shares,
      participant: { id: share.ledgerParticipantId },
    })),
    items: row.items?.map((item) => ({
      amount: item.amount,
      splitMode: item.splitMode,
      paidFor: item.paidFor.map((share) => ({
        participant: share.ledgerParticipantId,
        shares: share.shares,
      })),
    })),
    itemizedRemainder: row.itemizedRemainder
      ? {
          splitMode: row.itemizedRemainder.splitMode,
          paidFor: row.itemizedRemainder.paidFor.map((share) => ({
            participant: share.ledgerParticipantId,
            shares: share.shares,
          })),
        }
      : null,
  }
}

export function buildExpenseReport(input: {
  groupName: string
  currencyCode: string
  currencySymbol: string
  currencyDecimalDigits: number
  /** Inclusive `from` (UTC midnight). */
  from: Date
  /** Inclusive `to` (UTC midnight). */
  to: Date
  /** All ledger entries dated on or before end of `to`, date-ordered. */
  rows: ReportExpenseRow[]
  participants: ReportParticipant[]
}): ExpenseReportModel {
  const { from, to } = input
  const toEnd = endOfReportDay(to)
  const inPeriod = (date: Date) =>
    date.getTime() >= from.getTime() && date.getTime() <= toEnd.getTime()

  const periodExpenses = input.rows
    .filter((row) => !row.isReimbursement && inPeriod(row.expenseDate))
    .sort(compareByDateCreated)
  const asOfExpenses = input.rows.filter(
    (row) => row.expenseDate.getTime() <= toEnd.getTime(),
  )

  const periodTotal = periodExpenses.reduce(
    (total, row) => total + row.amount,
    0,
  )
  const categoryMap = new Map<string, number>()
  for (const row of periodExpenses) {
    categoryMap.set(
      row.categoryId,
      (categoryMap.get(row.categoryId) ?? 0) + row.amount,
    )
  }
  const categories: ReportCategoryTotal[] = Array.from(
    categoryMap,
    ([categoryId, amount]) => ({
      categoryId,
      amount,
    }),
  ).sort((a, b) => b.amount - a.amount)

  const periodBalances = getBalances(periodExpenses.map(toBalanceLike))
  const balances = getBalances(asOfExpenses.map(toBalanceLike))
  const settlements = getSuggestedReimbursements(balances)
  const publicBalances = getPublicBalances(settlements)

  const participants: ReportParticipantSummary[] = input.participants.map(
    (participant) => {
      const period = periodBalances[participant.id] ?? { paid: 0, paidFor: 0 }
      return {
        ...participant,
        periodPaid: period.paid,
        periodShare: period.paidFor,
        balanceAsOf: publicBalances[participant.id]?.total ?? 0,
      }
    },
  )

  const reimbursements: ReportReimbursement[] = asOfExpenses
    .filter((row) => row.isReimbursement)
    .sort(compareByDateCreated)
    .map((row) => ({
      date: formatIsoDate(row.expenseDate),
      fromIds: row.paidByList.map((share) => share.ledgerParticipantId),
      toIds: row.paidFor.map((share) => share.ledgerParticipantId),
      amount: row.amount,
    }))

  const expenses: ReportExpenseDetail[] = periodExpenses.map((row) => {
    const balanceLike = toBalanceLike(row)
    const payerShares = calculatePaidByShares(balanceLike)
    const shareTotals = calculateShares(balanceLike)
    return {
      id: row.id,
      date: formatIsoDate(row.expenseDate),
      title: row.title,
      categoryId: row.categoryId,
      amount: row.amount,
      originalAmount: row.originalAmount,
      originalCurrency: row.originalCurrency,
      conversionRate: row.conversionRate,
      conversionSource: row.conversionSource,
      payers: row.paidByList
        .map((payer) => ({
          participantId: payer.ledgerParticipantId,
          amount: payerShares[payer.ledgerParticipantId] ?? 0,
        }))
        .sort((a, b) => b.amount - a.amount),
      shares: row.paidFor
        .map((participant) => ({
          participantId: participant.ledgerParticipantId,
          amount: shareTotals[participant.ledgerParticipantId] ?? 0,
        }))
        .sort((a, b) => b.amount - a.amount),
    }
  })

  return {
    groupName: input.groupName,
    currencyCode: input.currencyCode,
    currencySymbol: input.currencySymbol,
    currencyDecimalDigits: input.currencyDecimalDigits,
    from: formatIsoDate(from),
    to: formatIsoDate(to),
    period: {
      total: periodTotal,
      expenseCount: periodExpenses.length,
      categories,
    },
    participants,
    settlements,
    reimbursements,
    expenses,
  }
}
