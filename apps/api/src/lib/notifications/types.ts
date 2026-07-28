import type {
  ActivityActorType,
  ActivityData,
  ActivitySubjectType,
  ActivityType,
} from '@spliit/domain/activities'
import type {
  NotificationCategory,
  NotificationChannel,
} from '@spliit/domain/notifications'

export {
  NotificationCategory,
  NotificationChannel,
} from '@spliit/domain/notifications'

/**
 * Discriminated identity for a notification event.
 *
 * - Real events carry a non-null `activityId` (the Activity row FK) and may
 *   optionally override the deduplication key with `customEventKey`.
 * - Synthetic events (no Activity row) set `activityId: null` and MUST provide a
 *   `customEventKey` so the planner never falls back to the shared,
 *   collision-prone `activity:` key.
 */
export type EventIdentity =
  | { activityId: string; customEventKey?: string }
  | { activityId: null; customEventKey: string }

/**
 * Normalized event handed to every {@link ActivityNotificationDispatcher}.
 *
 * `groupId` is the current accessor scope; non-group activities would carry the
 * direct ledger id in a future revision. For this change all activities are
 * scoped through a `Group` and we ship just the id.
 */
export type ActivityNotificationEvent = EventIdentity & {
  type: ActivityType
  groupId: string
  actor: { type: ActivityActorType; id: string } | null
  subject: { type: ActivitySubjectType; id: string } | null
  data: ActivityData
  occurredAt: Date
  notificationCategory?: NotificationCategory
  includeActorAsRecipient?: boolean
  recipientAccountId?: string
}

/** A single recipient's canonical delivery intent. */
export type ActivityNotificationIntent = {
  activity: ActivityNotificationEvent
  category: NotificationCategory
  recipientAccountId: string
  channels: ReadonlyArray<NotificationChannel>
}

/**
 * Single channel for activity notifications. Implementations MUST catch their
 * own errors and treat dispatch as best-effort: the dispatch scheduler
 * (`scheduleNotificationDispatch`) calls into dispatchers from a later
 * event-loop turn without awaiting the result, so any thrown error would
 * otherwise become an uncaught rejection.
 */
export interface ActivityNotificationDispatcher {
  dispatch(event: ActivityNotificationEvent): Promise<void>
}

export interface ActivityNotificationChannelDispatcher {
  dispatch(intent: ActivityNotificationIntent): Promise<void>
}
