import type {
  ActivityNotificationDispatcher,
  ActivityNotificationEvent,
} from './types'

/**
 * Tracks pending dispatch promises for deterministic flushing in tests.
 * Production code never reads this array; the per-promise overhead is
 * negligible.
 */
const pendingDispatches: Promise<void>[] = []

/**
 * Await all in-flight notification dispatches scheduled via
 * {@link scheduleNotificationDispatch}. Calling this between test
 * assertions makes the side-effect timing deterministic instead of
 * relying on imprecise timers.
 *
 * Safe to call when no dispatches are pending — returns immediately.
 */
export async function waitForScheduledNotificationDispatchesForTest(): Promise<void> {
  // Flush the microtask queue so any queued `run()` closures execute and
  // push their dispatch promises into the pending array.
  await Promise.resolve()
  // Flush the `.then()` chain inside `run()` so each dispatcher's
  // `dispatch()` is actually invoked and its promise settles.
  await Promise.resolve()
  // Collect and await all tracked dispatch promises.
  const promises = pendingDispatches.splice(0)
  if (promises.length > 0) {
    await Promise.all(promises)
  }
}

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
 *
 * In test environments the returned promise is tracked so that
 * {@link waitForScheduledNotificationDispatchesForTest} can await it.
 */
export function scheduleNotificationDispatch(
  dispatcher: ActivityNotificationDispatcher,
  event: ActivityNotificationEvent,
): void {
  const run = () => {
    const p = Promise.resolve()
      .then(() => dispatcher.dispatch(event))
      .catch((err) => {
        console.warn(
          `[notifications] dispatch for activity ${event.activityId} failed:`,
          err,
        )
      })
    pendingDispatches.push(p)
  }
  if (typeof queueMicrotask === 'function') {
    queueMicrotask(run)
  } else {
    setImmediate(run)
  }
}
