import type {
  ActivityActorType,
  ActivityData,
  ActivitySubjectType,
  ActivityType,
} from '@spliit/domain/activities'

/**
 * Normalized event handed to every {@link ActivityNotificationDispatcher}.
 *
 * `activityId` is stable across retries and is the natural identifier
 * for future durable delivery tracking (a `NotificationDelivery` row
 * created from this event must keep the activity referenced even when
 * upstream mutators are replayed).
 *
 * `groupId` is the current accessor scope; non-group activities would
 * carry the direct ledger id in a future revision. For this change all
 * activities are scoped through a `Group` and we ship just the id.
 */
export type ActivityNotificationEvent = {
  activityId: string
  type: ActivityType
  groupId: string
  actor: { type: ActivityActorType; id: string } | null
  subject: { type: ActivitySubjectType; id: string } | null
  data: ActivityData
  occurredAt: Date
}

/**
 * Single channel for activity notifications. Implementations MUST catch
 * their own errors and treat dispatch as best-effort: the dispatch
 * scheduler (`scheduleNotificationDispatch`) calls into dispatchers
 * from a later event-loop turn without awaiting the result, so any
 * thrown error would otherwise become an uncaught rejection.
 */
export interface ActivityNotificationDispatcher {
  dispatch(event: ActivityNotificationEvent): Promise<void>
}
