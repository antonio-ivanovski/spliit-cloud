import {
  materializeRecurringExpense,
  reconcileDueRecurringExpenses,
} from '@spliit/api/lib/api/recurrence-series'
import { scheduleDefaultNotificationDispatch } from '@spliit/api/lib/notifications/dispatcher'
import type { JobHandlers } from '@spliit/jobs'
import { JOB_NAMES } from '@spliit/jobs'

/**
 * Business handlers are registered here by the owning feature. Keeping the
 * worker bootstrap independent lets future jobs share the same lifecycle.
 */
export const handlers: JobHandlers = {
  [JOB_NAMES.MATERIALIZE_RECURRING_EXPENSE]: async (payload, context) => {
    const result = await materializeRecurringExpense(payload, context.boss)
    if (
      result.created &&
      result.activityId &&
      result.groupId &&
      result.expenseId &&
      result.activityData &&
      result.activityTime
    ) {
      if (!result.suppressNotification) {
        scheduleDefaultNotificationDispatch({
          activityId: result.activityId,
          type: 'RECURRING_EXPENSE_CREATED',
          groupId: result.groupId,
          actor: result.actor ?? { type: 'SYSTEM', id: 'system' },
          subject: { type: 'EXPENSE', id: result.expenseId },
          data: result.activityData,
          occurredAt: result.activityTime,
          includeActorAsRecipient: true,
        })
      }
      if (result.catchUpSummary) {
        const summaryActivityId = `recurring-catchup-summary:${result.recurringSeriesId}:${result.catchUpSummary.startDate}:${result.catchUpSummary.endDate}`
        scheduleDefaultNotificationDispatch({
          activityId: summaryActivityId,
          type: 'RECURRING_EXPENSE_CREATED',
          groupId: result.groupId,
          actor: result.actor ?? { type: 'SYSTEM', id: 'system' },
          subject: null,
          data: {
            kind: 'recurring_expense_summary',
            title: result.title,
            count: result.catchUpSummary.count,
            startDate: result.catchUpSummary.startDate,
            endDate: result.catchUpSummary.endDate,
            affectedParticipants: result.catchUpSummary.affectedParticipants,
            seriesId: result.catchUpSummary.seriesId,
            frequency: result.catchUpSummary.frequency,
            interval: result.catchUpSummary.interval,
            endType: result.catchUpSummary.endType,
            occurrenceLimit: result.catchUpSummary.occurrenceLimit,
            seriesEndDate: result.catchUpSummary.seriesEndDate,
            operation: 'create',
          },
          occurredAt: result.activityTime,
          includeActorAsRecipient: true,
        })
      }
    }
  },
  [JOB_NAMES.RECONCILE_RECURRING_EXPENSES]: async (payload, context) => {
    await reconcileDueRecurringExpenses(context.boss, payload)
  },
}
