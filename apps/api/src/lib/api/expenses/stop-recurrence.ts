import { prisma } from '@spliit/db'

import { logActivity, planNotificationForActivity } from '../activities'
import { getApiBoss } from '../boss'
import { getExpense } from './queries'

/**
 * Stop a recurring series without deleting any already-materialized expenses.
 * The series row is the concurrency boundary; queued jobs will observe the
 * cancelled status and reconciliation will no longer enqueue work. Records a
 * RECURRING_EXPENSE_STOPPED activity and dispatches through EXPENSE_CHANGED.
 */
export async function stopRecurrence(
  groupId: string,
  expenseId: string,
  actor: { accountId: string },
): Promise<void> {
  const existingExpense = await getExpense(groupId, expenseId)
  if (!existingExpense) throw new Error(`Invalid expense ID: ${expenseId}`)
  if (!existingExpense.recurringSeriesId) {
    throw new Error('Expense is not part of a recurring series')
  }
  const seriesId = existingExpense.recurringSeriesId

  const boss = await getApiBoss()
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "RecurringExpenseSeries" WHERE id = ${seriesId} FOR UPDATE`
    const series = await tx.recurringExpenseSeries.findUnique({
      where: { id: seriesId },
      select: {
        status: true,
        frequency: true,
        interval: true,
        endType: true,
        occurrenceLimit: true,
        endDate: true,
        template: true,
      },
    })
    if (!series) throw new Error('Recurring series not found')
    // No-op cleanly if already terminal; no new activity or notification.
    if (series.status === 'CANCELLED' || series.status === 'COMPLETED') {
      return { activity: null }
    }
    await tx.recurringExpenseSeries.update({
      where: { id: seriesId },
      data: {
        status: 'CANCELLED',
        version: { increment: 1 },
        catchUpBatch: null,
      },
    })
    // Derive affected participants from the template for recipient selection.
    const template = series.template as unknown as {
      paidByList?: Array<{ ledgerParticipantId: string }>
      paidFor?: Array<{ ledgerParticipantId: string }>
      items?: Array<{
        paidFor: Array<{ ledgerParticipantId: string }>
      }>
      itemizedRemainder?: {
        paidFor: Array<{ ledgerParticipantId: string }>
      } | null
    } | null
    const affectedParticipants = template
      ? [
          ...(template.paidByList?.map((p) => p.ledgerParticipantId) ?? []),
          ...(template.paidFor?.map((p) => p.ledgerParticipantId) ?? []),
          ...(template.items?.flatMap((item) =>
            item.paidFor.map((p) => p.ledgerParticipantId),
          ) ?? []),
          ...(template.itemizedRemainder?.paidFor.map(
            (p) => p.ledgerParticipantId,
          ) ?? []),
        ].filter((id, index, ids) => id && ids.indexOf(id) === index)
      : []

    const activity = await logActivity(
      groupId,
      {
        type: 'RECURRING_EXPENSE_STOPPED',
        actor: { type: 'ACCOUNT', id: actor.accountId },
        subject: { type: 'EXPENSE', id: expenseId },
        data: {
          kind: 'recurring_expense_stopped',
          summary: existingExpense.title,
          seriesId,
          expenseId,
          title: existingExpense.title,
          frequency: series.frequency,
          interval: series.interval,
          endType: series.endType,
          occurrenceLimit: series.occurrenceLimit,
          endDate: series.endDate
            ? series.endDate.toISOString().slice(0, 10)
            : null,
          affectedParticipants,
        },
      },
      tx,
    )

    await planNotificationForActivity(tx, activity, {}, { boss })
    return { activity }
  })
}
