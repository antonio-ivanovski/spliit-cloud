import { ActivityType, prisma, type Prisma } from '@spliit/db'
import { resolveParticipantDisplayName } from '../invitations'
import { randomId } from './shared'

export async function getActivities(
  groupId: string,
  options?: { offset?: number; length?: number },
) {
  const group = await prisma.group.findUnique({
    where: { id: groupId },
    select: { ledgerId: true },
  })
  if (!group?.ledgerId) return []

  const activities = await prisma.activity.findMany({
    where: { ledgerId: group.ledgerId },
    orderBy: [{ time: 'desc' }],
    skip: options?.offset,
    take: options?.length,
    include: {
      ledgerParticipant: {
        select: {
          groupMember: { select: { account: { select: { name: true } } } },
          invitations: {
            select: { email: true, temporaryName: true },
            take: 1,
            orderBy: { createdAt: 'desc' },
          },
        },
      },
    },
  })

  const expenseIds = activities
    .map((activity) => activity.expenseId)
    .filter((expenseId): expenseId is string => Boolean(expenseId))
  const expenses = await prisma.expense.findMany({
    where: { ledgerId: group.ledgerId, id: { in: expenseIds } },
  })

  return activities.map((activity) => {
    const lp = activity.ledgerParticipant
    const actorName = lp ? resolveParticipantDisplayName(lp) || null : null
    const { ledgerParticipant: _lp, ...rest } = activity
    return {
      ...rest,
      actorName,
      expense:
        activity.expenseId !== null
          ? expenses.find((expense) => expense.id === activity.expenseId)
          : undefined,
    }
  })
}

export async function logActivity(
  groupId: string,
  activityType: ActivityType,
  extra?: {
    accountId?: string
    ledgerParticipantId?: string | null
    expenseId?: string
    data?: string
  },
  client: Prisma.TransactionClient | typeof prisma = prisma,
) {
  const group = await client.group.findUnique({
    where: { id: groupId },
    select: { ledgerId: true },
  })
  if (!group?.ledgerId) {
    throw new Error('Cannot log activity for a group without a ledger')
  }
  return client.activity.create({
    data: {
      id: randomId(),
      ledgerId: group.ledgerId,
      activityType,
      ...extra,
    },
  })
}
