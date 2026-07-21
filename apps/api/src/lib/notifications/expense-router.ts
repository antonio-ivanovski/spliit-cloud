import { ExpenseEmailActivityNotificationDispatcher } from './expense-email-dispatcher'
import { ExpensePushActivityNotificationDispatcher } from './expense-push-dispatcher'
import type {
  ActivityNotificationDispatcher,
  ActivityNotificationEvent,
} from './types'

/**
 * Phase 1 channel policy: expense activity is attempted via push first, then
 * the email adapter sends only to accounts without a live push subscription.
 * Import summaries remain email-only. This seam can later resolve per-user
 * preferences without changing activity producers.
 */
export class ExpenseActivityNotificationRouter implements ActivityNotificationDispatcher {
  constructor(
    private readonly push = new ExpensePushActivityNotificationDispatcher(),
    private readonly email = new ExpenseEmailActivityNotificationDispatcher(),
  ) {}

  async dispatch(event: ActivityNotificationEvent): Promise<void> {
    if (event.type === 'EXPENSES_IMPORTED') {
      await this.email.dispatch(event)
      return
    }
    try {
      await this.push.dispatch(event)
    } catch (error) {
      // Push is an optional channel in Phase 1; an adapter failure must not
      // suppress the email fallback for the same activity.
      console.warn(
        `[notifications] push routing failed for activity ${event.activityId}:`,
        error,
      )
    }
    await this.email.dispatch(event)
  }
}
