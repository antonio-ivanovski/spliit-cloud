import type {
  ActivityNotificationDispatcher,
  ActivityNotificationEvent,
} from './types'

/**
 * Hand the event to the dispatcher on a later loop turn so the calling
 * mutation can return to the client before delivery starts.
 *
 * - Microtask scheduling is preferred: it runs before the next macrotask
 *   so the mutation's transaction commit and the dispatch start are
 *   separated by at most a turn, which keeps integration tests that
 *   assert on the singleton dispatcher deterministic.
 * - The dispatcher contract already documents best-effort delivery, but
 *   this helper also wraps the call in `try`/`catch` so an unforeseen
 *   throw becomes a `console.warn` instead of an uncaught promise
 *   rejection.
 *
 * The helper intentionally does NOT await the dispatch — call sites can
 * fire-and-forget after their transaction commits.
 */
export function scheduleNotificationDispatch(
  dispatcher: ActivityNotificationDispatcher,
  event: ActivityNotificationEvent,
): void {
  const run = () => {
    Promise.resolve()
      .then(() => dispatcher.dispatch(event))
      .catch((err) => {
        console.warn(
          `[notifications] dispatch for activity ${event.activityId} failed:`,
          err,
        )
      })
  }
  if (typeof queueMicrotask === 'function') {
    queueMicrotask(run)
  } else {
    setImmediate(run)
  }
}
