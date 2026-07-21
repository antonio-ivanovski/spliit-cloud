import * as z from 'zod'
import type { ActivityType } from './activities/types'

/** Stable channel identifiers persisted in account preferences and delivery intents. */
export const NotificationChannel = {
  EMAIL: 'EMAIL',
  PUSH: 'PUSH',
} as const

export type NotificationChannel =
  (typeof NotificationChannel)[keyof typeof NotificationChannel]

export const notificationChannelValues = [
  NotificationChannel.EMAIL,
  NotificationChannel.PUSH,
] as const
export const NOTIFICATION_CHANNELS = notificationChannelValues

/** User-facing preference rows. Rows are account-scoped and sparse. */
export const NotificationCategory = {
  GROUP_INVITE_RECEIVED: 'GROUP_INVITE_RECEIVED',
  FRIEND_ADDED: 'FRIEND_ADDED',
  EXPENSE_CREATED: 'EXPENSE_CREATED',
  EXPENSE_CHANGED: 'EXPENSE_CHANGED',
  // Reserved rows; no producers are currently registered for these types.
  EXPENSE_COMMENT: 'EXPENSE_COMMENT',
  WEEKLY_SUMMARY: 'WEEKLY_SUMMARY',
  PRODUCT_UPDATES: 'PRODUCT_UPDATES',
} as const

export type NotificationCategory =
  (typeof NotificationCategory)[keyof typeof NotificationCategory]

export const notificationCategoryValues = [
  NotificationCategory.GROUP_INVITE_RECEIVED,
  NotificationCategory.FRIEND_ADDED,
  NotificationCategory.EXPENSE_CREATED,
  NotificationCategory.EXPENSE_CHANGED,
  NotificationCategory.EXPENSE_COMMENT,
  NotificationCategory.WEEKLY_SUMMARY,
  NotificationCategory.PRODUCT_UPDATES,
] as const
export const NOTIFICATION_CATEGORIES = notificationCategoryValues

/** Categories with active producers and writable user preferences. */
export const ACTIVE_NOTIFICATION_CATEGORIES = [
  NotificationCategory.GROUP_INVITE_RECEIVED,
  NotificationCategory.FRIEND_ADDED,
  NotificationCategory.EXPENSE_CREATED,
  NotificationCategory.EXPENSE_CHANGED,
] as const

/** Account defaults stay durable until the user explicitly opts into Push. */
export const DEFAULT_NOTIFICATION_CHANNELS: Readonly<
  Record<NotificationCategory, readonly NotificationChannel[]>
> = {
  [NotificationCategory.GROUP_INVITE_RECEIVED]: [NotificationChannel.EMAIL],
  [NotificationCategory.FRIEND_ADDED]: [NotificationChannel.EMAIL],
  [NotificationCategory.EXPENSE_CREATED]: [NotificationChannel.EMAIL],
  [NotificationCategory.EXPENSE_CHANGED]: [NotificationChannel.EMAIL],
  [NotificationCategory.EXPENSE_COMMENT]: [NotificationChannel.EMAIL],
  [NotificationCategory.WEEKLY_SUMMARY]: [NotificationChannel.EMAIL],
  [NotificationCategory.PRODUCT_UPDATES]: [NotificationChannel.EMAIL],
}

export const defaultNotificationChannels = DEFAULT_NOTIFICATION_CHANNELS

export const RECOMMENDED_NOTIFICATION_CHANNELS: Readonly<
  Record<NotificationCategory, readonly NotificationChannel[]>
> = {
  [NotificationCategory.GROUP_INVITE_RECEIVED]: [
    NotificationChannel.EMAIL,
    NotificationChannel.PUSH,
  ],
  [NotificationCategory.FRIEND_ADDED]: [
    NotificationChannel.EMAIL,
    NotificationChannel.PUSH,
  ],
  [NotificationCategory.EXPENSE_CREATED]: [NotificationChannel.PUSH],
  [NotificationCategory.EXPENSE_CHANGED]: [NotificationChannel.PUSH],
  [NotificationCategory.EXPENSE_COMMENT]: [NotificationChannel.PUSH],
  [NotificationCategory.WEEKLY_SUMMARY]: [NotificationChannel.EMAIL],
  [NotificationCategory.PRODUCT_UPDATES]: [NotificationChannel.EMAIL],
}

export const recommendedNotificationChannels = RECOMMENDED_NOTIFICATION_CHANNELS

/** `hasPushTarget` is retained for call-site compatibility; explicit defaults never fall back to email. */
export function getRecommendedNotificationChannels(
  category: NotificationCategory,
  _hasPushTarget = true,
): NotificationChannel[] {
  return [...RECOMMENDED_NOTIFICATION_CHANNELS[category]]
}

export function getDefaultNotificationChannels(
  category: NotificationCategory,
): NotificationChannel[] {
  return [...DEFAULT_NOTIFICATION_CHANNELS[category]]
}

export const NotificationCategoryFamily = {
  EXPENSE: 'EXPENSE',
  GROUP: 'GROUP',
} as const

export type NotificationCategoryFamily =
  (typeof NotificationCategoryFamily)[keyof typeof NotificationCategoryFamily]

export const notificationCategoryFamily: Readonly<
  Record<NotificationCategory, NotificationCategoryFamily>
> = {
  [NotificationCategory.GROUP_INVITE_RECEIVED]:
    NotificationCategoryFamily.GROUP,
  [NotificationCategory.FRIEND_ADDED]: NotificationCategoryFamily.GROUP,
  [NotificationCategory.EXPENSE_CREATED]: NotificationCategoryFamily.EXPENSE,
  [NotificationCategory.EXPENSE_CHANGED]: NotificationCategoryFamily.EXPENSE,
  [NotificationCategory.EXPENSE_COMMENT]: NotificationCategoryFamily.EXPENSE,
  [NotificationCategory.WEEKLY_SUMMARY]: NotificationCategoryFamily.GROUP,
  [NotificationCategory.PRODUCT_UPDATES]: NotificationCategoryFamily.GROUP,
}

/** Only activity types with an active producer map to a delivery category. */
export const notificationCategoryForActivityType: Readonly<
  Partial<Record<ActivityType, NotificationCategory>>
> = {
  EXPENSE_CREATED: NotificationCategory.EXPENSE_CREATED,
  EXPENSE_UPDATED: NotificationCategory.EXPENSE_CHANGED,
  EXPENSE_DELETED: NotificationCategory.EXPENSE_CHANGED,
  EXPENSES_IMPORTED: NotificationCategory.EXPENSE_CREATED,
  EXPENSE_CATEGORIES_BULK_UPDATED: NotificationCategory.EXPENSE_CHANGED,
  INVITATION_CREATED: NotificationCategory.GROUP_INVITE_RECEIVED,
}

export function getNotificationCategoryForActivity(
  type: ActivityType,
): NotificationCategory | undefined {
  return notificationCategoryForActivityType[type]
}

export const notificationChannelSchema = z.enum(notificationChannelValues)
export const notificationCategorySchema = z.enum(notificationCategoryValues)

/** Input guard that preserves caller order and rejects duplicate channels. */
export const notificationChannelsSchema = z
  .array(notificationChannelSchema)
  .superRefine((channels, ctx) => {
    if (new Set(channels).size !== channels.length) {
      ctx.addIssue({
        code: 'custom',
        message: 'Duplicate notification channel',
      })
    }
  })

export type NotificationChannels = z.infer<typeof notificationChannelsSchema>

/** System policy used when no account override is saved. */
export const SYSTEM_NOTIFICATION_POLICY = 'EMAIL_BY_DEFAULT' as const
