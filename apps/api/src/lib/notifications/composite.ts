import type {
  ActivityNotificationDispatcher,
  ActivityNotificationEvent,
} from './types'

/**
 * Dispatch to a list of {@link ActivityNotificationDispatcher}s in
 * parallel. Each dispatcher owns its own error channel: a throw from
 * one implementation is captured and logged with `console.warn` so a
 * broken downstream (e.g. SMTP outage) never breaks another (e.g. a
 * future PushNotification writer).
 *
 * Used by the singleton `defaultActivityNotificationDispatcher` so
 * mutation call sites only ever see one dispatcher, while every
 * concrete implementation can be added or removed at registration time.
 */
export class CompositeActivityNotificationDispatcher
  implements ActivityNotificationDispatcher
{
  constructor(
    private readonly dispatchers: ReadonlyArray<ActivityNotificationDispatcher>,
  ) {}

  async dispatch(event: ActivityNotificationEvent): Promise<void> {
    await Promise.all(
      this.dispatchers.map(async (dispatcher) => {
        try {
          await dispatcher.dispatch(event)
        } catch (err) {
          console.warn(
            `[notifications] dispatcher ${dispatcher.constructor.name} failed for activity ${event.activityId}:`,
            err,
          )
        }
      }),
    )
  }
}
