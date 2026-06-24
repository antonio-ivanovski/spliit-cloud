import { prisma } from '@spliit/db'
import contentDisposition from 'content-disposition'
import { getAuthFromRequest } from '../lib/auth/session'

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
      category: { select: { grouping: true, name: true } },
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

  const payload = {
    id: group.id,
    name: group.name,
    information: group.information,
    currency: group.ledger.currency,
    currencyCode: group.ledger.currencyCode,
    expenses,
    participants: group.members.flatMap((m) =>
      m.ledgerParticipant
        ? [{ id: m.ledgerParticipant.id, name: m.ledgerParticipant.name }]
        : [],
    ),
  }

  const date = new Date().toISOString().split('T')[0]
  const filename = `Spliit Cloud Export - ${date}.json`
  return Response.json(payload, {
    headers: {
      'content-disposition': contentDisposition(filename),
    },
  })
}
