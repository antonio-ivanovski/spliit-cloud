import { type Prisma } from '@spliit/db'
import {
  getBalances,
  getCategoryById,
  isSettlementCategory,
  type Balances,
  type RemainderAllocationMode,
  type SplitMode,
} from '@spliit/domain'
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
import {
  resolveGroupDisplayName,
  type ExpenseNotificationMember,
} from './expense-notification-shared'
import { formatNotificationAmount } from './format'
import { defaultActivityHandlers } from './handlers'
import {
  formatPersonalShareLine,
  personalShareForRecipient,
  type PersonalExpenseShare,
} from './personal-expense-share'
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
  group: {
    id: string
    name: string
    groupType: string
    memberCount: number | null
    members: ExpenseNotificationMember[]
    pendingTemporaryName: string | undefined
  } | null
  expense: {
    id: string
    description: string
    amount: number
    currencyCode: string | null
    categoryName: string | null
    isSettlement: boolean
    paidBy: Array<{ name: string; amount: number }>
    paidByOverflowCount: number
  } | null
  /**
   * Single-expense balances for the personal share line on
   * expense_created/expense_updated snapshots. Null unless the expense row
   * (with splits) loaded successfully. Keys of `balances` are ledger
   * participant ids; `participantIdByAccountId` maps accounts back to them.
   */
  expenseShares: {
    balances: Balances
    participantIdByAccountId: Map<string, string>
    currencyCode: string | null
    isSettlement: boolean
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
      ? await tx.user.findMany({
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
    select: {
      id: true,
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
        orderBy: { createdAt: 'desc' },
      },
    },
  })
  // Separate count query (sequential: the planner transaction holds a single
  // pg connection). Tolerates mocks/legacy rows that resolve without it.
  let memberCount: number | null = null
  try {
    const count = await tx.groupMember.count({
      where: { groupId: event.groupId, status: 'ACTIVE' },
    })
    if (typeof count === 'number') memberCount = count
  } catch {
    memberCount = null
  }

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
        memberCount,
        members: ((groupRow as { members?: ExpenseNotificationMember[] })
          .members ?? []) as ExpenseNotificationMember[],
        pendingTemporaryName: (
          groupRow as {
            invitations?: Array<{ temporaryName: string | null }>
          }
        ).invitations?.[0]?.temporaryName as string | undefined,
      }
    : null

  let expense: PreloadedSnapshotContext['expense'] = null
  const snapshotKind = pickSnapshotKind(event)
  // The personal share line only covers expense_created/expense_updated:
  // UPDATED reads the new share from the current row, DELETED has no source
  // row left to compute from, and summaries stay generic by design.
  const needsShares =
    snapshotKind === 'expense_created' || snapshotKind === 'expense_updated'
  // Payer/category enrichment needs the same balances + participant mapping
  // for every single-expense view (created, recurring instances, settlement).
  // UPDATED intentionally keeps changed-field names only, so its snapshot
  // never carries the enrichment below.
  const needsEnrichment =
    needsShares ||
    snapshotKind === 'recurring_created' ||
    snapshotKind === 'recurring_occurrence' ||
    snapshotKind === 'settlement'
  let expenseShares: PreloadedSnapshotContext['expenseShares'] = null
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
        categoryId: true,
        splitMode: true,
        paidBySplitMode: true,
        originalAmount: true,
        originalCurrency: true,
        conversionRate: true,
        ledger: { select: { currencyCode: true } },
        paidByList: { select: { ledgerParticipantId: true, shares: true } },
        paidFor: { select: { ledgerParticipantId: true, shares: true } },
        items: {
          select: {
            amount: true,
            splitMode: true,
            paidFor: {
              select: { ledgerParticipantId: true, shares: true },
            },
          },
        },
        itemizedRemainder: {
          select: {
            splitMode: true,
            allocationMode: true,
            paidFor: {
              select: { ledgerParticipantId: true, shares: true },
            },
          },
        },
      },
    })
    expense = row
      ? {
          id: row.id,
          description: row.title,
          amount: row.amount,
          currencyCode: row.ledger.currencyCode,
          categoryName: categoryDisplayName(
            (row as { categoryId?: unknown }).categoryId,
          ),
          isSettlement: isSettlementCategory(
            typeof (row as { categoryId?: unknown }).categoryId === 'string'
              ? ((row as { categoryId?: string }).categoryId as string)
              : undefined,
          ),
          paidBy: [],
          paidByOverflowCount: 0,
        }
      : null
    if (expense && needsEnrichment && row) {
      expenseShares = await loadExpenseShares(tx, row)
      if (expenseShares) {
        await topUpPayerAccountNames(tx, expenseShares, accountsById)
        const payers = resolveExpensePayers(expenseShares, accountsById)
        expense.paidBy = payers.paidBy
        expense.paidByOverflowCount = payers.overflowCount
      }
    }
  }

  return {
    accountsById,
    group,
    expense,
    expenseShares,
  }
}

/**
 * Compute single-expense balances and map split participants back to accounts.
 * Runs once per event inside the planner preload, so fan-out stays O(1) in
 * database round-trips. Never throws: a share computation failure drops the
 * personal line, not the notification.
 */
async function loadExpenseShares(
  tx: PlannerClient,
  row: {
    amount: number
    categoryId: string
    splitMode: string
    paidBySplitMode: string
    originalAmount: number | null
    originalCurrency: string | null
    conversionRate: number | null
    ledger: { currencyCode: string | null }
    paidByList: Array<{ ledgerParticipantId: string; shares: number }>
    paidFor: Array<{ ledgerParticipantId: string; shares: number }>
    items: Array<{
      amount: number
      splitMode: string
      paidFor: Array<{ ledgerParticipantId: string; shares: number }>
    }>
    itemizedRemainder: {
      splitMode: string
      allocationMode: string
      paidFor: Array<{ ledgerParticipantId: string; shares: number }>
    } | null
  },
): Promise<PreloadedSnapshotContext['expenseShares']> {
  try {
    const participantIds = new Set<string>()
    for (const entry of row.paidByList)
      participantIds.add(entry.ledgerParticipantId)
    for (const entry of row.paidFor)
      participantIds.add(entry.ledgerParticipantId)
    for (const item of row.items) {
      for (const entry of item.paidFor)
        participantIds.add(entry.ledgerParticipantId)
    }
    for (const entry of row.itemizedRemainder?.paidFor ?? []) {
      participantIds.add(entry.ledgerParticipantId)
    }
    if (participantIds.size === 0) return null
    const participants = await tx.ledgerParticipant.findMany({
      where: { id: { in: [...participantIds] } },
      select: { id: true, groupMember: { select: { accountId: true } } },
    })
    const participantIdByAccountId = new Map<string, string>()
    for (const participant of participants) {
      if (participant.groupMember) {
        participantIdByAccountId.set(
          participant.groupMember.accountId,
          participant.id,
        )
      }
    }
    const balances = getBalances([
      {
        amount: row.amount,
        splitMode: row.splitMode as SplitMode,
        paidBySplitMode: row.paidBySplitMode as SplitMode,
        paidByList: row.paidByList.map((entry) => ({
          shares: entry.shares,
          participant: { id: entry.ledgerParticipantId },
        })),
        paidFor: row.paidFor.map((entry) => ({
          shares: entry.shares,
          participant: { id: entry.ledgerParticipantId },
        })),
        originalAmount: row.originalAmount,
        originalCurrency: row.originalCurrency,
        conversionRate: row.conversionRate,
        items: row.items.map((item) => ({
          amount: item.amount,
          splitMode: item.splitMode as SplitMode,
          paidFor: item.paidFor.map((entry) => ({
            participant: entry.ledgerParticipantId,
            shares: entry.shares,
          })),
        })),
        itemizedRemainder: row.itemizedRemainder
          ? {
              splitMode: row.itemizedRemainder.splitMode as SplitMode,
              paidFor: row.itemizedRemainder.paidFor.map((entry) => ({
                participant: entry.ledgerParticipantId,
                shares: entry.shares,
              })),
              allocationMode: row.itemizedRemainder
                .allocationMode as RemainderAllocationMode,
            }
          : null,
      },
    ])
    return {
      balances,
      participantIdByAccountId,
      currencyCode: row.ledger.currencyCode,
      isSettlement: isSettlementCategory(row.categoryId),
    }
  } catch {
    return null
  }
}

/** Resolve one draft recipient's share from the preloaded expense balances. */
function resolvePersonalShare(
  preloaded: PreloadedSnapshotContext,
  recipientAccountId: string,
): PersonalExpenseShare | null {
  const shares = preloaded.expenseShares
  if (!shares) return null
  return personalShareForRecipient({
    balances: shares.balances,
    ledgerParticipantId:
      shares.participantIdByAccountId.get(recipientAccountId),
    currencyCode: shares.currencyCode,
    isSettlement: shares.isSettlement,
  })
}

/**
 * In-code category display name for an `Expense.categoryId` slug. Returns null
 * for unknown/missing ids so callers omit the Category line instead of
 * rendering a raw slug.
 */
function categoryDisplayName(categoryId: unknown): string | null {
  if (typeof categoryId !== 'string' || categoryId.length === 0) return null
  return getCategoryById(categoryId)?.name ?? null
}

/**
 * Fetch display names for payer accounts missing from `accountsById`
 * (recipients + actor are already loaded). Best-effort: failures leave the map
 * untouched and payers fall back to omission, never failing the plan.
 */
async function topUpPayerAccountNames(
  tx: PlannerClient,
  shares: NonNullable<PreloadedSnapshotContext['expenseShares']>,
  accountsById: PreloadedSnapshotContext['accountsById'],
): Promise<void> {
  const missing = [...shares.participantIdByAccountId.keys()].filter(
    (accountId) => !accountsById.has(accountId),
  )
  if (missing.length === 0) return
  try {
    const rows = await tx.user.findMany({
      where: { id: { in: missing } },
      select: { id: true, name: true },
    })
    for (const row of rows as Array<{ id: string; name: string }>) {
      accountsById.set(row.id, {
        id: row.id,
        name: row.name,
        locale: null,
        timeZone: null,
      })
    }
  } catch {
    // Omit payer names; the notification still delivers.
  }
}

const MAX_SNAPSHOT_PAYERS = 3

/**
 * Top payers by paid amount (descending) from preloaded single-expense
 * balances. Participants without a paid share or without a resolvable account
 * name are skipped; surplus payers collapse into `overflowCount`.
 */
function resolveExpensePayers(
  shares: NonNullable<PreloadedSnapshotContext['expenseShares']>,
  accountsById: PreloadedSnapshotContext['accountsById'],
): { paidBy: Array<{ name: string; amount: number }>; overflowCount: number } {
  const accountIdByParticipantId = new Map<string, string>()
  for (const [accountId, participantId] of shares.participantIdByAccountId) {
    accountIdByParticipantId.set(participantId, accountId)
  }
  const ranked: Array<{ name: string; amount: number }> = []
  for (const [participantId, entry] of Object.entries(shares.balances)) {
    const paid = (entry as { paid?: unknown }).paid
    if (typeof paid !== 'number' || !Number.isInteger(paid) || paid <= 0)
      continue
    const accountId = accountIdByParticipantId.get(participantId)
    const name = accountId ? accountsById.get(accountId)?.name : undefined
    if (!accountId || !name) continue
    ranked.push({ name, amount: paid })
  }
  ranked.sort((a, b) => b.amount - a.amount)
  return {
    paidBy: ranked.slice(0, MAX_SNAPSHOT_PAYERS),
    overflowCount: Math.max(0, ranked.length - MAX_SNAPSHOT_PAYERS),
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
    ? { id: actor.id, name: actor.name, type: 'ACCOUNT' as const }
    : event.actor?.type === 'ACCOUNT'
      ? { id: event.actor.id, name: '', type: 'ACCOUNT' as const }
      : null
  const groupDisplayName = group
    ? resolveGroupDisplayName(
        group.groupType,
        group.name,
        group.members,
        recipientAccountId,
        group.pendingTemporaryName,
      )
    : ''
  const baseGroup = group
    ? {
        id: group.id,
        name: group.name,
        type: group.groupType,
        displayName: groupDisplayName,
        ...(group.memberCount != null
          ? { memberCount: group.memberCount }
          : {}),
      }
    : { id: event.groupId, name: '', type: 'GROUP' }
  const baseLink = `${getWebBaseUrl()}/groups/${event.groupId}`
  const kind = pickSnapshotKind(event)
  const hasViewableExpense =
    kind === 'expense_created' ||
    kind === 'expense_updated' ||
    kind === 'expense_comment' ||
    kind === 'recurring_created' ||
    kind === 'recurring_occurrence' ||
    kind === 'settlement'
  const link =
    hasViewableExpense && expense
      ? `${baseLink}/expenses/${encodeURIComponent(expense.id)}`
      : baseLink
  const unsubscribeCategory = category
  // Per-recipient share for the "how much you owe" line. Only
  // expense_created/expense_updated carry it; every other kind renders the
  // generic copy.
  const personal =
    kind === 'expense_created' || kind === 'expense_updated'
      ? resolvePersonalShare(preloaded, recipientAccountId)
      : null
  const recipientLocale = recipientAccount?.locale ?? 'en-US'
  const personalSuffix = personal
    ? formatPersonalShareLine(personal, (cents) =>
        formatNotificationAmount(cents, personal.currencyCode, recipientLocale),
      )
    : null
  const actorLabel = actor?.name || 'Someone'
  const pushFields =
    channel === NotificationChannel.PUSH && pushSubscriptionId
      ? {
          subscriptionId: pushSubscriptionId,
          title: pushTitle(event),
          body: pushBodyForSnapshot({
            kind,
            event,
            parsed,
            expense,
            recipientLocale,
            actorLabel,
            groupDisplayName,
            personalSuffix,
          }),
          url: link,
          tag: eventKey,
        }
      : undefined
  const summary = summaryFromParsed(parsed)
  const draft: Record<string, unknown> = {
    version: NotificationSnapshotVersion.V1,
    kind,
    category,
    occurredAt: occurredAtIso,
    actor: actorSnapshot,
    recipient: recipientSnapshot,
    unsubscribeCategory,
    link,
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
  // Standard created-expense enrichment (category, settlement flag, top
  // payers). UPDATED intentionally stays changed-field names only; DELETED
  // reuses the captured activity data without enrichment.
  const enrichExpense =
    kind === 'expense_created' ||
    kind === 'recurring_created' ||
    kind === 'recurring_occurrence' ||
    kind === 'settlement'
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
        const { paidBy, paidByOverflowCount, ...rest } = expense
        draft.expense = enrichExpense
          ? {
              ...rest,
              ...(paidBy.length > 0 ? { paidBy } : {}),
              ...(paidByOverflowCount > 0 ? { paidByOverflowCount } : {}),
            }
          : {
              id: expense.id,
              description: expense.description,
              amount: expense.amount,
              currencyCode: expense.currencyCode,
            }
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
  if (personal && (kind === 'expense_created' || kind === 'expense_updated')) {
    draft.personal = personal
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
  if (kind === 'expense_created') {
    draft.date =
      parsed && parsed.kind === 'expense'
        ? (parsed.date ?? undefined)
        : undefined
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

const MAX_PUSH_BODY_LENGTH = 180

function truncatePushBody(body: string): string {
  if (body.length <= MAX_PUSH_BODY_LENGTH) return body
  return `${body.slice(0, MAX_PUSH_BODY_LENGTH - 1).trimEnd()}…`
}

/**
 * Enriched push body for single-expense snapshots. Created/recurring/
 * settlement bodies carry amount, group display name, and top payers; updated
 * bodies carry the group display name only (changed-field names stay the source
 * of what changed). Every other kind keeps the legacy generic body. The
 * personal share suffix appends wherever one was resolved.
 */
function pushBodyForSnapshot(args: {
  kind: DeliverySnapshotKind
  event: ActivityNotificationEvent
  parsed: ReturnType<typeof parseActivityData>
  expense: PreloadedSnapshotContext['expense']
  recipientLocale: string
  actorLabel: string
  groupDisplayName: string
  personalSuffix: string | null
}): string {
  const {
    kind,
    event,
    parsed,
    expense,
    recipientLocale,
    actorLabel,
    groupDisplayName,
    personalSuffix,
  } = args
  const withPersonal = (body: string) =>
    truncatePushBody(personalSuffix ? `${body} · ${personalSuffix}` : body)
  if (
    kind === 'expense_created' ||
    kind === 'recurring_created' ||
    kind === 'settlement' ||
    kind === 'expense_updated'
  ) {
    const parsedTitle =
      parsed && parsed.kind === 'expense' ? parsed.title : undefined
    const description = expense?.description || parsedTitle || 'expense'
    const amount =
      expense?.amount ??
      (parsed && parsed.kind === 'expense' ? parsed.amount : undefined)
    const currency =
      expense?.currencyCode ??
      (parsed && parsed.kind === 'expense' ? parsed.currencyCode : undefined)
    const amountStr =
      amount != null
        ? formatNotificationAmount(amount, currency ?? null, recipientLocale)
        : null
    const quoted = `"${description}"`
    const amountPart = amountStr ? ` (${amountStr})` : ''
    const groupPart = groupDisplayName ? ` in ${groupDisplayName}` : ''
    if (kind === 'expense_updated') {
      return withPersonal(`${actorLabel} updated ${quoted}${groupPart}`)
    }
    const verb =
      kind === 'settlement'
        ? 'settled'
        : kind === 'recurring_created'
          ? 'created recurring'
          : 'added'
    let payerPart = ''
    const payers = expense?.paidBy ?? []
    if (payers.length > 0) {
      const names = payers.map((payer) => payer.name).join(', ')
      const overflow =
        (expense?.paidByOverflowCount ?? 0) > 0
          ? ` +${expense?.paidByOverflowCount}`
          : ''
      payerPart = ` · Paid by ${names}${overflow}`
    }
    return withPersonal(
      `${actorLabel} ${verb} ${quoted}${amountPart}${groupPart}${payerPart}`,
    )
  }
  return withPersonal(pushBody(event))
}
