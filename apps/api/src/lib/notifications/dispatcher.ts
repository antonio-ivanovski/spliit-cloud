import type {
  ActivityActorType,
  ActivityData,
  ActivitySubjectType,
} from '@spliit/domain/activities'
import {
  getNotificationCategoryForActivity,
  type NotificationCategory,
} from '@spliit/domain/notifications'

import { CompositeActivityNotificationDispatcher } from './composite'
import { ActivityNotificationCoordinator } from './coordinator'
import {
  scheduleNotificationDispatch,
  waitForScheduledNotificationDispatchesForTest,
} from './schedule'
import type {
  ActivityNotificationDispatcher,
  ActivityNotificationEvent,
} from './types'

export { CompositeActivityNotificationDispatcher } from './composite'
export { ActivityNotificationCoordinator } from './coordinator'
export { ExpenseActivityHandler, GroupActivityHandler } from './handlers'
export { scheduleNotificationDispatch } from './schedule'
export type {
  ActivityNotificationChannelDispatcher,
  ActivityNotificationDispatcher,
  ActivityNotificationEvent,
  ActivityNotificationIntent,
  NotificationCategory,
  NotificationChannel,
} from './types'
export { waitForScheduledNotificationDispatchesForTest }

/**
 * Register the production coordinator in the process-wide dispatcher. Kept for
 * backward compatibility with existing integration tests that flush
 * microtask-dispatched events. Production uses the durable planner ({@link
 * planActivityNotificationDeliveries}) instead.
 *
 * @deprecated Use {@link planActivityNotificationDeliveries} for production
 *   paths.
 */
export function initializeDefaultNotificationDispatchers(): void {
  setDefaultActivityNotificationDispatchers([
    new ActivityNotificationCoordinator(),
  ])
}

/**
 * Process-wide composite dispatcher. Only used by legacy microtask-based
 * dispatch via {@link scheduleDefaultNotificationDispatch} and
 * {@link scheduleTargetedNotificationDispatch}.
 *
 * Production notification delivery flows through
 * {@link planActivityNotificationDeliveries} which persists NotificationDelivery
 * rows and enqueues pg-boss jobs for the worker.
 *
 * Kept for backward compatibility with integration tests that still flush
 * dispatches via {@link waitForScheduledNotificationDispatchesForTest}.
 */
const registered: ActivityNotificationDispatcher[] = []

let singleton: ActivityNotificationDispatcher =
  new CompositeActivityNotificationDispatcher(registered)

/**
 * Read-only access to the singleton. Mutation call sites import this and call
 * `dispatch(event)` themselves; helpers such as
 * {@link scheduleDefaultNotificationDispatch} defer the actual dispatch.
 */
export function getDefaultActivityNotificationDispatcher(): ActivityNotificationDispatcher {
  return singleton
}

/**
 * Replace the dispatcher list. Intended for tests; production code never needs
 * to call this. The new dispatcher is wrapped in a fresh composite over the
 * supplied list.
 */
export function setDefaultActivityNotificationDispatchers(
  dispatchers: ReadonlyArray<ActivityNotificationDispatcher>,
): void {
  while (registered.length > 0) registered.pop()
  for (const d of dispatchers) registered.push(d)
  singleton = new CompositeActivityNotificationDispatcher([...registered])
}

/**
 * Convenience wrapper: schedule dispatch on the singleton dispatcher.
 *
 * @deprecated Production paths use {@link planActivityNotificationDeliveries}
 * which persists NotificationDelivery rows and enqueues pg-boss jobs.
 * This function and {@link scheduleTargetedNotificationDispatch} are kept
 * only for backward compatibility with integration tests.
 */
export function scheduleDefaultNotificationDispatch(
  event: ActivityNotificationEvent,
): void {
  // Skip events for activity types without an active producer; the
  // ActivityNotificationCoordinator would drop them anyway. Events with an
  // explicit `notificationCategory` (friend-added via
  // `scheduleTargetedNotificationDispatch`) always flow through.
  if (
    !event.notificationCategory &&
    !getNotificationCategoryForActivity(event.type)
  ) {
    return
  }
  scheduleNotificationDispatch(singleton, event)
}

/**
 * Schedule a non-activity notification with the same composed coordinator.
 *
 * @deprecated Kept only for backward compatibility with integration tests.
 * Production paths use {@link planActivityNotificationDeliveries}.
 */
export function scheduleTargetedNotificationDispatch(args: {
  activityId: string
  groupId: string
  category: NotificationCategory
  recipientAccountId: string
  actor?: { type: ActivityActorType; id: string }
  subject?: { type: ActivitySubjectType; id: string }
  data: ActivityData
  occurredAt?: Date
}): void {
  scheduleDefaultNotificationDispatch({
    activityId: args.activityId,
    // The activity type is only a compatibility discriminator for existing
    // channel dispatchers; the explicit category is authoritative.
    type: 'INVITATION_CREATED',
    groupId: args.groupId,
    actor: args.actor ?? null,
    subject: args.subject ?? null,
    data: args.data,
    occurredAt: args.occurredAt ?? new Date(),
    notificationCategory: args.category,
    recipientAccountId: args.recipientAccountId,
  })
}
