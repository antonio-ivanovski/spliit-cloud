import { type Prisma } from '@spliit/db'
import { parseActivityData } from '@spliit/domain/activities'
import {
  NotificationSnapshotVersion,
  emailTargetKey,
  pushTargetKey,
} from '@spliit/domain/notification-delivery'
import {
  NotificationCategory,
  NotificationChannel,
} from '@spliit/domain/notifications'
import {
  JOB_NAMES,
  bossTransactionDb,
  insertJobs,
  type SpliitBoss,
} from '@spliit/jobs'

import { randomId } from '../api/shared'
import { getWebBaseUrl } from '../auth/urls'
import { resolveNotificationChannelsForIntents } from './coordinator-policy'
import {
  deliverySnapshotV1Schema,
  type DeliverySnapshotKind,
  type DeliverySnapshotV1,
} from './delivery-snapshot'
import { defaultActivityHandlers } from './handlers'
import type { ActivityNotificationEvent } from './types'

type PlannerClient = Prisma.TransactionClient

type DraftDelivery = {
  id: string
  eventKey: string
  activityId: string | null
  recipientAccountId: string
  category: NotificationCategory
  channel: NotificationChannel
  targetKey: string
  pushSubscriptionId: string | null
  snapshotVersion: number
  snapshot: Prisma.InputJsonValue
}

type PreloadedSnapshotContext = {
  accountsById: Map<
    string,
    {
      id: string
      name: string
      locale: string | null
      timeZone: string | null
    }
  >
  group: { id: string; name: string; groupType: string } | null
  expense: {
    id: string
    description: string
    amount: number
    currencyCode: string | null
  } | null
}

const DELIVERY_STATUS_PENDING = 'PENDING' as const

export async function planActivityNotificationDeliveries(args: {
  event: ActivityNotificationEvent
  tx: Prisma.TransactionClient
  boss: SpliitBoss | null
}): Promise<string[]> {
  const { event, tx, boss } = args
  const handler = defaultActivityHandlers().find((candidate) =>
    candidate.supports(event.type),
  )
  if (!handler) return []
  const baseIntents = await handler.buildIntents(event, tx)
  if (baseIntents.length === 0) return []
  const channelPlans = await resolveNotificationChannelsForIntents(
    baseIntents,
    tx,
  )
  const eventKey =
    event.customEventKey ??
    (event.activityId != null ? `activity:${event.activityId}` : '')
  if (!eventKey) {
    throw new Error(
      '[notifications] invalid event identity: synthetic events (activityId=null) must provide a customEventKey',
    )
  }

  // Construct both EMAIL and PUSH draft specs before touching the
  // database for snapshot data. When every channel is suppressed (empty
  // preference, or PUSH selected with no subscription) the planner must
  // return without issuing account/group/expense queries.
  const draftSpecs: Array<{
    recipientAccountId: string
    category: NotificationCategory
    channel: NotificationChannel
    pushSubscriptionId: string | null
  }> = []

  // Reuse the push subscriptions the channel resolver already fetched —
  // a second findMany here would double the round-trips per event.
  const pushSubscriptionsByAccountId =
    channelPlans[0]?.pushSubscriptionsByAccountId ?? new Map()

  for (let i = 0; i < baseIntents.length; i++) {
    const baseIntent = baseIntents[i]!
    const channels = channelPlans[i]?.channels ?? []
    for (const channel of channels) {
      if (channel === NotificationChannel.EMAIL) {
        draftSpecs.push({
          recipientAccountId: baseIntent.recipientAccountId,
          category: baseIntent.category,
          channel,
          pushSubscriptionId: null,
        })
      } else if (channel === NotificationChannel.PUSH) {
        const subs =
          pushSubscriptionsByAccountId.get(baseIntent.recipientAccountId) ?? []
        for (const subscription of subs) {
          draftSpecs.push({
            recipientAccountId: baseIntent.recipientAccountId,
            category: baseIntent.category,
            channel: NotificationChannel.PUSH,
            pushSubscriptionId: subscription.id,
          })
        }
      }
    }
  }

  if (draftSpecs.length === 0) return []

  // Derive recipientIds from the completed specs so the preload only
  // fetches accounts that will actually appear in a snapshot.
  const recipientIds = new Set<string>()
  for (const spec of draftSpecs) {
    recipientIds.add(spec.recipientAccountId)
  }

  const preloaded = await preloadSnapshotContext({
    tx,
    event,
    recipientIds,
  })

  const deliveryActivityId = event.activityId
  const drafts: DraftDelivery[] = draftSpecs.map((spec) => {
    const targetKey =
      spec.channel === NotificationChannel.EMAIL
        ? emailTargetKey(spec.recipientAccountId)
        : pushTargetKey(spec.pushSubscriptionId!)
    const snapshot = buildSnapshot({
      event,
      eventKey,
      recipientAccountId: spec.recipientAccountId,
      category: spec.category,
      channel: spec.channel,
      pushSubscriptionId: spec.pushSubscriptionId ?? undefined,
      preloaded,
    })
    return {
      id: randomId(),
      eventKey,
      activityId: deliveryActivityId,
      recipientAccountId: spec.recipientAccountId,
      category: spec.category,
      channel: spec.channel,
      targetKey,
      pushSubscriptionId: spec.pushSubscriptionId,
      snapshotVersion: NotificationSnapshotVersion.V1,
      snapshot: snapshot as unknown as Prisma.InputJsonValue,
    }
  })
  if (drafts.length === 0) return []
  await tx.notificationDelivery.createMany({
    data: drafts.map(({ id, ...rest }) => ({
      id,
      status: DELIVERY_STATUS_PENDING,
      ...rest,
    })),
    skipDuplicates: true,
  })
  const persisted = await tx.notificationDelivery.findMany({
    where: {
      eventKey,
      recipientAccountId: {
        in: unique(drafts.map((d) => d.recipientAccountId)),
      },
    },
    select: { id: true },
  })
  const persistedIds = new Set(persisted.map((row) => row.id))
  const newIds = drafts
    .map((draft) => draft.id)
    .filter((id) => persistedIds.has(id))
  if (boss) {
    await insertJobs(
      boss,
      JOB_NAMES.NOTIFICATION_DELIVER,
      newIds.map((id) => ({ deliveryId: id })),
      { db: bossTransactionDb(tx) },
    )
  }
  return newIds
}

function unique<T>(values: ReadonlyArray<T>): T[] {
  return [...new Set(values)]
}

/**
 * Resolve every entity `buildSnapshot` reads in constant time per event,
 * regardless of fan-out size. The shape mirrors the previous per-call loads so
 * callers can index by accountId without falling back to the transaction
 * client.
 *
 * Queries are dispatched sequentially because an interactive Prisma transaction
 * holds exactly one pg connection: `Promise.all` on the same client fires
 * concurrent queries on the same connection, which `pg` already deprecates and
 * the handoff forbids. The expense query is skipped entirely when no draft will
 * need it (i.e. the snapshot kind is neither an expense nor a comment).
 */
async function preloadSnapshotContext(args: {
  tx: PlannerClient
  event: ActivityNotificationEvent
  recipientIds: ReadonlySet<string>
}): Promise<PreloadedSnapshotContext> {
  const { tx, event, recipientIds } = args
  const accountIds = new Set<string>(recipientIds)
  if (event.actor?.type === 'ACCOUNT') {
    accountIds.add(event.actor.id)
  }
  const accountIdList = [...accountIds]
  const accounts =
    accountIdList.length > 0
      ? await tx.account.findMany({
          where: { id: { in: accountIdList } },
          select: {
            id: true,
            name: true,
            preference: { select: { locale: true, timeZone: true } },
          },
        })
      : ([] as Array<{
          id: string
          name: string
          preference: { locale: string | null; timeZone: string | null } | null
        }>)
  const groupRow = await tx.group.findUnique({
    where: { id: event.groupId },
    select: { id: true, name: true, groupType: true },
  })

  const accountsById = new Map<
    string,
    {
      id: string
      name: string
      locale: string | null
      timeZone: string | null
    }
  >()
  for (const account of accounts) {
    accountsById.set(account.id, {
      id: account.id,
      name: account.name,
      locale: account.preference?.locale ?? null,
      timeZone: account.preference?.timeZone ?? null,
    })
  }
  const group = groupRow
    ? {
        id: groupRow.id,
        name: groupRow.name,
        groupType: String(groupRow.groupType),
      }
    : null

  let expense: PreloadedSnapshotContext['expense'] = null
  const snapshotKind = pickSnapshotKind(event)
  if (
    event.subject?.id &&
    (snapshotKind === 'expense_created' ||
      snapshotKind === 'expense_updated' ||
      snapshotKind === 'expense_deleted' ||
      snapshotKind === 'recurring_created' ||
      snapshotKind === 'recurring_occurrence' ||
      snapshotKind === 'settlement' ||
      snapshotKind === 'expense_comment')
  ) {
    const row = await tx.expense.findUnique({
      where: { id: event.subject.id },
      select: {
        id: true,
        title: true,
        amount: true,
        ledger: { select: { currencyCode: true } },
      },
    })
    expense = row
      ? {
          id: row.id,
          description: row.title,
          amount: row.amount,
          currencyCode: row.ledger.currencyCode,
        }
      : null
  }

  return {
    accountsById,
    group,
    expense,
  }
}

function buildSnapshot(args: {
  event: ActivityNotificationEvent
  eventKey: string
  recipientAccountId: string
  category: NotificationCategory
  channel: NotificationChannel
  pushSubscriptionId?: string
  preloaded: PreloadedSnapshotContext
}): DeliverySnapshotV1 {
  const {
    event,
    eventKey,
    recipientAccountId,
    category,
    channel,
    pushSubscriptionId,
    preloaded,
  } = args
  const recipientAccount =
    preloaded.accountsById.get(recipientAccountId) ?? null
  const group = preloaded.group
  const actor =
    event.actor?.type === 'ACCOUNT'
      ? (preloaded.accountsById.get(event.actor.id) ?? null)
      : null
  const expense = preloaded.expense
  const parsed = parseActivityData(event.data)
  const occurredAtIso = event.occurredAt.toISOString()
  const recipientSnapshot = {
    accountId: recipientAccountId,
    displayName: recipientAccount?.name ?? '',
    ...(recipientAccount?.locale ? { locale: recipientAccount.locale } : {}),
    ...(recipientAccount?.timeZone
      ? { timeZone: recipientAccount.timeZone }
      : {}),
  }
  const actorSnapshot = actor
    ? { id: actor.id, name: actor.name }
    : event.actor?.type === 'ACCOUNT'
      ? { id: event.actor.id, name: '' }
      : null
  const baseGroup = group
    ? { id: group.id, name: group.name, type: group.groupType }
    : { id: event.groupId, name: '', type: 'GROUP' }
  const baseLink = `${getWebBaseUrl()}/groups/${event.groupId}`
  const unsubscribeCategory = category
  const pushFields =
    channel === NotificationChannel.PUSH && pushSubscriptionId
      ? {
          subscriptionId: pushSubscriptionId,
          title: pushTitle(event),
          body: pushBody(event),
          url: baseLink,
          tag: eventKey,
        }
      : undefined
  const kind = pickSnapshotKind(event)
  const summary = summaryFromParsed(parsed)
  const draft: Record<string, unknown> = {
    version: NotificationSnapshotVersion.V1,
    kind,
    category,
    occurredAt: occurredAtIso,
    actor: actorSnapshot,
    recipient: recipientSnapshot,
    unsubscribeCategory,
    link: baseLink,
  }
  if (pushFields) draft.push = pushFields
  if (group) {
    if (kind === 'invitation' || kind === 'friend_added') {
      draft.group = { id: baseGroup.id, name: baseGroup.name }
    } else {
      draft.group = baseGroup
    }
  } else {
    draft.group = { id: baseGroup.id, name: baseGroup.name }
  }
  if (
    kind === 'expense_created' ||
    kind === 'expense_updated' ||
    kind === 'expense_deleted' ||
    kind === 'recurring_created' ||
    kind === 'recurring_occurrence' ||
    kind === 'settlement'
  ) {
    if (event.subject?.id) {
      if (expense) {
        draft.expense = expense
      } else if (parsed && parsed.kind === 'expense') {
        // The source row was already deleted (for example an EXPENSE_DELETED
        // event). Reconstruct the snapshot from the captured activity data so
        // the notification still shows the original title/amount/currency
        // rather than an unnamed zero-value expense.
        draft.expense = {
          id: event.subject.id,
          description: parsed.title ?? '',
          amount: parsed.amount ?? 0,
          currencyCode: parsed.currencyCode ?? null,
        }
      } else {
        // Malformed legacy event with neither a source row nor a usable
        // activity snapshot: fall back to empty placeholders.
        draft.expense = {
          id: event.subject.id,
          description: '',
          amount: 0,
          currencyCode: null,
        }
      }
    } else {
      draft.expense = {
        id: '',
        description: '',
        amount: 0,
        currencyCode: null,
      }
    }
  }
  if (kind === 'expense_comment' && event.subject?.id) {
    draft.expense = {
      id: expense?.id ?? event.subject.id,
      description:
        expense?.description ??
        (parsed && parsed.kind === 'expense_comment'
          ? parsed.expenseTitle
          : ''),
    }
    const commentId =
      parsed && parsed.kind === 'expense_comment' ? parsed.commentId : ''
    const excerpt =
      parsed && parsed.kind === 'expense_comment'
        ? (parsed.excerpt?.slice(0, 200) ?? '')
        : ''
    draft.comment = { id: commentId, excerpt }
  }
  if (
    kind === 'recurring_created' ||
    kind === 'recurring_occurrence' ||
    kind === 'recurring_summary' ||
    kind === 'recurring_stopped'
  ) {
    draft.recurrence = recurrenceFromParsed(parsed, event)
  }
  if (kind === 'recurring_created') {
    draft.date =
      parsed && parsed.kind === 'expense'
        ? (parsed.date ?? undefined)
        : undefined
  }
  if (kind === 'expense_updated') {
    draft.changedFields =
      parsed && parsed.kind === 'expense' && parsed.changedFields
        ? [...parsed.changedFields]
        : []
  }
  if (kind === 'expense_deleted') {
    draft.stopped =
      parsed && parsed.kind === 'expense' ? !!parsed.stopped : false
    draft.date =
      parsed && parsed.kind === 'expense'
        ? (parsed.date ?? undefined)
        : undefined
  }
  if (kind === 'recurring_summary') {
    const operation =
      parsed?.kind === 'recurring_expense_summary' ? parsed.operation : 'create'
    const occurrenceCount =
      parsed?.kind === 'recurring_expense_summary' ? parsed.count : 1
    const start =
      parsed?.kind === 'recurring_expense_summary'
        ? parsed.startDate
        : occurredAtIso.slice(0, 10)
    const end =
      parsed?.kind === 'recurring_expense_summary'
        ? parsed.endDate
        : occurredAtIso.slice(0, 10)
    draft.title = parsed && 'title' in parsed ? (parsed.title ?? null) : null
    draft.operation = operation
    draft.occurrenceCount = occurrenceCount
    draft.dateRange = { start, end }
    draft.stopped =
      parsed?.kind === 'recurring_expense_summary' ? !!parsed.stopped : false
  }
  if (kind === 'recurring_stopped') {
    if (parsed?.kind === 'recurring_expense_stopped') {
      draft.title = parsed.title ?? null
    }
  }
  if (kind === 'import_summary') {
    if (parsed?.kind === 'import_summary') {
      draft.import = {
        count: parsed.count,
        source: parsed.sourceProvider ?? null,
      }
      if (parsed.totalAmount != null) draft.totalAmount = parsed.totalAmount
      if (parsed.currencyCode !== undefined)
        draft.currencyCode = parsed.currencyCode
    } else {
      draft.import = { count: 0, source: null }
    }
  }
  if (kind === 'category_bulk') {
    if (parsed?.kind === 'expense_categories_bulk_updated') {
      draft.count = parsed.count
      if (parsed.distinctCategories != null)
        draft.distinctCategories = parsed.distinctCategories
    } else {
      draft.count = 0
    }
  }
  if (kind === 'group_activity') {
    draft.action = groupActivityAction(event.type)
    if (summary) draft.summary = summary
  }
  if (kind === 'invitation') {
    draft.inviterName = actor?.name ?? ''
    draft.inviterRole = 'ADMIN'
  }
  if (kind === 'friend_added') {
    draft.friendName = actor?.name ?? ''
  }
  return deliverySnapshotV1Schema.parse(draft)
}

function pickSnapshotKind(
  event: ActivityNotificationEvent,
): DeliverySnapshotKind {
  // The effective notification category wins over the activity type: a
  // friend-ledger event reuses the INVITATION_CREATED activity type but
  // must render through the friend_added snapshot/email branch.
  if (event.notificationCategory === NotificationCategory.FRIEND_ADDED) {
    return 'friend_added'
  }
  switch (event.type) {
    case 'EXPENSE_CREATED':
      return 'expense_created'
    case 'RECURRING_EXPENSE_CREATED': {
      const parsed = parseActivityData(event.data)
      if (parsed?.kind === 'recurring_expense_summary')
        return 'recurring_summary'
      return 'recurring_created'
    }
    case 'EXPENSE_UPDATED':
      return 'expense_updated'
    case 'EXPENSE_DELETED':
      return 'expense_deleted'
    case 'EXPENSE_COMMENTED':
      return 'expense_comment'
    case 'RECURRING_EXPENSE_STOPPED': {
      const parsed = parseActivityData(event.data)
      if (parsed?.kind === 'recurring_expense_summary')
        return 'recurring_summary'
      return 'recurring_stopped'
    }
    case 'EXPENSES_IMPORTED':
      return 'import_summary'
    case 'EXPENSE_CATEGORIES_BULK_UPDATED':
      return 'category_bulk'
    case 'INVITATION_CREATED':
      return 'invitation'
    default:
      return 'group_activity'
  }
}

function summaryFromParsed(
  parsed: ReturnType<typeof parseActivityData>,
): string | undefined {
  if (!parsed) return undefined
  if (parsed.kind === 'group' && parsed.summary) return parsed.summary
  if (parsed.kind === 'member' && parsed.summary) return parsed.summary
  if (parsed.kind === 'invitation' && parsed.summary) return parsed.summary
  if (parsed.kind === 'expense' && parsed.summary) return parsed.summary
  if (parsed.kind === 'import_summary' && parsed.summary) return parsed.summary
  return undefined
}

function groupActivityAction(type: ActivityNotificationEvent['type']): string {
  return type.toLowerCase()
}

function recurrenceFromParsed(
  parsed: ReturnType<typeof parseActivityData>,
  event: ActivityNotificationEvent,
): { frequency: string; interval: number; rule: string } {
  if (parsed?.kind === 'expense' && parsed.recurrence) {
    return {
      frequency: parsed.recurrence.frequency,
      interval: parsed.recurrence.interval,
      rule: describeRecurrenceRule(parsed.recurrence),
    }
  }
  if (parsed?.kind === 'recurring_expense_summary') {
    const frequency = parsed.frequency ?? 'UNKNOWN'
    const interval = parsed.interval ?? 1
    return {
      frequency,
      interval,
      rule: describeRecurrenceRule({ frequency, interval }),
    }
  }
  if (parsed?.kind === 'recurring_expense_stopped') {
    return {
      frequency: parsed.frequency,
      interval: parsed.interval,
      rule: describeRecurrenceRule({
        frequency: parsed.frequency,
        interval: parsed.interval,
      }),
    }
  }
  return {
    frequency: 'UNKNOWN',
    interval: 1,
    rule: `activity:${event.activityId ?? ''}`,
  }
}

function describeRecurrenceRule(args: {
  frequency: string
  interval: number
}): string {
  return `Every ${args.interval} ${args.frequency.toLowerCase()}${args.interval === 1 ? '' : 's'}`
}

function pushTitle(event: ActivityNotificationEvent): string {
  switch (event.type) {
    case 'EXPENSE_CREATED':
      return 'Expense added'
    case 'EXPENSE_UPDATED':
      return 'Expense updated'
    case 'EXPENSE_DELETED':
      return 'Expense removed'
    case 'RECURRING_EXPENSE_CREATED':
      return 'Recurring expense created'
    case 'RECURRING_EXPENSE_STOPPED':
      return 'Recurring expense stopped'
    case 'EXPENSE_COMMENTED':
      return 'New comment'
    case 'EXPENSES_IMPORTED':
      return 'Expenses imported'
    case 'EXPENSE_CATEGORIES_BULK_UPDATED':
      return 'Categories updated'
    case 'INVITATION_CREATED':
      return 'Group invitation'
    default:
      return 'Group activity'
  }
}

function pushBody(event: ActivityNotificationEvent): string {
  const summary = summaryFromParsed(parseActivityData(event.data))
  return summary ?? event.type.toLowerCase().replaceAll('_', ' ')
}
