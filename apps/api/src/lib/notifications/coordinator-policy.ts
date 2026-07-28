import { prisma, type Prisma } from '@spliit/db'
import {
  NotificationChannel,
  getDefaultNotificationChannels,
} from '@spliit/domain/notifications'
import { isPushConfigured } from './push'
import type { ActivityNotificationIntent } from './types'

type PolicyClient = Prisma.TransactionClient | typeof prisma

export type PushSubscriptionsByAccountId = Map<string, Array<{ id: string }>>

async function fetchPushTargets(
  accountIds: string[],
  client: PolicyClient,
): Promise<PushSubscriptionsByAccountId> {
  if (!isPushConfigured) return new Map()
  const rows = await client.pushSubscription.findMany({
    where: { accountId: { in: accountIds } },
    select: { id: true, accountId: true },
  })
  const grouped: PushSubscriptionsByAccountId = new Map()
  for (const row of rows) {
    const list = grouped.get(row.accountId) ?? []
    list.push({ id: row.id })
    grouped.set(row.accountId, list)
  }
  return grouped
}

export type ResolvedChannelPlan = {
  channels: NotificationChannel[]
  /** Push subscriptions fetched once and reused by the planner. */
  pushSubscriptionsByAccountId: PushSubscriptionsByAccountId
}

/** Resolve sparse account/category preferences into independent channels. */
export async function resolveNotificationChannels(
  intent: Omit<ActivityNotificationIntent, 'channels'>,
  client?: Prisma.TransactionClient,
): Promise<NotificationChannel[]> {
  const plan = await resolveNotificationChannelsForIntents([intent], client)
  return plan[0]?.channels ?? []
}

export async function resolveNotificationChannelsForIntents(
  intents: ReadonlyArray<Omit<ActivityNotificationIntent, 'channels'>>,
  client?: Prisma.TransactionClient,
): Promise<ResolvedChannelPlan[]> {
  if (intents.length === 0) return []
  const accountIds = [
    ...new Set(intents.map((intent) => intent.recipientAccountId)),
  ]
  const db = client ?? prisma
  const rows = await db.accountNotificationPreference.findMany({
    where: { accountId: { in: accountIds } },
    select: { accountId: true, category: true, channels: true },
  })
  const pushTargetsByAccountId = await fetchPushTargets(accountIds, db)
  return intents.map((intent) => {
    const accountRows = rows.filter(
      (row) => row.accountId === intent.recipientAccountId,
    )
    const explicit = accountRows.find((row) => row.category === intent.category)
    const channels = explicit?.channels ?? null
    const hasPush = pushTargetsByAccountId.has(intent.recipientAccountId)
    let resolved: NotificationChannel[]
    if (channels) {
      if (channels.includes(NotificationChannel.PUSH) && !hasPush) {
        console.warn(
          `[notifications] push selected but no active push target exists for account ${intent.recipientAccountId}; delivery skipped`,
        )
      }
      // Keep the resolved preference unchanged. A missing push target must not
      // silently turn an explicit PUSH choice into email delivery.
      resolved = channels
    } else {
      resolved = getDefaultNotificationChannels(intent.category, hasPush)
    }
    return {
      channels: resolved,
      pushSubscriptionsByAccountId: pushTargetsByAccountId,
    }
  })
}
