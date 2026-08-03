import type { Prisma } from '@spliit/db'
import { prisma } from '@spliit/db'
import { getCurrency } from '@spliit/domain'

import { balanceExpenseSelect } from '../api/selects/balance-expense'
import { participantDisplayNameSelect } from '../api/selects/participant-display-name'
import { resolveParticipantDisplayName } from '../invitations/display'
import { endOfReportDay, formatIsoDate } from './dates'
import type { ReportExpenseRow, ReportParticipant } from './model'

export const reportExpenseSelect = {
  ...balanceExpenseSelect,
  title: true,
  expenseDate: true,
  createdAt: true,
  categoryId: true,
  isReimbursement: true,
} satisfies Prisma.ExpenseSelect

export type ReportExpenseRowRow = Prisma.ExpenseGetPayload<{
  select: typeof reportExpenseSelect
}>

export type ReportGroupLedger = {
  groupName: string
  currencyCode: string
  currencySymbol: string
  currencyDecimalDigits: number
  ledgerId: string
}

export type ExpenseReportData = {
  group: ReportGroupLedger
  from: string
  to: string
  rows: ReportExpenseRow[]
  participants: ReportParticipant[]
}

function mapReportRow(row: ReportExpenseRowRow): ReportExpenseRow {
  return {
    id: row.id,
    amount: row.amount,
    expenseDate: row.expenseDate,
    createdAt: row.createdAt,
    categoryId: row.categoryId,
    isReimbursement: row.isReimbursement,
    title: row.title,
    splitMode: row.splitMode,
    paidBySplitMode: row.paidBySplitMode,
    originalAmount: row.originalAmount,
    originalCurrency: row.originalCurrency,
    conversionRate: row.conversionRate,
    conversionSource: row.conversionSource,
    paidByList: row.paidByList.map((share) => ({
      ledgerParticipantId: share.ledgerParticipantId,
      shares: share.shares,
    })),
    paidFor: row.paidFor.map((share) => ({
      ledgerParticipantId: share.ledgerParticipantId,
      shares: share.shares,
    })),
    items: row.items.map((item) => ({
      amount: item.amount,
      splitMode: item.splitMode,
      paidFor: item.paidFor.map((share) => ({
        ledgerParticipantId: share.ledgerParticipantId,
        shares: share.shares,
      })),
    })),
    itemizedRemainder: row.itemizedRemainder
      ? {
          splitMode: row.itemizedRemainder.splitMode,
          paidFor: row.itemizedRemainder.paidFor.map((share) => ({
            ledgerParticipantId: share.ledgerParticipantId,
            shares: share.shares,
          })),
        }
      : null,
  }
}

/**
 * Load a group's ledger through end of `to` plus the participants that need to
 * appear on the report (active member participants and every participant
 * referenced by the loaded rows, including soft-removed ones).
 */
export async function loadExpenseReportData(options: {
  groupId: string
  /** Inclusive `from` (UTC midnight). */
  from: Date
  /** Inclusive `to` (UTC midnight). */
  to: Date
}): Promise<ExpenseReportData | null> {
  const { groupId, from, to } = options
  const group = await prisma.group.findUnique({
    where: { id: groupId },
    include: {
      ledger: {
        select: { id: true, currency: true, currencyCode: true },
      },
      members: {
        where: { status: 'ACTIVE' },
        select: { ledgerParticipant: { select: { id: true } } },
      },
    },
  })

  if (!group || !group.ledger || !group.ledgerId) return null

  const currency = getCurrency(
    group.ledger.currencyCode ?? group.ledger.currency,
  )
  const ledger = {
    id: group.ledgerId,
    currencyCode: group.ledger.currencyCode ?? group.ledger.currency,
    symbol: currency?.symbol ?? '',
    decimalDigits: currency?.decimal_digits ?? 2,
  }

  const rows = await prisma.expense.findMany({
    select: reportExpenseSelect,
    where: {
      ledgerId: group.ledgerId,
      expenseDate: { lte: endOfReportDay(to) },
    },
    orderBy: [{ expenseDate: 'asc' }, { createdAt: 'asc' }],
  })

  const memberParticipantIds = group.members.flatMap((member) =>
    member.ledgerParticipant ? [member.ledgerParticipant.id] : [],
  )
  const referencedIds = new Set<string>([
    ...memberParticipantIds,
    ...rows.flatMap((row) => [
      ...row.paidByList.map((share) => share.ledgerParticipantId),
      ...row.paidFor.map((share) => share.ledgerParticipantId),
      ...row.items.flatMap((item) =>
        item.paidFor.map((share) => share.ledgerParticipantId),
      ),
      ...(row.itemizedRemainder?.paidFor.map(
        (share) => share.ledgerParticipantId,
      ) ?? []),
    ]),
  ])
  const participantRows =
    referencedIds.size === 0
      ? []
      : await prisma.ledgerParticipant.findMany({
          where: { id: { in: Array.from(referencedIds) } },
          select: participantDisplayNameSelect(),
        })

  const participants: ReportParticipant[] = participantRows.map(
    (participant) => ({
      id: participant.id,
      name: resolveParticipantDisplayName(participant),
      removed: participant.removedAt != null,
    }),
  )

  return {
    group: {
      groupName: group.name,
      currencyCode: ledger.currencyCode,
      currencySymbol: ledger.symbol,
      currencyDecimalDigits: ledger.decimalDigits,
      ledgerId: group.ledgerId,
    },
    from: formatIsoDate(from),
    to: formatIsoDate(to),
    rows: rows.map(mapReportRow),
    participants,
  }
}
