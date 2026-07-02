import { CompositeActivityNotificationDispatcher } from './composite'
import { scheduleNotificationDispatch } from './schedule'
import type {
  ActivityNotificationDispatcher,
  ActivityNotificationEvent,
} from './types'

export { CompositeActivityNotificationDispatcher } from './composite'
export { scheduleNotificationDispatch } from './schedule'
export type {
  ActivityNotificationDispatcher,
  ActivityNotificationEvent,
} from './types'

/**
 * Process-wide dispatcher used by expense create/update/delete
 * mutations. Phase 4 will register an expense email dispatcher here;
 * the array starts empty so any pre-Phase-4 activity fires no-op
 * dispatch.
 *
 * Held in a mutable array (not exported) so the singleton can be
 * appended to at module-load time without exposing mutation
 * primitives; tests can replace the singleton via
 * {@link setDefaultActivityNotificationDispatchers}.
 */
const registered: ActivityNotificationDispatcher[] = []

let singleton: ActivityNotificationDispatcher = new CompositeActivityNotificationDispatcher(
  registered,
)

/**
 * Read-only access to the singleton. Mutation call sites import this
 * and call `dispatch(event)` themselves; helpers such as
 * {@link scheduleDefaultNotificationDispatch} defer the actual dispatch.
 */
export function getDefaultActivityNotificationDispatcher(): ActivityNotificationDispatcher {
  return singleton
}

/**
 * Replace the dispatcher list. Intended for tests; production code
 * never needs to call this. The new dispatcher is wrapped in a fresh
 * composite over the supplied list.
 */
export function setDefaultActivityNotificationDispatchers(
  dispatchers: ReadonlyArray<ActivityNotificationDispatcher>,
): void {
  while (registered.length > 0) registered.pop()
  for (const d of dispatchers) registered.push(d)
  singleton = new CompositeActivityNotificationDispatcher(registered)
}

/**
 * Convenience wrapper: schedule dispatch on the singleton dispatcher.
 * Mirrors {@link scheduleNotificationDispatch} but uses the default
 * singleton so call sites do not need to thread the dispatcher through
 * every helper signature.
 */
export function scheduleDefaultNotificationDispatch(
  event: ActivityNotificationEvent,
): void {
  scheduleNotificationDispatch(singleton, event)
}
