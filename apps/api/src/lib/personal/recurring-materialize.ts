import { z } from 'zod'

import { prisma, RecurringExpenseSeriesStatus, type Prisma } from '@spliit/db'
import { calculateRecurrenceDate, dateOnlyInTimeZone } from '@spliit/domain'
import {
  bossTransactionDb,
  hasDeadLetteredPersonalMaterialization,
  JOB_NAMES,
  materializationSingletonKey,
  sendJob,
  type SpliitBoss,
} from '@spliit/jobs'

import { getApiBossForWrite } from '../api/boss'
import { randomId } from '../api/shared'

export const personalRecurringMaterializeSchema = z.object({
  seriesId: z.string().min(1),
  sequence: z.number().int().positive(),
  occurrenceDate: z.string().date(),
  attemptId: z.string().min(1).optional(),
})

export type PersonalRecurringMaterializePayload = z.infer<
  typeof personalRecurringMaterializeSchema
>

export const personalRecurringReconcileSchema = z.object({
  cursor: z.string().min(1).optional(),
})

export type PersonalRecurringReconcilePayload = z.infer<
  typeof personalRecurringReconcileSchema
>

function asDateOnly(value: string): Date {
  const parsed = new Date(`${value.slice(0, 10)}T00:00:00.000Z`)
  if (Number.isNaN(parsed.getTime())) {
    throw new RangeError('Invalid occurrence date')
  }
  return parsed
}

function toIsoDay(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function isOutOfBounds(
  series: {
    endType: string
    occurrenceLimit: number | null
    endDate: Date | null
    occurrencesCreated: number
  },
  date: Date,
): boolean {
  return (
    (series.endType === 'COUNT' &&
      series.occurrenceLimit !== null &&
      series.occurrencesCreated >= series.occurrenceLimit) ||
    (series.endType === 'DATE' &&
      series.endDate !== null &&
      date.getTime() > series.endDate.getTime())
  )
}

function startAfterForNextOccurrence(
  nextDate: Date,
  timeZone: string,
  now: Date = new Date(),
): Date | undefined {
  const todayLocal = dateOnlyInTimeZone(now, timeZone)
  return nextDate.getTime() > todayLocal.getTime() ? nextDate : undefined
}

export async function enqueuePersonalRecurringMaterialization(
  tx: Prisma.TransactionClient,
  payload: { seriesId: string; sequence: number; occurrenceDate: Date },
  existingBoss?: SpliitBoss,
  startAfter?: Date,
) {
  let boss = existingBoss
  if (!boss) {
    try {
      boss = await getApiBossForWrite()
    } catch {
      return null
    }
  }
  if (!boss) return null
  const jobPayload = {
    seriesId: payload.seriesId,
    sequence: payload.sequence,
    occurrenceDate: toIsoDay(payload.occurrenceDate),
  }
  return sendJob(boss, JOB_NAMES.MATERIALIZE_PERSONAL_RECURRING, jobPayload, {
    singletonKey: materializationSingletonKey(jobPayload),
    ...(startAfter ? { startAfter } : {}),
    db: bossTransactionDb(tx),
  })
}

/** Materialize exactly one ordered personal occurrence under a series lock. */
export async function materializePersonalRecurringSeries(
  raw: PersonalRecurringMaterializePayload,
  existingBoss?: SpliitBoss,
): Promise<{ created: boolean; transactionId?: string }> {
  const payload = personalRecurringMaterializeSchema.parse(raw)
  const occurrenceDate = asDateOnly(payload.occurrenceDate)

  const snapshot = await prisma.personalRecurringSeries.findUnique({
    where: { id: payload.seriesId },
  })
  if (!snapshot) return { created: false }
  if (snapshot.status !== RecurringExpenseSeriesStatus.ACTIVE) {
    return { created: false }
  }
  // COUNT counts materialized rows, not slots: the payload sequence must equal
  // the next slot ordinal, independent of how many rows were created.
  if (snapshot.nextOccurrenceOrdinal !== payload.sequence) {
    return { created: false }
  }
  if (
    toIsoDay(snapshot.nextOccurrenceDate) !==
    payload.occurrenceDate.slice(0, 10)
  ) {
    return { created: false }
  }
  if (isOutOfBounds(snapshot, occurrenceDate)) {
    await prisma.personalRecurringSeries.updateMany({
      where: { id: snapshot.id, status: 'ACTIVE' },
      data: {
        status: RecurringExpenseSeriesStatus.COMPLETED,
        version: { increment: 1 },
      },
    })
    return { created: false }
  }
  const ordinalDate = calculateRecurrenceDate(
    snapshot.anchorDate,
    snapshot.frequency,
    snapshot.interval,
    payload.sequence,
  )
  if (toIsoDay(ordinalDate) !== payload.occurrenceDate.slice(0, 10)) {
    return { created: false }
  }
  const todayLocal = dateOnlyInTimeZone(new Date(), snapshot.timeZone)
  if (occurrenceDate.getTime() > todayLocal.getTime()) {
    return { created: false }
  }
  const snapshotVersion = snapshot.version

  return prisma.$transaction(async (tx) => {
    // Lock only the series row. Personal rows have no group/ledger locks and
    // no downstream fan-out, so a single-row lock is sufficient.
    await tx.$queryRaw`SELECT "id" FROM "PersonalRecurringSeries" WHERE "id" = ${payload.seriesId} FOR UPDATE`
    const series = await tx.personalRecurringSeries.findUnique({
      where: { id: payload.seriesId },
    })
    if (!series) return { created: false }
    // Optimistic-concurrency guard: a concurrent skip/resume/update that
    // committed between the snapshot read and the row lock must not be
    // overwritten by stale slot math.
    if (series.version !== snapshotVersion) return { created: false }
    if (series.status !== RecurringExpenseSeriesStatus.ACTIVE) {
      return { created: false }
    }
    if (series.nextOccurrenceOrdinal !== payload.sequence) {
      return { created: false }
    }
    if (
      toIsoDay(series.nextOccurrenceDate) !==
      payload.occurrenceDate.slice(0, 10)
    ) {
      return { created: false }
    }
    if (isOutOfBounds(series, occurrenceDate)) {
      await tx.personalRecurringSeries.update({
        where: { id: series.id },
        data: {
          status: RecurringExpenseSeriesStatus.COMPLETED,
          version: { increment: 1 },
        },
      })
      return { created: false }
    }
    const expected = calculateRecurrenceDate(
      series.anchorDate,
      series.frequency,
      series.interval,
      payload.sequence,
    )
    if (toIsoDay(expected) !== payload.occurrenceDate.slice(0, 10)) {
      return { created: false }
    }
    const existing = await tx.personalTransaction.findUnique({
      where: {
        personalRecurringSeriesId_recurrenceSequence: {
          personalRecurringSeriesId: payload.seriesId,
          recurrenceSequence: payload.sequence,
        },
      },
      select: { id: true },
    })
    if (existing) return { created: false, transactionId: existing.id }

    const transactionId = randomId()
    await tx.personalTransaction.create({
      data: {
        id: transactionId,
        accountId: series.accountId,
        kind: series.kind,
        amount: series.amount,
        currencyCode: series.currencyCode,
        date: occurrenceDate,
        categoryId: series.categoryId,
        title: series.title,
        note: series.note,
        version: 1,
        source: 'PERSONAL',
        personalRecurringSeriesId: series.id,
        recurrenceSequence: payload.sequence,
      },
    })

    const createdCount = series.occurrencesCreated + 1
    const nextOrdinal = series.nextOccurrenceOrdinal + 1
    const nextDate = calculateRecurrenceDate(
      series.anchorDate,
      series.frequency,
      series.interval,
      nextOrdinal,
    )
    const completed =
      (series.endType === 'COUNT' &&
        series.occurrenceLimit !== null &&
        createdCount >= series.occurrenceLimit) ||
      (series.endType === 'DATE' &&
        series.endDate !== null &&
        (occurrenceDate.getTime() >= series.endDate.getTime() ||
          nextDate.getTime() > series.endDate.getTime()))
    await tx.personalRecurringSeries.update({
      where: { id: series.id },
      data: {
        occurrencesCreated: createdCount,
        nextOccurrenceDate: nextDate,
        nextOccurrenceOrdinal: nextOrdinal,
        version: { increment: 1 },
        status: completed
          ? RecurringExpenseSeriesStatus.COMPLETED
          : RecurringExpenseSeriesStatus.ACTIVE,
      },
    })
    if (!completed) {
      await enqueuePersonalRecurringMaterialization(
        tx,
        {
          seriesId: series.id,
          sequence: nextOrdinal,
          occurrenceDate: nextDate,
        },
        existingBoss,
        startAfterForNextOccurrence(nextDate, series.timeZone),
      )
    }
    return { created: true, transactionId }
  })
}

export async function reconcileDuePersonalRecurringSeries(
  boss: SpliitBoss,
  options: { cursor?: string } = {},
): Promise<{ scanned: number; enqueued: number; nextCursor: string | null }> {
  const pageSize = 250
  const now = new Date()
  const safeHorizon = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1),
  )
  const due = await prisma.personalRecurringSeries.findMany({
    where: {
      status: RecurringExpenseSeriesStatus.ACTIVE,
      nextOccurrenceDate: { lte: safeHorizon },
    },
    ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
    take: pageSize,
    orderBy: { id: 'asc' },
    select: {
      id: true,
      occurrencesCreated: true,
      nextOccurrenceDate: true,
      nextOccurrenceOrdinal: true,
      timeZone: true,
    },
  })
  let enqueued = 0
  for (const series of due) {
    try {
      const todayLocal = dateOnlyInTimeZone(now, series.timeZone)
      if (series.nextOccurrenceDate.getTime() > todayLocal.getTime()) continue
      const sequence = series.nextOccurrenceOrdinal
      const occurrenceDate = toIsoDay(series.nextOccurrenceDate)
      const payload = { seriesId: series.id, sequence, occurrenceDate }
      if (await hasDeadLetteredPersonalMaterialization(boss, payload)) continue
      await sendJob(boss, JOB_NAMES.MATERIALIZE_PERSONAL_RECURRING, payload, {
        singletonKey: materializationSingletonKey(payload),
      })
      enqueued += 1
    } catch (error) {
      console.warn(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          level: 'warning',
          component: 'personal-recurring-reconcile',
          message: 'skipped due series, materialization enqueue failed',
          seriesId: series.id,
          error: error instanceof Error ? error.message : String(error),
        }),
      )
    }
  }
  const nextCursor =
    due.length === pageSize ? (due[due.length - 1]?.id ?? null) : null
  if (nextCursor) {
    try {
      await sendJob(
        boss,
        JOB_NAMES.RECONCILE_PERSONAL_RECURRING,
        { cursor: nextCursor },
        { singletonKey: `personal-recurring-reconciliation:${nextCursor}` },
      )
    } catch (error) {
      console.warn(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          level: 'warning',
          component: 'personal-recurring-reconcile',
          message: 'skipped reconcile continuation, enqueue failed',
          cursor: nextCursor,
          error: error instanceof Error ? error.message : String(error),
        }),
      )
    }
  }
  return { scanned: due.length, enqueued, nextCursor }
}
