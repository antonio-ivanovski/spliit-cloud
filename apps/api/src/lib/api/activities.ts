import { prisma, type Prisma } from '@spliit/db'
import {
  parseActivityData,
  type ActivityActorType,
  type ActivityData,
  type ActivitySubjectType,
  type ActivityType,
} from '@spliit/domain/activities'
import type { Activity } from '@spliit/db'
import { resolveParticipantDisplayName } from '../invitations'
import { randomId } from './shared'
export {
  buildExpenseActivityData,
  buildGroupActivityData,
  buildMemberActivityData,
  buildInvitationActivityData,
} from './activity-payloads'

type ActivityClient = Prisma.TransactionClient | typeof prisma

export type LogActivityArgs = {
  type: ActivityType
  actor?: { type: ActivityActorType; id: string }
  subject?: { type: ActivitySubjectType; id: string }
  data: ActivityData
}

/**
 * Persist a typed activity row against the given group's ledger. The
 * helper resolves the `ledgerId` internally so call sites only need to
 * pass the `groupId`. Returns the created row so callers can pass the
 * `id` to post-commit notification dispatch.
 */
export async function logActivity(
  groupId: string,
  args: LogActivityArgs,
  client: ActivityClient = prisma,
): Promise<Activity> {
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
      type: args.type,
      actorType: args.actor?.type ?? null,
      actorId: args.actor?.id ?? null,
      subjectType: args.subject?.type ?? null,
      subjectId: args.subject?.id ?? null,
      data: args.data,
    },
  })
}

export type ActivityListItem = Activity & {
  data: ActivityData | null
  actorName: string | null
  expense?: {
    id: string
    title: string
    amount: number
    expenseDate: Date
    categoryId: string
    splitMode: string
    paidBySplitMode: string
  } | null
}

/**
 * Read recent activities for a group's ledger.
 *
 * - Activities are ordered desc by time, offset/length as before.
 * - Expense metadata is fetched on demand for rows whose subject is an
 *   `EXPENSE` (the same-group lookup still works because we scope by
 *   the group's `ledgerId`).
 * - Actor display falls back through:
 *     1. ACCOUNT: `Account.name`
 *     2. LEDGER_PARTICIPANT: `GroupMember → Account` → `temporaryName` → `email`
 *     3. `data.expense.title` / `data.member.displayName` / `data.invitation.displayLabel`
 * - `data` is parsed through {@link parseActivityData} so the web layer
 *   can render directly from a known shape; legacy/null rows return
 *   `null` rather than throw.
 */
export async function getActivities(
  groupId: string,
  options?: { offset?: number; length?: number },
): Promise<ActivityListItem[]> {
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
  })

  const expenseSubjectIds = activities
    .filter(
      (activity) =>
        activity.subjectType === 'EXPENSE' && activity.subjectId !== null,
    )
    .map((activity) => activity.subjectId as string)
  const expenses = expenseSubjectIds.length
    ? await prisma.expense.findMany({
        where: { ledgerId: group.ledgerId, id: { in: expenseSubjectIds } },
        select: {
          id: true,
          title: true,
          amount: true,
          expenseDate: true,
          categoryId: true,
          splitMode: true,
          paidBySplitMode: true,
        },
      })
    : []

  // Resolve actor display per row. Pre-fetch the lookups needed for the
  // common cases (account name lookup by id, ledger participant lookup
  // by id) so we don't N+1 over the whole activity list.
  const accountActorIds = activities
    .filter(
      (a) => a.actorType === 'ACCOUNT' && a.actorId !== null,
    )
    .map((a) => a.actorId as string)
  const accountActors =
    accountActorIds.length === 0
      ? []
      : await prisma.account.findMany({
          where: { id: { in: accountActorIds } },
          select: { id: true, name: true },
        })
  const accountActorName = new Map(
    accountActors.map((a) => [a.id, a.name]),
  )

  const lpActorIds = activities
    .filter(
      (a) => a.actorType === 'LEDGER_PARTICIPANT' && a.actorId !== null,
    )
    .map((a) => a.actorId as string)
  const lpActors =
    lpActorIds.length === 0
      ? []
      : await prisma.ledgerParticipant.findMany({
          where: { id: { in: lpActorIds } },
          select: {
            id: true,
            displayName: true,
            groupMember: {
              select: {
                account: { select: { name: true } },
              },
            },
            invitations: {
              select: {
                email: true,
                temporaryName: true,
              },
              take: 1,
              orderBy: { createdAt: 'desc' },
            },
          },
        })
  const lpActorLabel = new Map(
    lpActors.map((lp) => [
      lp.id,
      // `resolveParticipantDisplayName` accepts the same shape used for
      // non-PENDING invitees — temporaryName > email > displayName. The
      // invitation lookup includes every status, so a deleted/revoked
      // invitee's last-known label is still resolved.
      resolveParticipantDisplayName({
        groupMember: lp.groupMember
          ? { account: lp.groupMember.account }
          : null,
        invitations: lp.invitations,
        displayName: lp.displayName,
      }),
    ]),
  )

  return activities.map((activity): ActivityListItem => {
    const data = parseActivityData(activity.data)
    const actorName = resolveActorName({
      activity,
      accountActorName,
      lpActorLabel,
      data,
    })
    const expense = expenseFromActor(activity, expenses)
    return {
      ...activity,
      data,
      actorName,
      expense,
    }
  })
}

function resolveActorName(args: {
  activity: Activity
  accountActorName: Map<string, string>
  lpActorLabel: Map<string, string>
  data: ActivityData | null
}): string | null {
  const { activity, accountActorName, lpActorLabel, data } = args
  if (activity.actorType === 'ACCOUNT' && activity.actorId) {
    const fromAccount = accountActorName.get(activity.actorId)
    if (fromAccount) return fromAccount
  }
  if (activity.actorType === 'LEDGER_PARTICIPANT' && activity.actorId) {
    const fromLp = lpActorLabel.get(activity.actorId)
    if (fromLp) return fromLp
  }
  // When the actor relation has been deleted but `data` carries display
  // metadata (the migration promise is "activities remain readable after
  // deletion"), fall back to that copy.
  // NB: expense/group summaries are subject metadata, not actor names.
  if (data) {
    if (data.kind === 'member') {
      return data.displayName ?? data.targetDisplayName ?? null
    }
    if (data.kind === 'invitation') {
      return data.displayLabel ?? null
    }
  }
  return null
}

function expenseFromActor(
  activity: Activity,
  expenses: Array<{
    id: string
    title: string
    amount: number
    expenseDate: Date
    categoryId: string
    splitMode: string
    paidBySplitMode: string
  }>,
): ActivityListItem['expense'] {
  if (activity.subjectType !== 'EXPENSE' || activity.subjectId === null) {
    return null
  }
  const found = expenses.find((e) => e.id === activity.subjectId) ?? null
  return found
}
