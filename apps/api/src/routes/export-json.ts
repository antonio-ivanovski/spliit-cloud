import { prisma } from '@spliit/db'
import { getCategoryById } from '@spliit/domain'
import contentDisposition from 'content-disposition'
import { getAuthFromRequest } from '../lib/auth/session'

/**
 * Resolve a LedgerParticipant's display name from its relations. Account-
 * backed participants always resolve to `Account.name`; the materialized
 * participant for a pending invitation resolves to that invitation's email.
 */
function resolveParticipantName(participant: {
  groupMember: { account: { name: string } } | null
  invitations: Array<{ email: string }>
}): string {
  return (
    participant.groupMember?.account.name ??
    participant.invitations[0]?.email ??
    ''
  )
}

export async function exportGroupJson(request: Request, groupId: string) {
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

  const expenses = await prisma.expense.findMany({
    select: {
      createdAt: true,
      expenseDate: true,
      title: true,
      categoryId: true,
      amount: true,
      originalAmount: true,
      originalCurrency: true,
      conversionRate: true,
      paidById: true,
      paidFor: { select: { ledgerParticipantId: true, shares: true } },
      isReimbursement: true,
      splitMode: true,
      recurrenceRule: true,
    },
    where: { ledgerId },
    orderBy: [{ expenseDate: 'asc' }, { createdAt: 'asc' }],
  })

  const participantIds = new Set([
    ...group.members.flatMap((m) =>
      m.ledgerParticipant ? [m.ledgerParticipant.id] : [],
    ),
    ...expenses.flatMap((expense) => [
      expense.paidById,
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
        select: { email: true },
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

  const expensesWithCategory = expenses.map((expense) => ({
    ...expense,
    category: getCategoryById(expense.categoryId as never) ?? null,
  }))

  const payload = {
    id: group.id,
    name: group.name,
    information: group.information,
    currency: group.ledger.currency,
    currencyCode: group.ledger.currencyCode,
    expenses: expensesWithCategory,
    participants: participants.map((participant) => ({
      id: participant.id,
      name: resolveParticipantName(participant),
    })),
  }

  const date = new Date().toISOString().split('T')[0]
  const filename = `Spliit Cloud Export - ${date}.json`
  return Response.json(payload, {
    headers: {
      'content-disposition': contentDisposition(filename),
    },
  })
}
