import { Parser } from '@json2csv/plainjs'
import { prisma } from '@spliit/db'
import {
  formatAmountAsDecimal,
  getCategoryById,
  getCurrency,
  getCurrencyFromGroup,
} from '@spliit/domain'
import { create as contentDisposition } from 'content-disposition'
import { getAuthFromRequest } from '../lib/auth/session'
import { resolveParticipantDisplayName } from '../lib/invitations'

const splitModeLabel = {
  EVENLY: 'Evenly',
  BY_SHARES: 'Unevenly - By shares',
  BY_PERCENTAGE: 'Unevenly - By percentage',
  BY_AMOUNT: 'Unevenly - By amount',
  ITEMIZED: 'Itemized',
} as const

function formatDate(dateValue: Date): string {
  const date = new Date(dateValue)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

async function ensureMemberOr404(request: Request, groupId: string) {
  const auth = await getAuthFromRequest(request)
  if (!auth) {
    return Response.json({ error: 'Unauthenticated' }, { status: 401 })
  }
  const member = await prisma.groupMember.findUnique({
    where: { groupId_accountId: { groupId, accountId: auth.user.id } },
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
      ledger: true,
      members: {
        where: { status: 'ACTIVE' },
        include: { ledgerParticipant: true },
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
    select: {
      expenseDate: true,
      title: true,
      categoryId: true,
      amount: true,
      originalAmount: true,
      originalCurrency: true,
      conversionRate: true,
      paidBySplitMode: true,
      paidByList: { select: { ledgerParticipantId: true, shares: true } },
      paidFor: { select: { ledgerParticipantId: true, shares: true } },
      isReimbursement: true,
      splitMode: true,
    },
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
    select: {
      id: true,
      groupMember: { select: { account: { select: { name: true } } } },
      invitations: {
        select: { email: true, temporaryName: true },
        take: 1,
        orderBy: { createdAt: 'desc' },
      },
    },
    orderBy: { groupMember: { account: { name: 'asc' } } },
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
    { label: 'Is Reimbursement', value: 'isReimbursement' },
    { label: 'Split mode', value: 'splitMode' },
    ...participants.map((participant) => ({
      label: resolveParticipantDisplayName(participant),
      value: participant.id,
    })),
  ]

  const rows = expenses.map((expense) => ({
    date: formatDate(expense.expenseDate),
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
    isReimbursement: expense.isReimbursement ? 'Yes' : 'No',
    splitMode: splitModeLabel[expense.splitMode],
    ...Object.fromEntries(
      participants.map((participant) => {
        const { totalShares, participantShare } = expense.paidFor.reduce(
          (acc, { ledgerParticipantId, shares }) => {
            acc.totalShares += shares
            if (ledgerParticipantId === participant.id) {
              acc.participantShare = shares
            }
            return acc
          },
          { totalShares: 0, participantShare: 0 },
        )

        const totalPaidByShares =
          expense.paidByList.reduce((s, pb) => s + pb.shares, 0) || 1
        const payerShare =
          expense.paidByList.find(
            (pb) => pb.ledgerParticipantId === participant.id,
          )?.shares ?? 0
        const payerAmount = (expense.amount * payerShare) / totalPaidByShares

        const participantAmountShare = +formatAmountAsDecimal(
          (expense.amount / totalShares) * participantShare,
          currency,
        )

        return [
          participant.id,
          +formatAmountAsDecimal(
            payerAmount - participantAmountShare,
            currency,
          ),
        ]
      }),
    ),
  }))

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
