import {
  notificationCategorySchema,
  notificationChannelSchema,
} from '@spliit/domain/notifications'
import { z } from 'zod'

const channelsOutputSchema = z.array(notificationChannelSchema)

export const notificationPreferencesOutputSchema = z.object({
  systemDefault: z.literal('EMAIL_BY_DEFAULT'),
  hasExplicitPreferences: z.boolean(),
  hasPushTargets: z.boolean(),
  isPushConfigured: z.boolean(),
  categories: z.array(
    z.object({
      category: notificationCategorySchema,
      channels: channelsOutputSchema.nullable(),
      recommendedChannels: channelsOutputSchema,
      inheritedChannels: channelsOutputSchema,
      effectiveChannels: channelsOutputSchema,
    }),
  ),
})

export const pushSubscriptionOutputSchema = z.object({
  subscription: z.object({
    id: z.string(),
    endpoint: z.string(),
    updatedAt: z.date(),
  }),
})

export const pushConfigOutputSchema = z.object({
  configured: z.boolean(),
  vapidPublicKey: z.string().nullable(),
})
