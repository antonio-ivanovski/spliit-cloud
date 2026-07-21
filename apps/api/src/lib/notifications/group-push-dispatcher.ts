import { prisma } from '@spliit/db'
import {
  NotificationCategory,
  NotificationCategoryFamily,
  getNotificationCategoryForActivity,
  notificationCategoryFamily,
} from '@spliit/domain/notifications'
import { getWebBaseUrl } from '../auth/urls'
import {
  isPermanentPushError,
  sendPushNotification,
  type PushNotificationPayload,
} from './push'
import type {
  ActivityNotificationChannelDispatcher,
  ActivityNotificationIntent,
} from './types'

export class GroupPushActivityNotificationDispatcher implements ActivityNotificationChannelDispatcher {
  async dispatch(intent: ActivityNotificationIntent): Promise<void> {
    if (
      (intent.activity.notificationCategory ??
        getNotificationCategoryForActivity(intent.activity.type)) !==
      intent.category
    )
      return
    if (
      notificationCategoryFamily[intent.category] !==
      NotificationCategoryFamily.GROUP
    )
      return
    const subscriptions = await prisma.pushSubscription.findMany({
      where: { accountId: intent.recipientAccountId },
      select: { id: true, endpoint: true, p256dh: true, auth: true },
    })
    const isFriendAdded = intent.category === NotificationCategory.FRIEND_ADDED
    const payload: PushNotificationPayload = {
      version: 1,
      kind: 'activity',
      activityId: intent.activity.activityId,
      title: isFriendAdded ? 'New friend ledger' : 'Group activity',
      body: isFriendAdded
        ? 'A friend ledger is ready in Spliit Cloud.'
        : 'Your group has new activity.',
      url: `${getWebBaseUrl()}/groups/${intent.activity.groupId}`,
      tag: `activity:${intent.activity.activityId}`,
    }
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
              `[notifications] failed to send group push for activity ${intent.activity.activityId}:`,
              error,
            )
          }
        }
      }),
    )
  }
}
