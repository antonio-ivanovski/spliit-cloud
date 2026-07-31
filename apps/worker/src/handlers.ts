import {
  materializeRecurringExpense,
  reconcileDueRecurringExpenses,
} from '@spliit/api/lib/api/recurrence-series'
import { evaluateBudgets } from '@spliit/api/lib/budgets/evaluate'
import { runNotificationCleanup } from '@spliit/api/lib/notifications/delivery-cleanup'
import { reconcileMissingDeliveryJobs } from '@spliit/api/lib/notifications/delivery-reconciliation'
import { JOB_NAMES, sendJob, type JobHandlers } from '@spliit/jobs'

import { handleNotificationDelivery } from './notification-delivery'

export const handlers: JobHandlers = {
  [JOB_NAMES.MATERIALIZE_RECURRING_EXPENSE]: async (payload, context) => {
    await materializeRecurringExpense(payload, context.boss)
  },
  [JOB_NAMES.RECONCILE_RECURRING_EXPENSES]: async (payload, context) => {
    await reconcileDueRecurringExpenses(context.boss, payload)
  },
  [JOB_NAMES.NOTIFICATION_DELIVER]: async (payload, context) => {
    await handleNotificationDelivery(payload.deliveryId, context)
  },
  [JOB_NAMES.NOTIFICATION_RECONCILE]: async (payload, context) => {
    const result = await reconcileMissingDeliveryJobs(context.boss, {
      cursor: payload.cursor ?? null,
    })
    console.log(
      JSON.stringify({
        component: 'notification-reconciliation',
        reconciled: result.reconciled,
        scanned: result.scanned,
      }),
    )
    if (result.nextCursor) {
      await sendJob(context.boss, JOB_NAMES.NOTIFICATION_RECONCILE, {
        cursor: result.nextCursor,
      })
    }
  },
  [JOB_NAMES.NOTIFICATION_CLEANUP]: async (_payload, _context) => {
    const result = await runNotificationCleanup()
    console.log(
      JSON.stringify({
        component: 'notification-cleanup',
        sentDeleted: result.sentDeleted,
        failedDeleted: result.failedDeleted,
      }),
    )
  },
  [JOB_NAMES.EVALUATE_BUDGETS]: async (payload, context) => {
    const results = await evaluateBudgets(payload.groupId, context.boss)
    console.log(
      JSON.stringify({
        component: 'budget-evaluation',
        evaluated: results.length,
      }),
    )
  },
}
