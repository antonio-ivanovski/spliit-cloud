import { prisma } from '@spliit/db'
import { parseActivityData } from '@spliit/domain/activities'
import {
  NotificationCategoryFamily,
  getNotificationCategoryForActivity,
  notificationCategoryFamily,
  type NotificationCategory,
} from '@spliit/domain/notifications'
import { getAffectedParticipantIds } from '../api/expense-activity-diff'
import type {
  ActivityNotificationEvent,
  ActivityNotificationIntent,
} from './types'

type Recipient = { id: string }

export interface ActivityHandler {
  supports(type: ActivityNotificationEvent['type']): boolean
  buildIntents(
    event: ActivityNotificationEvent,
  ): Promise<Array<Omit<ActivityNotificationIntent, 'channels'>>>
}

function eventCategory(
  event: ActivityNotificationEvent,
): NotificationCategory | undefined {
  return (
    event.notificationCategory ?? getNotificationCategoryForActivity(event.type)
  )
}

function dedupeRecipients(
  event: ActivityNotificationEvent,
  recipients: Recipient[],
  category: NotificationCategory,
): Array<Omit<ActivityNotificationIntent, 'channels'>> {
  const seen = new Set<string>()
  return recipients.flatMap((recipient) => {
    if (!recipient.id || seen.has(recipient.id)) return []
    seen.add(recipient.id)
    if (
      event.actor?.type === 'ACCOUNT' &&
      event.actor.id === recipient.id &&
      !event.includeActorAsRecipient
    )
      return []
    return [{ activity: event, category, recipientAccountId: recipient.id }]
  })
}

async function activeActorAccount(
  event: ActivityNotificationEvent,
): Promise<Recipient[]> {
  if (!event.includeActorAsRecipient || event.actor?.type !== 'ACCOUNT') {
    return []
  }
  const member = await prisma.groupMember.findFirst({
    where: {
      groupId: event.groupId,
      accountId: event.actor.id,
      status: 'ACTIVE',
    },
    select: { accountId: true },
  })
  return member ? [{ id: member.accountId }] : []
}

async function activeGroupAccounts(groupId: string): Promise<Recipient[]> {
  const members = await prisma.groupMember.findMany({
    where: { groupId, status: 'ACTIVE' },
    select: { accountId: true },
  })
  return members.map((member) => ({ id: member.accountId }))
}

async function invitationRecipient(
  event: ActivityNotificationEvent,
): Promise<Recipient[]> {
  if (!event.subject?.id) return []
  const invitation = await prisma.groupInvitation.findUnique({
    where: { id: event.subject.id },
    select: { email: true },
  })
  if (!invitation?.email) return []
  const account = await prisma.account.findFirst({
    where: { email: { equals: invitation.email, mode: 'insensitive' } },
    select: { id: true },
  })
  return account ? [{ id: account.id }] : []
}

async function expenseParticipantAccounts(
  event: ActivityNotificationEvent,
): Promise<Recipient[]> {
  const parsed = parseActivityData(event.data)
  if (!parsed) return []
  let participantIds: string[] = []
  if (
    (event.type === 'EXPENSE_CREATED' ||
      event.type === 'RECURRING_EXPENSE_CREATED') &&
    parsed.kind !== 'recurring_expense_summary'
  ) {
    if (!event.subject?.id) return []
    const raw = await prisma.expense.findUnique({
      where: { id: event.subject.id },
      select: {
        paidByList: { select: { ledgerParticipantId: true, shares: true } },
        paidFor: { select: { ledgerParticipantId: true, shares: true } },
        items: {
          select: {
            id: true,
            paidFor: { select: { ledgerParticipantId: true, shares: true } },
          },
        },
        itemizedRemainder: {
          select: {
            splitMode: true,
            paidFor: { select: { ledgerParticipantId: true, shares: true } },
          },
        },
      },
    })
    if (!raw) return []
    participantIds = [
      ...getAffectedParticipantIds({
        newExpense: {
          paidByList: raw.paidByList.map((row) => ({
            participant: row.ledgerParticipantId,
            shares: row.shares,
          })),
          paidFor: raw.paidFor.map((row) => ({
            participant: row.ledgerParticipantId,
            shares: row.shares,
          })),
          items: raw.items.map((item) => ({
            id: item.id,
            paidFor: item.paidFor.map((row) => ({
              participant: row.ledgerParticipantId,
              shares: row.shares,
            })),
          })),
          itemizedRemainder: raw.itemizedRemainder
            ? {
                splitMode: raw.itemizedRemainder.splitMode,
                paidFor: raw.itemizedRemainder.paidFor.map((row) => ({
                  participant: row.ledgerParticipantId,
                  shares: row.shares,
                })),
              }
            : undefined,
        } as never,
      }),
    ]
  } else if ('affectedParticipants' in parsed) {
    participantIds = parsed.affectedParticipants ?? []
  }
  if (participantIds.length === 0) {
    // Bulk category updates carry many expense ids rather than participant
    // rows. The safe recipient scope is the active group membership.
    if (event.type === 'EXPENSE_CATEGORIES_BULK_UPDATED')
      return activeGroupAccounts(event.groupId)
    return []
  }
  const participants = await prisma.ledgerParticipant.findMany({
    where: { id: { in: [...new Set(participantIds)] } },
    select: {
      groupMember: { select: { accountId: true, status: true } },
    },
  })
  return participants.flatMap((participant) =>
    participant.groupMember?.status === 'ACTIVE'
      ? [{ id: participant.groupMember.accountId }]
      : [],
  )
}

export class ExpenseActivityHandler implements ActivityHandler {
  supports(type: ActivityNotificationEvent['type']): boolean {
    const category = getNotificationCategoryForActivity(type)
    return (
      !!category &&
      notificationCategoryFamily[category] ===
        NotificationCategoryFamily.EXPENSE
    )
  }

  async buildIntents(event: ActivityNotificationEvent) {
    const category = eventCategory(event)
    if (!category) return []
    // Catch-up summaries intentionally have no expense subject: affected
    // participants receive one coalesced summary while each occurrence
    // activity remains available in the feed.
    const parsed = parseActivityData(event.data)
    const [participants, actor] = await Promise.all([
      expenseParticipantAccounts(event),
      activeActorAccount(event),
    ])
    const recipients =
      event.type === 'RECURRING_EXPENSE_CREATED' &&
      parsed?.kind === 'recurring_expense_summary' &&
      participants.length === 0
        ? [...(await activeGroupAccounts(event.groupId)), ...actor]
        : [...participants, ...actor]
    return dedupeRecipients(event, recipients, category)
  }
}

export class GroupActivityHandler implements ActivityHandler {
  supports(type: ActivityNotificationEvent['type']): boolean {
    const category = getNotificationCategoryForActivity(type)
    return (
      !!category &&
      notificationCategoryFamily[category] === NotificationCategoryFamily.GROUP
    )
  }

  async buildIntents(event: ActivityNotificationEvent) {
    const category = eventCategory(event)
    if (!category) return []
    const recipients = event.recipientAccountId
      ? [{ id: event.recipientAccountId }]
      : event.type === 'INVITATION_CREATED'
        ? await invitationRecipient(event)
        : []
    return dedupeRecipients(event, recipients, category)
  }
}

export function defaultActivityHandlers(): ActivityHandler[] {
  return [new ExpenseActivityHandler(), new GroupActivityHandler()]
}
