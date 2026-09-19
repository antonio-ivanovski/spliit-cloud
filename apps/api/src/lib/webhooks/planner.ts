import type { Activity, Prisma } from '@spliit/db'
import {
  WebhookApiVersion,
  deriveViewer,
  webhookEnvelopeSchema,
  type WebhookExpenseOperation,
  type WebhookExpenseSnapshot,
} from '@spliit/domain/webhooks'
import {
  JOB_NAMES,
  bossTransactionDb,
  insertJobs,
  type SpliitBoss,
} from '@spliit/jobs'

import { randomId } from '../api/shared'
import { loadExpenseSnapshot, loadExpenseSnapshotsChunked } from './snapshot'

type Client = Prisma.TransactionClient

export type { WebhookExpenseOperation }

function filterColumnForOperation(operation: WebhookExpenseOperation) {
  switch (operation) {
    case 'created':
      return { notifyCreated: true } as const
    case 'updated':
      return { notifyUpdated: true } as const
    case 'deleted':
      return { notifyDeleted: true } as const
  }
}

type EligibleEndpoint = {
  id: string
  accountId: string
  involvedOnly: boolean
}

async function eligibleEndpoints(
  tx: Client,
  groupId: string,
  operation?: WebhookExpenseOperation,
): Promise<EligibleEndpoint[]> {
  const endpoints = await tx.webhookEndpoint.findMany({
    where: {
      enabled: true,
      ...(operation ? filterColumnForOperation(operation) : {}),
      account: {
        isAnonymous: false,
        emailVerified: true,
        groupMemberships: {
          some: { groupId, status: 'ACTIVE' },
        },
      },
    },
    select: { id: true, accountId: true, involvedOnly: true },
  })
  return endpoints ?? []
}

/**
 * Drops involved-only endpoints whose owner has no financial stake in the
 * snapshot. Pure function of the already-loaded snapshot — no extra queries.
 */
function filterInvolvedEndpoints(
  endpoints: EligibleEndpoint[],
  snapshots: WebhookExpenseSnapshot[],
): EligibleEndpoint[] {
  return endpoints.filter(
    (endpoint) =>
      !endpoint.involvedOnly ||
      snapshots.some(
        (snapshot) => deriveViewer(snapshot, endpoint.accountId).involved,
      ),
  )
}

export async function hasEligibleWebhookEndpoints(
  tx: Client,
  groupId: string,
  operation?: WebhookExpenseOperation,
): Promise<boolean> {
  return (await eligibleEndpoints(tx, groupId, operation)).length > 0
}

async function groupAndActor(
  tx: Client,
  groupId: string,
  actorAccountId: string | null,
) {
  const [group, actor] = await Promise.all([
    tx.group.findUnique({
      where: { id: groupId },
      select: { id: true, name: true, groupType: true },
    }),
    actorAccountId
      ? tx.user.findUnique({
          where: { id: actorAccountId },
          select: { id: true, name: true },
        })
      : null,
  ])
  if (!group) throw new Error('Cannot create webhook event without a group')
  return {
    group: { id: group.id, name: group.name, type: group.groupType },
    actor: actor
      ? { type: 'account' as const, id: actor.id, name: actor.name }
      : { type: 'system' as const, id: null, name: null },
  }
}

async function persistEvent(args: {
  tx: Client
  boss: SpliitBoss | null
  sourceKey: string
  type: string
  groupId: string
  activityId?: string | null
  occurredAt: Date
  payload: Prisma.InputJsonValue
  allowAfterDelete?: boolean
  eventId: string
  endpointIds?: string[]
}): Promise<string | null> {
  const endpointIds =
    args.endpointIds ??
    (await eligibleEndpoints(args.tx, args.groupId)).map(({ id }) => id)
  if (endpointIds.length === 0) return null

  await args.tx.webhookEvent.create({
    data: {
      id: args.eventId,
      sourceKey: args.sourceKey,
      type: args.type,
      apiVersion: WebhookApiVersion,
      occurredAt: args.occurredAt,
      payload: args.payload,
      groupId: args.groupId,
      activityId: args.activityId ?? null,
      allowAfterDelete: args.allowAfterDelete ?? false,
    },
  })
  const deliveries = endpointIds.map((endpointId) => ({
    id: randomId(),
    endpointId,
    eventId: args.eventId,
  }))
  await args.tx.webhookDelivery.createMany({ data: deliveries })
  if (args.boss) {
    await insertJobs(
      args.boss,
      JOB_NAMES.WEBHOOK_DELIVER,
      deliveries.map(({ id }) => ({ deliveryId: id })),
      { db: bossTransactionDb(args.tx) },
    )
  }
  return args.eventId
}

export async function planExpenseWebhook(args: {
  tx: Client
  boss: SpliitBoss | null
  activity: Activity
  groupId: string
  operation: WebhookExpenseOperation
  expenseSnapshot?: WebhookExpenseSnapshot
  changedFields?: string[]
}): Promise<string | null> {
  const endpoints = await eligibleEndpoints(
    args.tx,
    args.groupId,
    args.operation,
  )
  if (endpoints.length === 0) return null
  const snapshot =
    args.expenseSnapshot ??
    (args.activity.subjectId
      ? await loadExpenseSnapshot(args.tx, args.activity.subjectId)
      : null)
  if (!snapshot) return null
  const endpointIds = filterInvolvedEndpoints(endpoints, [snapshot]).map(
    ({ id }) => id,
  )
  if (endpointIds.length === 0) return null
  const identity = await groupAndActor(
    args.tx,
    args.groupId,
    args.activity.actorType === 'ACCOUNT' ? args.activity.actorId : null,
  )
  const id = randomId()
  const type = `expense.${args.operation}` as const
  const envelope = webhookEnvelopeSchema.parse({
    id,
    apiVersion: WebhookApiVersion,
    type,
    occurredAt: args.activity.time.toISOString(),
    data: {
      ...identity,
      expense: snapshot,
      changedFields: args.changedFields ?? [],
    },
  })
  return persistEvent({
    tx: args.tx,
    boss: args.boss,
    sourceKey: `activity:${args.activity.id}:webhook-v1`,
    type,
    groupId: args.groupId,
    activityId: args.activity.id,
    occurredAt: args.activity.time,
    payload: envelope as unknown as Prisma.InputJsonValue,
    eventId: id,
    endpointIds,
  })
}

export async function planExpenseBatchWebhook(args: {
  tx: Client
  boss: SpliitBoss | null
  sourceKey: string
  activityId?: string | null
  groupId: string
  actorAccountId: string | null
  operation: WebhookExpenseOperation
  source: string
  occurredAt: Date
  expenses: Array<{
    expense: WebhookExpenseSnapshot
    changedFields?: string[]
  }>
  allowAfterDelete?: boolean
}): Promise<string | null> {
  if (args.expenses.length === 0) return null
  const endpoints = await eligibleEndpoints(
    args.tx,
    args.groupId,
    args.operation,
  )
  if (endpoints.length === 0) return null
  const endpointIds = filterInvolvedEndpoints(
    endpoints,
    args.expenses.map((row) => row.expense),
  ).map(({ id }) => id)
  if (endpointIds.length === 0) return null
  const identity = await groupAndActor(
    args.tx,
    args.groupId,
    args.actorAccountId,
  )
  const id = randomId()
  const type = `expenses.${args.operation}` as const
  const envelope = webhookEnvelopeSchema.parse({
    id,
    apiVersion: WebhookApiVersion,
    type,
    occurredAt: args.occurredAt.toISOString(),
    data: {
      ...identity,
      batchId: id,
      source: args.source,
      expenses: args.expenses.map((row) => ({
        expense: row.expense,
        changedFields: row.changedFields ?? [],
      })),
    },
  })
  return persistEvent({
    tx: args.tx,
    boss: args.boss,
    sourceKey: args.sourceKey,
    type,
    groupId: args.groupId,
    activityId: args.activityId ?? null,
    occurredAt: args.occurredAt,
    payload: envelope as unknown as Prisma.InputJsonValue,
    allowAfterDelete: args.allowAfterDelete,
    eventId: id,
    endpointIds,
  })
}

export async function planSettlementWebhookBatch(args: {
  tx: Client
  boss: SpliitBoss | null
  groupId: string
  actorAccountId: string
  source: string
  settlements: Array<{
    expenseId: string
    activity: Pick<Activity, 'id' | 'time'>
  }>
}): Promise<string | null> {
  if (args.settlements.length === 0) return null
  if (!(await hasEligibleWebhookEndpoints(args.tx, args.groupId, 'created')))
    return null
  const expenses = (
    await loadExpenseSnapshotsChunked(
      args.tx,
      args.settlements.map(({ expenseId }) => expenseId),
    )
  ).map((expense) => ({ expense }))
  const first = args.settlements[0]!
  return planExpenseBatchWebhook({
    tx: args.tx,
    boss: args.boss,
    sourceKey: `activity:${first.activity.id}:webhook-settlements-v1`,
    activityId: first.activity.id,
    groupId: args.groupId,
    actorAccountId: args.actorAccountId,
    operation: 'created',
    source: args.source,
    occurredAt: first.activity.time,
    expenses,
  })
}
