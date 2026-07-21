import {
  NotificationCategoryFamily,
  notificationCategoryFamily,
  NotificationChannel,
} from '@spliit/domain/notifications'
import { resolveNotificationChannelsForIntents } from './coordinator-policy'
import { ExpenseEmailActivityNotificationDispatcher } from './expense-email-dispatcher'
import { ExpensePushActivityNotificationDispatcher } from './expense-push-dispatcher'
import { GroupEmailActivityNotificationDispatcher } from './group-email-dispatcher'
import { GroupPushActivityNotificationDispatcher } from './group-push-dispatcher'
import { defaultActivityHandlers, type ActivityHandler } from './handlers'
import type {
  ActivityNotificationChannelDispatcher,
  ActivityNotificationDispatcher,
  ActivityNotificationEvent,
  ActivityNotificationIntent,
} from './types'

export class ActivityNotificationCoordinator implements ActivityNotificationDispatcher {
  private readonly handlers: ReadonlyArray<ActivityHandler>
  private readonly channels: Readonly<
    Record<NotificationChannel, ActivityNotificationChannelDispatcher>
  >

  constructor(args?: {
    handlers?: ReadonlyArray<ActivityHandler>
    email?: ActivityNotificationChannelDispatcher
    push?: ActivityNotificationChannelDispatcher
  }) {
    this.handlers = args?.handlers ?? defaultActivityHandlers()
    this.channels = {
      [NotificationChannel.EMAIL]: args?.email ?? new RoutedEmailDispatcher(),
      [NotificationChannel.PUSH]: args?.push ?? new RoutedPushDispatcher(),
    }
  }

  async dispatch(event: ActivityNotificationEvent): Promise<void> {
    const handler = this.handlers.find((candidate) =>
      candidate.supports(event.type),
    )
    if (!handler) return
    const baseIntents = await handler.buildIntents(event)
    const channelPlans =
      await resolveNotificationChannelsForIntents(baseIntents)
    await Promise.all(
      baseIntents.map(async (baseIntent, index) => {
        const channels = channelPlans[index] ?? []
        const intent: ActivityNotificationIntent = { ...baseIntent, channels }
        await Promise.all(
          channels.map(async (channel) => {
            try {
              await this.channels[channel].dispatch(intent)
            } catch (error) {
              console.warn(
                `[notifications] ${channel.toLowerCase()} delivery failed for activity ${event.activityId}:`,
                error,
              )
            }
          }),
        )
      }),
    )
  }
}

class RoutedEmailDispatcher implements ActivityNotificationChannelDispatcher {
  private readonly expense = new ExpenseEmailActivityNotificationDispatcher()
  private readonly group = new GroupEmailActivityNotificationDispatcher()

  async dispatch(intent: ActivityNotificationIntent): Promise<void> {
    if (
      notificationCategoryFamily[intent.category] ===
      NotificationCategoryFamily.EXPENSE
    ) {
      await this.expense.dispatch(intent)
    } else {
      await this.group.dispatch(intent)
    }
  }
}

class RoutedPushDispatcher implements ActivityNotificationChannelDispatcher {
  private readonly expense = new ExpensePushActivityNotificationDispatcher()
  private readonly group = new GroupPushActivityNotificationDispatcher()

  async dispatch(intent: ActivityNotificationIntent): Promise<void> {
    if (
      notificationCategoryFamily[intent.category] ===
      NotificationCategoryFamily.EXPENSE
    ) {
      await this.expense.dispatch(intent)
    } else {
      await this.group.dispatch(intent)
    }
  }
}
