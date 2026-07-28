import { prisma } from '@spliit/db'
import { parseActivityData } from '@spliit/domain/activities'
import {
  NotificationCategoryFamily,
  getNotificationCategoryForActivity,
  notificationCategoryFamily,
} from '@spliit/domain/notifications'

import { getWebBaseUrl } from '../auth/urls'
import {
  buildRecurringSummaryContent,
  formatRecurrenceRule,
} from './expense-notification-content'
import {
  ensureAccountIncludedAsParticipant,
  formatExpenseDualAmount,
  loadActivityChannelContext,
  loadActivityGroupAndActor,
  loadActivityRecipientMember,
  resolveCreatedExpenseRecipientIds,
  resolveGroupDisplayName,
  type ExpenseNotificationParticipant,
} from './expense-notification-shared'
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
  'RECURRING_EXPENSE_STOPPED',
])
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
    if (parsed?.kind === 'recurring_expense_summary') {
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
    if (event.type === 'EXPENSE_COMMENTED') {
      if (recipientAccountId) {
        await this.dispatchComment(event, recipientAccountId)
      }
      return
    }
    if (!EXPENSE_EVENT_TYPES.has(event.type)) return
    // Handle recurrence stopped with a deletion-style push.
    if (
      event.type === 'RECURRING_EXPENSE_STOPPED' &&
      parsed?.kind === 'recurring_expense_stopped'
    ) {
      if (recipientAccountId) {
        await this.dispatchRecurrenceStopped(event, recipientAccountId, parsed)
      }
      return
    }
    if (!parsed || parsed.kind !== 'expense' || !parsed.title) return

    const participantIds =
      event.type === 'EXPENSE_CREATED' ||
      event.type === 'RECURRING_EXPENSE_CREATED'
        ? event.subject?.id
          ? await resolveCreatedExpenseRecipientIds(event.subject.id)
          : []
        : (parsed.affectedParticipants ?? [])
    if (participantIds.length === 0 && !event.includeActorAsRecipient) return

    const {
      participants: initialParticipants,
      group,
      actorName,
    } = await loadActivityChannelContext({
      groupId: event.groupId,
      participantIds,
      actor: event.actor,
    })
    if (!group) return

    // The series creator can be an active group member without appearing in
    // the generated expense's participant split. Include that targeted
    // recipient so recurring creation reaches the original creator too.
    const creatorAccountId =
      event.includeActorAsRecipient && event.actor?.type === 'ACCOUNT'
        ? event.actor.id
        : undefined
    const targetedAccountId = recipientAccountId ?? creatorAccountId
    const recipientParticipants = targetedAccountId
      ? await ensureAccountIncludedAsParticipant({
          groupId: event.groupId,
          participants: initialParticipants,
          accountId: targetedAccountId,
        })
      : initialParticipants

    const amountStr =
      parsed.amount != null
        ? formatExpenseDualAmount(
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
    const stoppedSuffix =
      parsed.stopped && event.type === 'EXPENSE_DELETED'
        ? ' and the recurrence was stopped'
        : ''
    const recurrenceSuffix =
      event.type === 'RECURRING_EXPENSE_CREATED' && parsed.recurrence
        ? ` (${formatRecurrenceRule(parsed.recurrence)})`
        : ''

    const notifiedAccountIds = new Set<string>()
    const sends: Promise<void>[] = []
    for (const participant of recipientParticipants as unknown as ExpenseNotificationParticipant[]) {
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
      const body = `Expense "${parsed.title}"${amountStr ? ` (${amountStr})` : ''} was ${action}${stoppedSuffix} by ${actorName} in ${displayName}${recurrenceSuffix}.`
      const payload: PushNotificationPayload = {
        version: 1,
        kind: 'expense',
        activityId: event.activityId ?? '',
        title:
          event.type === 'RECURRING_EXPENSE_CREATED'
            ? 'Recurring expense created'
            : event.type === 'RECURRING_EXPENSE_STOPPED'
              ? 'Recurring expense stopped'
              : `Expense ${action}${stoppedSuffix ? ' and stopped' : ''}`,
        body,
        url,
        tag: `activity:${event.activityId ?? ''}`,
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
    const { group, actorName } = await loadActivityGroupAndActor({
      groupId: event.groupId,
      actor: event.actor,
    })
    if (!group) return

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
      activityId: event.activityId ?? '',
      title: isImport ? 'Expenses imported' : 'Expense categories updated',
      body: isImport
        ? `${actorName} imported ${parsed.count} ${noun}${parsed.sourceProvider ? ` from ${parsed.sourceProvider}` : ''} in ${displayName}.`
        : `${actorName} updated categories for ${parsed.count} ${noun} in ${displayName}.`,
      url: `${getWebBaseUrl()}/groups/${event.groupId}`,
      tag: `activity:${event.activityId ?? ''}`,
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
    const { group, actorName } = await loadActivityGroupAndActor({
      groupId: event.groupId,
      actor: event.actor,
    })
    if (!group) return
    const displayName = resolveGroupDisplayName(
      group.groupType,
      group.name,
      group.members,
      recipientAccountId,
      group.invitations[0]?.temporaryName ?? undefined,
    )
    const recurrenceMeta =
      parsed.frequency && parsed.interval
        ? {
            seriesId: parsed.seriesId ?? '',
            frequency: parsed.frequency,
            interval: parsed.interval,
            endType: parsed.endType ?? 'NEVER',
            occurrenceLimit: parsed.occurrenceLimit ?? null,
            endDate: parsed.seriesEndDate ?? null,
          }
        : null
    const content = buildRecurringSummaryContent({
      operation: parsed.operation,
      actorName,
      displayName,
      count: parsed.count,
      title: ('title' in parsed ? parsed.title : null) as string | null,
      startDate: parsed.startDate,
      endDate: parsed.endDate,
      stopped: parsed.stopped,
      recurrenceMeta,
    })
    await this.sendToAccount(recipientAccountId, {
      version: 1,
      kind: 'activity',
      activityId: event.activityId ?? '',
      title: content.title,
      body: content.body,
      url: `${getWebBaseUrl()}/groups/${event.groupId}`,
      tag: `activity:${event.activityId ?? ''}`,
    })
  }

  private async dispatchRecurrenceStopped(
    event: ActivityNotificationEvent,
    recipientAccountId: string,
    parsed: Extract<
      NonNullable<ReturnType<typeof parseActivityData>>,
      { kind: 'recurring_expense_stopped' }
    >,
  ): Promise<void> {
    const { group, actorName } = await loadActivityGroupAndActor({
      groupId: event.groupId,
      actor: event.actor,
    })
    if (!group) return
    const displayName = resolveGroupDisplayName(
      group.groupType,
      group.name,
      group.members,
      recipientAccountId,
      group.invitations[0]?.temporaryName ?? undefined,
    )
    const title = parsed.title ? ` "${parsed.title}"` : ''
    const recurrenceText =
      parsed.frequency && parsed.interval
        ? formatRecurrenceRule({
            seriesId: parsed.seriesId,
            frequency: parsed.frequency,
            interval: parsed.interval,
            endType: parsed.endType,
            occurrenceLimit: parsed.occurrenceLimit ?? null,
            endDate: parsed.endDate ?? null,
          })
        : undefined
    const recurrenceDesc = recurrenceText ? ` (${recurrenceText})` : ''
    await this.sendToAccount(recipientAccountId, {
      version: 1,
      kind: 'activity',
      activityId: event.activityId ?? '',
      title: 'Recurring expense stopped',
      body: `${actorName} stopped the recurring expense${title}${recurrenceDesc} in ${displayName}.`,
      url: `${getWebBaseUrl()}/groups/${event.groupId}`,
      tag: `activity:${event.activityId ?? ''}`,
    })
  }

  private async dispatchComment(
    event: ActivityNotificationEvent,
    recipientAccountId: string,
  ): Promise<void> {
    if (!event.subject?.id) return
    const payload = parseActivityData(event.data)
    if (!payload || payload.kind !== 'expense_comment') return
    const title = payload.expenseTitle
    const [{ group, actorName: resolvedActorName }, member] = await Promise.all(
      [
        loadActivityGroupAndActor({
          groupId: event.groupId,
          actor: event.actor,
        }),
        loadActivityRecipientMember({
          groupId: event.groupId,
          recipientAccountId,
        }),
      ],
    )
    if (!group || !member) return
    const actorName = payload.authorName ?? resolvedActorName
    const displayName = resolveGroupDisplayName(
      group.groupType,
      group.name,
      group.members,
      recipientAccountId,
      group.invitations[0]?.temporaryName ?? undefined,
    )
    const excerpt = payload.excerpt?.trim() ?? ''
    await this.sendToAccount(recipientAccountId, {
      version: 1,
      kind: 'activity',
      activityId: event.activityId ?? '',
      title: 'New expense comment',
      body: `${actorName} commented on "${title}" in ${displayName}${excerpt ? `: "${excerpt}"` : '.'}`,
      url: `${getWebBaseUrl()}/groups/${event.groupId}/expenses/${event.subject.id}`,
      tag: `activity:${event.activityId ?? ''}`,
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
