import { prisma } from '@spliit/db'
import {
  NotificationChannel,
  getDefaultNotificationChannels,
} from '@spliit/domain/notifications'
import { isPushConfigured } from './push'
import type { ActivityNotificationIntent } from './types'

async function hasPushTargets(accountIds: string[]): Promise<Set<string>> {
  if (!isPushConfigured) return new Set()
  const withAccounts = await prisma.pushSubscription.findMany({
    where: { accountId: { in: accountIds } },
    select: { accountId: true },
  })
  return new Set(withAccounts.map((row) => row.accountId))
}

/** Resolve sparse account/category preferences into independent channels. */
export async function resolveNotificationChannels(
  intent: Omit<ActivityNotificationIntent, 'channels'>,
): Promise<NotificationChannel[]> {
  const result = await resolveNotificationChannelsForIntents([intent])
  return result[0] ?? []
}

export async function resolveNotificationChannelsForIntents(
  intents: ReadonlyArray<Omit<ActivityNotificationIntent, 'channels'>>,
): Promise<NotificationChannel[][]> {
  if (intents.length === 0) return []
  const accountIds = [
    ...new Set(intents.map((intent) => intent.recipientAccountId)),
  ]
  const rows = await prisma.accountNotificationPreference.findMany({
    where: { accountId: { in: accountIds } },
    select: { accountId: true, category: true, channels: true },
  })
  const pushTargets = await hasPushTargets(accountIds)
  return intents.map((intent) => {
    const accountRows = rows.filter(
      (row) => row.accountId === intent.recipientAccountId,
    )
    const explicit = accountRows.find((row) => row.category === intent.category)
    const channels = explicit?.channels ?? null
    if (channels) {
      if (
        channels.includes(NotificationChannel.PUSH) &&
        !pushTargets.has(intent.recipientAccountId)
      ) {
        console.warn(
          `[notifications] push selected but no active push target exists for account ${intent.recipientAccountId}; delivery skipped`,
        )
      }
      // Keep the resolved preference unchanged. A missing push target must not
      // silently turn an explicit PUSH choice into email delivery.
      return channels
    }
    return getDefaultNotificationChannels(
      intent.category,
      pushTargets.has(intent.recipientAccountId),
    )
  })
}
