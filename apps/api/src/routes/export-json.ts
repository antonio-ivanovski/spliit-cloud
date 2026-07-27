import { prisma } from '@spliit/db'
import { getCategoryById } from '@spliit/domain'
import { create as contentDisposition } from 'content-disposition'
import { expenseJsonExportSelect } from '../lib/api/selects/expense-list'
import { participantDisplayNameSelect } from '../lib/api/selects/participant-display-name'
import { getAuthFromRequest } from '../lib/auth/session'
import { resolveParticipantDisplayName } from '../lib/invitations'

export async function exportGroupJson(request: Request, groupId: string) {
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

  const expenses = await prisma.expense.findMany({
    select: expenseJsonExportSelect,
    where: { ledgerId },
    orderBy: [{ expenseDate: 'asc' }, { createdAt: 'asc' }],
  })

  const participantIds = new Set([
    ...group.members.flatMap((m) =>
      m.ledgerParticipant ? [m.ledgerParticipant.id] : [],
    ),
    ...expenses.flatMap((expense) => [
      ...expense.paidByList.map((pb) => pb.ledgerParticipant.id),
      ...expense.paidFor.map((paidFor) => paidFor.ledgerParticipantId),
      ...(expense.items ?? []).flatMap((item) =>
        item.paidFor.map((paidFor) => paidFor.ledgerParticipantId),
      ),
      ...(expense.itemizedRemainder?.paidFor.map(
        (paidFor) => paidFor.ledgerParticipantId,
      ) ?? []),
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

  const expensesWithCategory = expenses.map((expense) => {
    const { recurringSeries, ...legacyExpense } = expense
    const recurrenceRule =
      recurringSeries?.interval === 1 &&
      recurringSeries.endType === 'INDEFINITE' &&
      recurringSeries.frequency !== 'YEARLY'
        ? recurringSeries.frequency
        : 'NONE'
    return {
      ...legacyExpense,
      paidByList: expense.paidByList.map((pb) => ({
        ledgerParticipantId: pb.ledgerParticipant.id,
        shares: pb.shares,
      })),
      // Keep the original spliit.app wire shape. Schedules that legacy could
      // not represent are exported as NONE rather than silently changing them.
      recurrenceRule,
      paidById: expense.paidByList[0]?.ledgerParticipant.id ?? '',
      category: getCategoryById(expense.categoryId as never) ?? null,
    }
  })

  const payload = {
    id: group.id,
    name: group.name,
    information: group.information,
    currency: group.ledger.currency,
    currencyCode: group.ledger.currencyCode,
    expenses: expensesWithCategory,
    participants: participants.map((participant) => ({
      id: participant.id,
      name: resolveParticipantDisplayName(participant),
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
