import { prisma } from '@spliit/db'
import type { Expense } from '@spliit/domain'
import { getCurrency } from '@spliit/domain'
import { parseActivityData } from '@spliit/domain/activities'
import {
  NotificationCategoryFamily,
  getNotificationCategoryForActivity,
  notificationCategoryFamily,
} from '@spliit/domain/notifications'
import { getAffectedParticipantIds } from '../api/expense-activity-diff'
import { getWebBaseUrl } from '../auth/urls'
import {
  isPermanentPushError,
  sendPushNotification,
  type PushNotificationPayload,
} from './push'
import type {
  ActivityNotificationDispatcher,
  ActivityNotificationEvent,
  ActivityNotificationIntent,
} from './types'

const EXPENSE_EVENT_TYPES = new Set([
  'EXPENSE_CREATED',
  'RECURRING_EXPENSE_CREATED',
  'EXPENSE_UPDATED',
  'EXPENSE_DELETED',
])

const GROUP_SELECT = {
  name: true,
  groupType: true,
  members: {
    where: { status: 'ACTIVE' },
    select: { account: { select: { id: true, name: true } } },
    take: 2,
  },
  invitations: {
    where: { status: 'PENDING' },
    select: { temporaryName: true },
    take: 1,
    orderBy: { createdAt: 'desc' as const },
  },
} as const

type Participant = {
  groupMember: {
    status: string
    account: { id: string; name: string } | null
  } | null
}
type Group = {
  groupType: string
  name: string
  members: Array<{ account: { id: string; name: string } | null }>
  invitations: Array<{ temporaryName: string | null }>
}

function resolveGroupDisplayName(
  groupType: string,
  groupName: string,
  members: Group['members'],
  recipientAccountId: string,
  pendingTemporaryName: string | undefined,
): string {
  if (groupType !== 'FRIEND') return groupName
  const peer = members.find(
    (m) => m.account && m.account.id !== recipientAccountId,
  )
  if (peer?.account?.name) return `your friend ledger with ${peer.account.name}`
  if (pendingTemporaryName)
    return `your friend ledger with ${pendingTemporaryName}`
  return 'your friend ledger'
}

function formatAmount(cents: number, currencyCode?: string | null): string {
  const currency = currencyCode ? getCurrency(currencyCode) : undefined
  const digits = currency?.decimal_digits ?? 2
  const formatted = (cents / 100).toFixed(digits)
  return currencyCode ? `${currencyCode} ${formatted}` : formatted
}

function formatDualAmount(
  amount: number,
  currencyCode: string | null | undefined,
  originalAmount: number | undefined,
  ledgerCurrencyCode: string | null | undefined,
): string {
  if (
    originalAmount != null &&
    currencyCode &&
    ledgerCurrencyCode &&
    ledgerCurrencyCode !== currencyCode
  ) {
    return `${formatAmount(originalAmount, currencyCode)} (${formatAmount(amount, ledgerCurrencyCode)})`
  }
  return formatAmount(amount, currencyCode ?? ledgerCurrencyCode)
}

export class ExpensePushActivityNotificationDispatcher implements ActivityNotificationDispatcher {
  async dispatch(
    input: ActivityNotificationEvent | ActivityNotificationIntent,
  ): Promise<void> {
    const event = 'activity' in input ? input.activity : input
    const recipientAccountId =
      'activity' in input ? input.recipientAccountId : undefined
    const eventCategory =
      event.notificationCategory ??
      getNotificationCategoryForActivity(event.type)
    if (!eventCategory) return
    const category = 'activity' in input ? input.category : eventCategory
    if (category !== eventCategory) return
    if (
      notificationCategoryFamily[category] !==
      NotificationCategoryFamily.EXPENSE
    )
      return
    const parsed = parseActivityData(event.data)
    if (
      event.type === 'RECURRING_EXPENSE_CREATED' &&
      parsed?.kind === 'recurring_expense_summary'
    ) {
      if (recipientAccountId) {
        await this.dispatchRecurringSummary(event, recipientAccountId, parsed)
      }
      return
    }
    if (
      parsed &&
      (parsed.kind === 'import_summary' ||
        parsed.kind === 'expense_categories_bulk_updated')
    ) {
      if (recipientAccountId) {
        await this.dispatchSummary(event, recipientAccountId, parsed)
      }
      return
    }
    if (!EXPENSE_EVENT_TYPES.has(event.type)) return
    if (!parsed || parsed.kind !== 'expense' || !parsed.title) return

    let participantIds: string[]
    if (
      event.type === 'EXPENSE_CREATED' ||
      event.type === 'RECURRING_EXPENSE_CREATED'
    ) {
      if (!event.subject?.id) return
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
      if (!raw) return
      const expenseForDiff = {
        paidByList: raw.paidByList.map((pb) => ({
          participant: pb.ledgerParticipantId,
          shares: pb.shares,
        })),
        paidFor: raw.paidFor.map((pf) => ({
          participant: pf.ledgerParticipantId,
          shares: pf.shares,
        })),
        items: raw.items.map((item) => ({
          id: item.id,
          paidFor: item.paidFor.map((pf) => ({
            participant: pf.ledgerParticipantId,
            shares: pf.shares,
          })),
        })),
        itemizedRemainder: raw.itemizedRemainder
          ? {
              splitMode: raw.itemizedRemainder.splitMode,
              paidFor: raw.itemizedRemainder.paidFor.map((pf) => ({
                participant: pf.ledgerParticipantId,
                shares: pf.shares,
              })),
            }
          : undefined,
      } as unknown as Expense
      participantIds = [
        ...getAffectedParticipantIds({ newExpense: expenseForDiff }),
      ]
    } else {
      participantIds = parsed.affectedParticipants ?? []
    }
    if (participantIds.length === 0 && !event.includeActorAsRecipient) return

    const [participants, group, actorAccount] = await Promise.all([
      prisma.ledgerParticipant.findMany({
        where: { id: { in: participantIds } },
        include: { groupMember: { include: { account: true } } },
      }),
      prisma.group.findUnique({
        where: { id: event.groupId },
        select: GROUP_SELECT,
      }),
      event.actor?.type === 'ACCOUNT'
        ? prisma.account.findUnique({
            where: { id: event.actor.id },
            select: { name: true },
          })
        : Promise.resolve(null),
    ])
    if (!group) return

    // The series creator can be an active group member without appearing in
    // the generated expense's participant split. Include that targeted
    // recipient so recurring creation reaches the original creator too.
    let recipientParticipants = participants
    const creatorAccountId =
      event.includeActorAsRecipient && event.actor?.type === 'ACCOUNT'
        ? event.actor.id
        : undefined
    const targetedAccountId = recipientAccountId ?? creatorAccountId
    if (targetedAccountId && event.includeActorAsRecipient) {
      const hasRecipient = participants.some(
        (participant) =>
          participant.groupMember?.account?.id === targetedAccountId,
      )
      if (!hasRecipient) {
        const member = await prisma.groupMember.findFirst({
          where: {
            groupId: event.groupId,
            accountId: targetedAccountId,
            status: 'ACTIVE',
          },
          select: {
            status: true,
            account: { select: { id: true, email: true, name: true } },
          },
        })
        if (member?.account) {
          recipientParticipants = [
            ...participants,
            {
              groupMember: { status: member.status, account: member.account },
            } as (typeof participants)[number],
          ]
        }
      }
    }
    const actorName = actorAccount?.name ?? 'Someone'
    const amountStr =
      parsed.amount != null
        ? formatDualAmount(
            parsed.amount,
            parsed.currencyCode,
            parsed.originalAmount,
            parsed.ledgerCurrencyCode,
          )
        : null
    const groupUrl = `${getWebBaseUrl()}/groups/${event.groupId}`
    const url =
      event.type !== 'EXPENSE_DELETED' && event.subject?.id
        ? `${groupUrl}/expenses/${event.subject.id}`
        : groupUrl

    const action =
      event.type === 'RECURRING_EXPENSE_CREATED'
        ? 'created as a recurring expense'
        : event.type === 'EXPENSE_CREATED'
          ? 'added'
          : event.type === 'EXPENSE_UPDATED'
            ? 'updated'
            : 'removed'

    const notifiedAccountIds = new Set<string>()
    const sends: Promise<void>[] = []
    for (const participant of recipientParticipants as unknown as Participant[]) {
      const groupMember = participant.groupMember
      const account = groupMember?.account
      if (!groupMember || groupMember.status !== 'ACTIVE' || !account) continue
      if (recipientAccountId && account.id !== recipientAccountId) continue
      if (
        event.actor?.type === 'ACCOUNT' &&
        event.actor.id === account.id &&
        !event.includeActorAsRecipient
      )
        continue
      if (notifiedAccountIds.has(account.id)) continue
      notifiedAccountIds.add(account.id)

      const displayName = resolveGroupDisplayName(
        group.groupType,
        group.name,
        group.members,
        account.id,
        group.invitations[0]?.temporaryName ?? undefined,
      )
      const body = `Expense "${parsed.title}"${amountStr ? ` (${amountStr})` : ''} was ${action} by ${actorName} in ${displayName}.`
      const payload: PushNotificationPayload = {
        version: 1,
        kind: 'expense',
        activityId: event.activityId,
        title:
          event.type === 'RECURRING_EXPENSE_CREATED'
            ? 'Recurring expense created'
            : `Expense ${action}`,
        body,
        url,
        tag: `activity:${event.activityId}`,
      }
      sends.push(this.sendToAccount(account.id, payload))
    }
    await Promise.all(sends)
  }

  private async dispatchSummary(
    event: ActivityNotificationEvent,
    recipientAccountId: string,
    parsed:
      | Extract<
          NonNullable<ReturnType<typeof parseActivityData>>,
          { kind: 'import_summary' }
        >
      | Extract<
          NonNullable<ReturnType<typeof parseActivityData>>,
          { kind: 'expense_categories_bulk_updated' }
        >,
  ): Promise<void> {
    const [group, actorAccount] = await Promise.all([
      prisma.group.findUnique({
        where: { id: event.groupId },
        select: GROUP_SELECT,
      }),
      event.actor?.type === 'ACCOUNT'
        ? prisma.account.findUnique({
            where: { id: event.actor.id },
            select: { name: true },
          })
        : Promise.resolve(null),
    ])
    if (!group) return

    const actorName = actorAccount?.name ?? 'Someone'
    const displayName = resolveGroupDisplayName(
      group.groupType,
      group.name,
      group.members,
      recipientAccountId,
      group.invitations[0]?.temporaryName ?? undefined,
    )
    const noun = parsed.count === 1 ? 'expense' : 'expenses'
    const isImport = parsed.kind === 'import_summary'
    const payload: PushNotificationPayload = {
      version: 1,
      kind: 'activity',
      activityId: event.activityId,
      title: isImport ? 'Expenses imported' : 'Expense categories updated',
      body: isImport
        ? `${actorName} imported ${parsed.count} ${noun}${parsed.sourceProvider ? ` from ${parsed.sourceProvider}` : ''} in ${displayName}.`
        : `${actorName} updated categories for ${parsed.count} ${noun} in ${displayName}.`,
      url: `${getWebBaseUrl()}/groups/${event.groupId}`,
      tag: `activity:${event.activityId}`,
    }
    await this.sendToAccount(recipientAccountId, payload)
  }

  private async dispatchRecurringSummary(
    event: ActivityNotificationEvent,
    recipientAccountId: string,
    parsed: Extract<
      NonNullable<ReturnType<typeof parseActivityData>>,
      { kind: 'recurring_expense_summary' }
    >,
  ): Promise<void> {
    const [group, actorAccount] = await Promise.all([
      prisma.group.findUnique({
        where: { id: event.groupId },
        select: GROUP_SELECT,
      }),
      event.actor?.type === 'ACCOUNT'
        ? prisma.account.findUnique({
            where: { id: event.actor.id },
            select: { name: true },
          })
        : Promise.resolve(null),
    ])
    if (!group) return
    const displayName = resolveGroupDisplayName(
      group.groupType,
      group.name,
      group.members,
      recipientAccountId,
      group.invitations[0]?.temporaryName ?? undefined,
    )
    const actorName = actorAccount?.name ?? 'Someone'
    const noun = parsed.count === 1 ? 'expense' : 'expenses'
    const title = parsed.title ? ` "${parsed.title}"` : ''
    await this.sendToAccount(recipientAccountId, {
      version: 1,
      kind: 'activity',
      activityId: event.activityId,
      title: 'Recurring expenses caught up',
      body: `${actorName} added ${parsed.count} recurring ${noun}${title} in ${displayName} for ${parsed.startDate} through ${parsed.endDate}.`,
      url: `${getWebBaseUrl()}/groups/${event.groupId}`,
      tag: `activity:${event.activityId}`,
    })
  }

  private async sendToAccount(
    accountId: string,
    payload: PushNotificationPayload,
  ): Promise<void> {
    const subscriptions = await prisma.pushSubscription.findMany({
      where: { accountId },
      select: { id: true, endpoint: true, p256dh: true, auth: true },
    })
    await Promise.all(
      subscriptions.map(async (subscription) => {
        try {
          await sendPushNotification(subscription, payload)
        } catch (error) {
          if (isPermanentPushError(error)) {
            await prisma.pushSubscription.deleteMany({
              where: { id: subscription.id },
            })
          } else {
            console.warn(
              `[notifications] failed to send push for activity ${payload.activityId}:`,
              error,
            )
          }
        }
      }),
    )
  }
}
