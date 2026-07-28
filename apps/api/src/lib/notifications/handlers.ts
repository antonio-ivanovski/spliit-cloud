import { prisma, type Prisma } from '@spliit/db'
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
type HandlerClient = Prisma.TransactionClient | typeof prisma

function isExpenseCommentEvent(event: ActivityNotificationEvent): boolean {
  return event.type === 'EXPENSE_COMMENTED'
}

export interface ActivityHandler {
  supports(type: ActivityNotificationEvent['type']): boolean
  buildIntents(
    event: ActivityNotificationEvent,
    client?: Prisma.TransactionClient,
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
  client: HandlerClient,
): Promise<Recipient[]> {
  if (!event.includeActorAsRecipient || event.actor?.type !== 'ACCOUNT') {
    return []
  }
  const member = await client.groupMember.findFirst({
    where: {
      groupId: event.groupId,
      accountId: event.actor.id,
      status: 'ACTIVE',
    },
    select: { accountId: true },
  })
  return member ? [{ id: member.accountId }] : []
}

async function activeGroupAccounts(
  groupId: string,
  client: HandlerClient,
): Promise<Recipient[]> {
  const members = await client.groupMember.findMany({
    where: { groupId, status: 'ACTIVE' },
    select: { accountId: true },
  })
  return members.map((member) => ({ id: member.accountId }))
}

async function invitationRecipient(
  event: ActivityNotificationEvent,
  client: HandlerClient,
): Promise<Recipient[]> {
  if (!event.subject?.id) return []
  const invitation = await client.groupInvitation.findUnique({
    where: { id: event.subject.id },
    select: { email: true },
  })
  if (!invitation?.email) return []
  const account = await client.account.findFirst({
    where: { email: { equals: invitation.email, mode: 'insensitive' } },
    select: { id: true },
  })
  return account ? [{ id: account.id }] : []
}

async function expenseParticipantAccounts(
  event: ActivityNotificationEvent,
  client: HandlerClient,
): Promise<Recipient[]> {
  if (isExpenseCommentEvent(event)) {
    const expenseId = event.subject?.id
    if (!expenseId) return []

    // A comment should reach the active accounts represented on the expense,
    // plus active accounts that have commented previously. Resolve both
    // scopes independently, then let the common deduper suppress duplicates
    // and the actor policy remove the author of the current comment.
    const [raw, previousComments] = await Promise.all([
      client.expense.findUnique({
        where: { id: expenseId },
        select: {
          paidByList: { select: { ledgerParticipantId: true, shares: true } },
          paidFor: { select: { ledgerParticipantId: true, shares: true } },
          items: {
            select: {
              id: true,
              paidFor: {
                select: { ledgerParticipantId: true, shares: true },
              },
            },
          },
          itemizedRemainder: {
            select: {
              splitMode: true,
              paidFor: {
                select: { ledgerParticipantId: true, shares: true },
              },
            },
          },
        },
      }),
      client.expenseComment.findMany({
        where: { expenseId, authorAccountId: { not: null } },
        select: { authorAccountId: true },
      }),
    ])

    const participantIds: string[] = raw
      ? [
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
      : []
    const participantRecipients =
      participantIds.length > 0
        ? await client.ledgerParticipant.findMany({
            where: { id: { in: [...new Set(participantIds)] } },
            select: {
              groupMember: { select: { accountId: true, status: true } },
            },
          })
        : []
    const activeParticipants = participantRecipients.flatMap((participant) =>
      participant.groupMember?.status === 'ACTIVE'
        ? [{ id: participant.groupMember.accountId }]
        : [],
    )

    const authorIds = [
      ...new Set(
        previousComments
          .map((comment) => comment.authorAccountId)
          .filter((id): id is string => !!id),
      ),
    ]
    if (authorIds.length === 0) return activeParticipants
    const activeAuthors = await client.groupMember.findMany({
      where: {
        groupId: event.groupId,
        status: 'ACTIVE',
        accountId: { in: authorIds },
      },
      select: { accountId: true },
    })
    return [
      ...activeParticipants,
      ...activeAuthors.map((member) => ({ id: member.accountId })),
    ]
  }
  const parsed = parseActivityData(event.data)
  if (!parsed) return []
  let participantIds: string[] = []
  if (
    (event.type === 'EXPENSE_CREATED' ||
      event.type === 'RECURRING_EXPENSE_CREATED') &&
    parsed.kind !== 'recurring_expense_summary'
  ) {
    if (!event.subject?.id) return []
    const raw = await client.expense.findUnique({
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
      return activeGroupAccounts(event.groupId, client)
    return []
  }
  const participants = await client.ledgerParticipant.findMany({
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

  async buildIntents(
    event: ActivityNotificationEvent,
    client?: Prisma.TransactionClient,
  ) {
    const category = eventCategory(event)
    if (!category) return []
    // Catch-up summaries intentionally have no expense subject: affected
    // participants receive one coalesced summary while each occurrence
    // activity remains available in the feed.
    const parsed = parseActivityData(event.data)
    const db = client ?? prisma
    const [participants, actor] = await Promise.all([
      expenseParticipantAccounts(event, db),
      activeActorAccount(event, db),
    ])
    const recipients =
      event.type === 'RECURRING_EXPENSE_CREATED' &&
      parsed?.kind === 'recurring_expense_summary' &&
      participants.length === 0
        ? // If the summary's affected participants produce no eligible
          // accounts (all inactive or unlinked), notify only the actor.
          // Do not broadcast to every group member — that would leak
          // expense details to uninvolved participants.
          [...actor]
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

  async buildIntents(
    event: ActivityNotificationEvent,
    client?: Prisma.TransactionClient,
  ) {
    const category = eventCategory(event)
    if (!category) return []
    const db = client ?? prisma
    const recipients = event.recipientAccountId
      ? [{ id: event.recipientAccountId }]
      : event.type === 'INVITATION_CREATED'
        ? await invitationRecipient(event, db)
        : []
    return dedupeRecipients(event, recipients, category)
  }
}

export function defaultActivityHandlers(): ActivityHandler[] {
  return [new ExpenseActivityHandler(), new GroupActivityHandler()]
}
