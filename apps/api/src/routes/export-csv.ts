import { Parser } from '@json2csv/plainjs'
import { create as contentDisposition } from 'content-disposition'

import { prisma } from '@spliit/db'
import {
  calculatePaidByShares,
  calculateShares,
  formatAmountAsDecimal,
  getCategoryById,
  getCurrency,
  getCurrencyFromGroup,
  isSettlementCategory,
  utcToWallTime,
} from '@spliit/domain'

import { expenseCsvExportSelect } from '../lib/api/selects/expense-list'
import { participantDisplayNameSelect } from '../lib/api/selects/participant-display-name'
import { getAuthFromRequest } from '../lib/auth/session'
import { resolveParticipantDisplayName } from '../lib/invitations'

const splitModeLabel = {
  EVENLY: 'Evenly',
  BY_SHARES: 'Unevenly - By shares',
  BY_PERCENTAGE: 'Unevenly - By percentage',
  BY_AMOUNT: 'Unevenly - By amount',
  ITEMIZED: 'Itemized',
} as const

function formatDate(dateValue: Date, timeZone: string): string {
  return utcToWallTime(new Date(dateValue), timeZone).dateIso
}

async function ensureMemberOr404(request: Request, groupId: string) {
  const auth = await getAuthFromRequest(request)
  if (!auth) {
    return Response.json({ error: 'Unauthenticated' }, { status: 401 })
  }
  const member = await prisma.groupMember.findUnique({
    where: { groupId_accountId: { groupId, accountId: auth.user.id } },
    select: { status: true },
  })
  if (!member || member.status !== 'ACTIVE') {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }
  return null
}

export async function exportGroupCsv(request: Request, groupId: string) {
  const denial = await ensureMemberOr404(request, groupId)
  if (denial) return denial

  const group = await prisma.group.findUnique({
    where: { id: groupId },
    include: {
      ledger: { select: { currency: true, currencyCode: true } },
      members: {
        where: { status: 'ACTIVE' },
        select: { ledgerParticipant: { select: { id: true } } },
      },
    },
  })

  if (!group || !group.ledger || !group.ledgerId) {
    return Response.json({ error: 'Invalid group ID' }, { status: 404 })
  }
  const ledgerId = group.ledgerId

  const groupForCurrency = {
    currency: group.ledger.currency,
    currencyCode: group.ledger.currencyCode,
  }
  const currency = getCurrencyFromGroup(groupForCurrency)

  const expenses = await prisma.expense.findMany({
    select: expenseCsvExportSelect,
    where: { ledgerId },
    orderBy: [{ expenseDate: 'asc' }, { createdAt: 'asc' }],
  })

  const participantIds = new Set([
    ...group.members.flatMap((m) =>
      m.ledgerParticipant ? [m.ledgerParticipant.id] : [],
    ),
    ...expenses.flatMap((expense) => [
      ...expense.paidByList.map((pb) => pb.ledgerParticipantId),
      ...expense.paidFor.map((paidFor) => paidFor.ledgerParticipantId),
    ]),
  ])
  const participants = await prisma.ledgerParticipant.findMany({
    where: {
      ledgerId,
      id: { in: Array.from(participantIds) },
    },
    select: participantDisplayNameSelect(),
    orderBy: {
      groupMember: { account: { name: 'asc' } },
    },
  })
  const participantOrder = new Map(
    Array.from(participantIds).map((id, index) => [id, index]),
  )
  participants.sort(
    (a, b) => participantOrder.get(a.id)! - participantOrder.get(b.id)!,
  )
  const fields = [
    { label: 'Date', value: 'date' },
    { label: 'Description', value: 'title' },
    { label: 'Category', value: 'categoryName' },
    { label: 'Currency', value: 'currency' },
    { label: 'Cost', value: 'amount' },
    { label: 'Original cost', value: 'originalAmount' },
    { label: 'Original currency', value: 'originalCurrency' },
    { label: 'Conversion rate', value: 'conversionRate' },
    { label: 'Conversion source', value: 'conversionSource' },
    { label: 'Is Settlement', value: 'isSettlement' },
    { label: 'Split mode', value: 'splitMode' },
    ...participants.map((participant) => ({
      label: resolveParticipantDisplayName(participant),
      value: participant.id,
    })),
  ]

  const rows = expenses.map((expense) => {
    // Ledger-currency nets via unified share calculation.
    // Multi-payer generalization: net = paidByShare - paidForShare.
    const shareExpense = {
      id: expense.id,
      amount: expense.amount,
      splitMode: expense.splitMode,
      paidBySplitMode: expense.paidBySplitMode,
      categoryId: expense.categoryId,
      originalAmount: expense.originalAmount,
      originalCurrency: expense.originalCurrency,
      conversionRate:
        expense.conversionRate == null ? null : Number(expense.conversionRate),
      paidFor: expense.paidFor.map((pf) => ({
        shares: pf.shares,
        participant: { id: pf.ledgerParticipantId },
      })),
      paidByList: expense.paidByList.map((pb) => ({
        shares: pb.shares,
        participant: { id: pb.ledgerParticipantId },
      })),
    }
    const paidForShares = calculateShares(shareExpense)
    const paidByShares = calculatePaidByShares(shareExpense)

    return {
      date: formatDate(expense.expenseDate, expense.expenseTimeZone),
      title: expense.title,
      categoryName: getCategoryById(expense.categoryId as never)?.name ?? '',
      currency: group.ledger?.currencyCode ?? group.ledger?.currency ?? '',
      amount: formatAmountAsDecimal(expense.amount, currency),
      originalAmount: expense.originalAmount
        ? formatAmountAsDecimal(
            expense.originalAmount,
            expense.originalCurrency
              ? (getCurrency(expense.originalCurrency) ?? currency)
              : currency,
          )
        : null,
      originalCurrency: expense.originalCurrency,
      conversionRate: expense.conversionRate
        ? expense.conversionRate.toString()
        : null,
      conversionSource: expense.conversionSource,
      isSettlement: isSettlementCategory(expense.categoryId) ? 'Yes' : 'No',
      splitMode: splitModeLabel[expense.splitMode],
      ...Object.fromEntries(
        participants.map((participant) => {
          const netAmount =
            (paidByShares[participant.id] ?? 0) -
            (paidForShares[participant.id] ?? 0)
          return [participant.id, formatAmountAsDecimal(netAmount, currency)]
        }),
      ),
    }
  })

  const csv = new Parser({ fields }).parse(rows)
  const date = new Date().toISOString().split('T')[0]
  const filename = `Spliit Cloud Export - ${group.name} - ${date}.csv`

  return new Response(`\uFEFF${csv}`, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': contentDisposition(filename),
    },
  })
}
