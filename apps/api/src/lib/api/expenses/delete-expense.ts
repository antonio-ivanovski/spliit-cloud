import { prisma } from '@spliit/db'
import { deleteS3Object } from '../../../routes/upload'
import {
  buildExpenseActivityData,
  logActivity,
  planNotificationForActivity,
} from '../activities'
import { getApiBoss } from '../boss'
import { getAffectedParticipantIds } from '../expense-activity-diff'
import { toExpenseDomainShape } from './helpers'
import { getExpense } from './queries'

export async function deleteExpense(
  groupId: string,
  expenseId: string,
  actor: { accountId: string },
  options?: {
    scope?: 'OCCURRENCE' | 'THIS_AND_FUTURE'
    /** For THIS_AND_FUTURE, also cancel the series after deleting rows. */
    stopRecurrence?: boolean
  },
) {
  const existingExpense = await getExpense(groupId, expenseId)
  if (!existingExpense) throw new Error(`Invalid expense ID: ${expenseId}`)

  const group = await prisma.group.findUnique({
    where: { id: groupId },
    select: { ledger: { select: { currencyCode: true } } },
  })

  const affectedParticipantIds = [
    ...getAffectedParticipantIds({
      oldExpense: toExpenseDomainShape(existingExpense),
    }),
  ]

  const expenseDateStr = existingExpense.expenseDate.toISOString().slice(0, 10)

  if (
    options?.stopRecurrence !== undefined &&
    options.scope !== 'THIS_AND_FUTURE'
  ) {
    throw new Error(
      'stopRecurrence is only valid with THIS_AND_FUTURE deletion scope',
    )
  }
  if (
    options?.scope === 'THIS_AND_FUTURE' &&
    !existingExpense.recurringSeriesId
  ) {
    throw new Error('THIS_AND_FUTURE deletion requires a recurring expense')
  }

  const boss = await getApiBoss()
  const { documentUrls } = await prisma.$transaction(async (tx) => {
    if (existingExpense.recurringSeriesId) {
      await tx.$queryRaw`SELECT id FROM "RecurringExpenseSeries" WHERE id = ${existingExpense.recurringSeriesId} FOR UPDATE`
    }

    let stopAct: Awaited<ReturnType<typeof logActivity>> | null = null
    type DeleteSeriesSummary = {
      status: string
      frequency: string
      interval: number
      endType: string
      occurrenceLimit: number | null
      endDate: Date | null
    } | null
    let series: DeleteSeriesSummary = null

    // Snapshot all affected rows before deletion so we can log
    // individual activities and compute the participant union.
    let snapshotRows: Array<{
      id: string
      title: string
      amount: number
      expenseDate: Date
      originalCurrency: string | null
      originalAmount: number | null
      conversionRate: number | null
      conversionSource: string | null
      documentUrls: string[]
      participantIds?: string[]
    }> = [
      {
        id: expenseId,
        title: existingExpense.title,
        amount: existingExpense.amount,
        expenseDate: existingExpense.expenseDate,
        originalCurrency: existingExpense.originalCurrency ?? null,
        originalAmount: existingExpense.originalAmount ?? null,
        conversionRate: existingExpense.conversionRate
          ? Number(existingExpense.conversionRate)
          : null,
        conversionSource: existingExpense.conversionSource,
        documentUrls: existingExpense.documents.map((d) => d.url),
        participantIds: affectedParticipantIds,
      },
    ]

    if (
      options?.scope === 'THIS_AND_FUTURE' &&
      existingExpense.recurringSeriesId &&
      existingExpense.recurrenceSequence
    ) {
      const futureRows = await tx.expense.findMany({
        where: {
          ledgerId: existingExpense.ledgerId,
          recurringSeriesId: existingExpense.recurringSeriesId,
          recurrenceSequence: { gte: existingExpense.recurrenceSequence },
        },
        select: {
          id: true,
          expenseDate: true,
          title: true,
          amount: true,
          originalAmount: true,
          originalCurrency: true,
          conversionRate: true,
          conversionSource: true,
          paidByList: { select: { ledgerParticipantId: true } },
          paidFor: { select: { ledgerParticipantId: true } },
          items: {
            select: { paidFor: { select: { ledgerParticipantId: true } } },
          },
          itemizedRemainder: {
            select: { paidFor: { select: { ledgerParticipantId: true } } },
          },
          documents: { select: { url: true } },
        },
        orderBy: { recurrenceSequence: 'asc' },
      })
      snapshotRows = futureRows.map(
        ({
          paidByList,
          paidFor,
          items,
          itemizedRemainder,
          documents,
          ...r
        }) => {
          const rowParticipants = new Set<string>()
          for (const pb of paidByList)
            rowParticipants.add(pb.ledgerParticipantId)
          for (const pf of paidFor) rowParticipants.add(pf.ledgerParticipantId)
          if (items) {
            for (const item of items) {
              if (item.paidFor) {
                for (const ipf of item.paidFor)
                  rowParticipants.add(ipf.ledgerParticipantId)
              }
            }
          }
          if (itemizedRemainder?.paidFor) {
            for (const rpf of itemizedRemainder.paidFor)
              rowParticipants.add(rpf.ledgerParticipantId)
          }
          return {
            ...r,
            conversionRate: r.conversionRate ? Number(r.conversionRate) : null,
            documentUrls: documents.map((d) => d.url),
            participantIds: [...rowParticipants],
          }
        },
      )
    }

    // Log one EXPENSE_DELETED activity per affected row.
    const loggedActivities: Awaited<ReturnType<typeof logActivity>>[] = []
    const unionParticipantIds: string[] = affectedParticipantIds.slice()
    for (const row of snapshotRows) {
      const rowDateStr = row.expenseDate.toISOString().slice(0, 10)
      // Compute affected participants per row from the snapshot.
      const rowParticipants = row.participantIds ?? []
      // Add to union for the summary.
      for (const pid of rowParticipants) {
        if (!unionParticipantIds.includes(pid)) unionParticipantIds.push(pid)
      }
      const act = await logActivity(
        groupId,
        {
          type: 'EXPENSE_DELETED',
          actor: { type: 'ACCOUNT', id: actor.accountId },
          subject: { type: 'EXPENSE', id: row.id },
          data: buildExpenseActivityData({
            summary: row.title,
            title: row.title,
            amount: row.amount,
            currencyCode: row.originalCurrency ?? null,
            date: rowDateStr,
            affectedParticipants: rowParticipants,
            originalAmount: row.originalAmount ?? undefined,
            conversionRate: row.conversionRate
              ? Number(row.conversionRate)
              : undefined,
            conversionSource: row.conversionSource as
              'EXCHANGE' | 'CUSTOM' | null,
            ledgerCurrencyCode: group?.ledger.currencyCode ?? null,
          }),
        },
        tx,
      )
      loggedActivities.push(act)
    }

    // Build date range for summary.
    const sortedDates = snapshotRows
      .map((r) => r.expenseDate)
      .sort((a, b) => a.getTime() - b.getTime())
    const summaryDateRange = {
      startDate: sortedDates[0]?.toISOString().slice(0, 10) ?? expenseDateStr,
      endDate: sortedDates.at(-1)?.toISOString().slice(0, 10) ?? expenseDateStr,
    }

    if (
      options?.scope === 'THIS_AND_FUTURE' &&
      existingExpense.recurringSeriesId &&
      existingExpense.recurrenceSequence
    ) {
      series = await tx.recurringExpenseSeries.findUnique({
        where: { id: existingExpense.recurringSeriesId },
        select: {
          status: true,
          frequency: true,
          interval: true,
          endType: true,
          occurrenceLimit: true,
          endDate: true,
        },
      })
      const shouldStop =
        options.stopRecurrence &&
        series &&
        series.status !== 'CANCELLED' &&
        series.status !== 'COMPLETED'

      await tx.expense.deleteMany({
        where: {
          ledgerId: existingExpense.ledgerId,
          recurringSeriesId: existingExpense.recurringSeriesId,
          recurrenceSequence: { gte: existingExpense.recurrenceSequence },
        },
      })
      await tx.recurringExpenseSeries.update({
        where: { id: existingExpense.recurringSeriesId },
        data: {
          version: { increment: 1 },
          catchUpBatch: null,
          ...(shouldStop ? { status: 'CANCELLED' as const } : {}),
        },
      })

      if (shouldStop && series) {
        stopAct = await logActivity(
          groupId,
          {
            type: 'RECURRING_EXPENSE_STOPPED',
            actor: { type: 'ACCOUNT', id: actor.accountId },
            subject: { type: 'EXPENSE', id: expenseId },
            data: {
              kind: 'recurring_expense_stopped',
              summary: existingExpense.title,
              seriesId: existingExpense.recurringSeriesId,
              expenseId,
              title: existingExpense.title,
              frequency: series.frequency,
              interval: series.interval,
              endType: series.endType,
              occurrenceLimit: series.occurrenceLimit,
              endDate: series.endDate
                ? series.endDate.toISOString().slice(0, 10)
                : null,
              affectedParticipants: affectedParticipantIds,
            },
          },
          tx,
        )
      }
    } else {
      await tx.expense.deleteMany({
        where: { id: expenseId, ledgerId: existingExpense.ledgerId },
      })
    }

    if (loggedActivities.length === 1) {
      await planNotificationForActivity(
        tx,
        loggedActivities[0]!,
        {
          data: buildExpenseActivityData({
            summary: existingExpense.title,
            title: existingExpense.title,
            amount: existingExpense.amount,
            currencyCode: existingExpense.originalCurrency ?? null,
            date: expenseDateStr,
            affectedParticipants: affectedParticipantIds,
            originalAmount: existingExpense.originalAmount ?? undefined,
            conversionRate: existingExpense.conversionRate
              ? Number(existingExpense.conversionRate)
              : undefined,
            conversionSource: existingExpense.conversionSource,
            ledgerCurrencyCode: group?.ledger.currencyCode ?? null,
            ...(stopAct ? { stopped: true } : {}),
          }),
        },
        { boss },
      )
    } else if (loggedActivities.length >= 2) {
      const primaryActivity = loggedActivities[0]!
      await planNotificationForActivity(
        tx,
        primaryActivity,
        {
          subject: null,
          data: {
            kind: 'recurring_expense_summary',
            title: existingExpense.title,
            count: loggedActivities.length,
            startDate: summaryDateRange.startDate,
            endDate: summaryDateRange.endDate,
            affectedParticipants: unionParticipantIds,
            seriesId: existingExpense.recurringSeriesId ?? undefined,
            frequency: series?.frequency ?? undefined,
            interval: series?.interval ?? undefined,
            endType: series?.endType ?? undefined,
            occurrenceLimit: series?.occurrenceLimit ?? undefined,
            seriesEndDate: series?.endDate
              ? series.endDate.toISOString().slice(0, 10)
              : undefined,
            operation: 'delete',
            stopped: stopAct != null,
          },
        },
        { boss },
      )
    }

    return {
      stopActivity: stopAct,
      dateRange: summaryDateRange,
      unionParticipantIds,
      seriesCadence: series
        ? {
            frequency: series.frequency,
            interval: series.interval,
            endType: series.endType,
            occurrenceLimit: series.occurrenceLimit,
            seriesEndDate: series.endDate
              ? series.endDate.toISOString().slice(0, 10)
              : null,
          }
        : null,
      documentUrls: snapshotRows.flatMap((r) => r.documentUrls),
    }
  })

  // Best-effort S3 cleanup — errors are logged but not propagated.
  // `documentUrls` covers every deleted row (selected + later occurrences),
  // so attachments on future occurrences do not leak.
  for (const url of documentUrls) {
    try {
      await deleteS3Object(url)
    } catch (err) {
      console.warn(`[expenses] failed to delete S3 object ${url}:`, err)
    }
  }
}
