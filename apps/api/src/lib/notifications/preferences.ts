import { prisma } from '@spliit/db'
import {
  NotificationChannel,
  SYSTEM_NOTIFICATION_POLICY,
  getRecommendedNotificationChannels,
  notificationCategorySchema,
  notificationCategoryValues,
  notificationChannelsSchema,
  type NotificationCategory,
} from '@spliit/domain/notifications'
import { z } from 'zod'
import { randomId } from '../api/shared'
import { isPushConfigured } from './push'

export const preferenceCategories = notificationCategoryValues

export const preferenceInputSchema = z
  .object({
    preferences: z.array(
      z.object({
        category: notificationCategorySchema,
        channels: notificationChannelsSchema.nullable(),
      }),
    ),
  })
  .superRefine((input, ctx) => {
    const seen = new Set<string>()
    input.preferences.forEach((preference, index) => {
      if (seen.has(preference.category)) {
        ctx.addIssue({
          code: 'custom',
          path: ['preferences', index, 'category'],
          message: 'Duplicate category',
        })
      }
      seen.add(preference.category)
    })
  })

export type PreferenceInput = z.infer<typeof preferenceInputSchema>
export const SYSTEM_DEFAULT = SYSTEM_NOTIFICATION_POLICY

export function effectiveChannels(
  explicit: readonly NotificationChannel[] | null,
  recommended: readonly NotificationChannel[],
): NotificationChannel[] {
  return [...(explicit ?? recommended)]
}

export async function getNotificationPreferences(accountId: string) {
  const [rows, pushCount] = await Promise.all([
    prisma.accountNotificationPreference.findMany({
      where: { accountId },
      select: { category: true, channels: true },
    }),
    prisma.pushSubscription.count({ where: { accountId } }),
  ])
  const byCategory = new Map(rows.map((row) => [row.category, row.channels]))
  return {
    systemDefault: SYSTEM_DEFAULT,
    hasPushTargets: pushCount > 0,
    isPushConfigured,
    categories: preferenceCategories.map((category) => {
      const channels = byCategory.get(category) ?? null
      const recommendedChannels = getRecommendedNotificationChannels(category)
      return {
        category,
        channels,
        recommendedChannels,
        inheritedChannels: [...recommendedChannels],
        effectiveChannels: effectiveChannels(channels, recommendedChannels),
      }
    }),
  }
}

/** Apply only supplied categories. Null removes the row and restores defaults. */
export async function saveNotificationPreferences(
  accountId: string,
  input: PreferenceInput,
) {
  await prisma.$transaction(async (tx) => {
    for (const preference of input.preferences) {
      if (preference.channels === null) {
        await tx.accountNotificationPreference.deleteMany({
          where: { accountId, category: preference.category },
        })
        continue
      }
      await tx.accountNotificationPreference.upsert({
        where: {
          accountId_category: {
            accountId,
            category: preference.category,
          },
        },
        create: {
          id: randomId(),
          accountId,
          category: preference.category,
          channels: preference.channels,
        },
        update: { channels: preference.channels },
      })
    }
  })
  return getNotificationPreferences(accountId)
}

export async function removeEmailPreference(
  accountId: string,
  category: NotificationCategory,
) {
  const row = await prisma.accountNotificationPreference.findUnique({
    where: { accountId_category: { accountId, category } },
    select: { channels: true },
  })
  const current = row?.channels ?? getRecommendedNotificationChannels(category)
  const channels = current.filter(
    (channel): channel is NotificationChannel =>
      channel !== NotificationChannel.EMAIL,
  )
  return saveNotificationPreferences(accountId, {
    preferences: [{ category, channels }],
  })
}
