import webpush from 'web-push'
import { env } from '../env'

export type StoredPushSubscription = {
  id: string
  endpoint: string
  p256dh: string
  auth: string
}

export type PushNotificationPayload = {
  version: 1
  kind: 'expense' | 'activity'
  activityId: string
  title: string
  body: string
  url: string
  tag?: string
}

export const isPushConfigured = Boolean(
  env.PUSH_VAPID_PUBLIC_KEY &&
  env.PUSH_VAPID_PRIVATE_KEY &&
  env.PUSH_VAPID_SUBJECT,
)

if (isPushConfigured) {
  webpush.setVapidDetails(
    env.PUSH_VAPID_SUBJECT!,
    env.PUSH_VAPID_PUBLIC_KEY!,
    env.PUSH_VAPID_PRIVATE_KEY!,
  )
}

export const pushVapidPublicKey = env.PUSH_VAPID_PUBLIC_KEY ?? null

export function isPermanentPushError(error: unknown): boolean {
  const statusCode = (error as { statusCode?: number } | null)?.statusCode
  return statusCode === 404 || statusCode === 410
}

export async function sendPushNotification(
  subscription: Pick<StoredPushSubscription, 'endpoint' | 'p256dh' | 'auth'>,
  payload: PushNotificationPayload,
): Promise<void> {
  if (!isPushConfigured) {
    throw new Error('Web Push is not configured')
  }
  await webpush.sendNotification(
    {
      endpoint: subscription.endpoint,
      keys: { p256dh: subscription.p256dh, auth: subscription.auth },
    },
    JSON.stringify(payload),
    { TTL: 60, urgency: 'normal' },
  )
}
