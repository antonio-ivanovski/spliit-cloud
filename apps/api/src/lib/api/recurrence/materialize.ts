import { prisma, RecurringExpenseSeriesStatus } from '@spliit/db'
import {
  calculateRecurrenceDate,
  type RecurringExpenseTemplate,
} from '@spliit/domain'
import type { SpliitBoss } from '@spliit/jobs'
import { resolveConversion } from '../../expense-conversion'
import { buildExpenseActivityData, logActivity } from '../activities'
import { randomId } from '../shared'
import { enqueueMaterialization } from './series-ops'
import { endReached, occurrenceExpenseData } from './template'

export type MaterializationPayload = {
  seriesId: string
  sequence: number
  occurrenceDate: string
}

export type RecurringCatchUpBatch = {
  id: string
  startDate: string
  count: number
  mode?: 'INITIAL_CREATION'
  /** Immutable cutoff date (ISO) set when the batch opens. Later jobs
   * use this instead of recomputing today, preventing midnight-crossing
   * from absorbing occurrences that were not due when the batch began. */
  dueThrough?: string
}

function recurringTemplateParticipantIds(template: RecurringExpenseTemplate) {
  return [
    ...template.paidByList.map((row) => row.ledgerParticipantId),
    ...template.paidFor.map((row) => row.ledgerParticipantId),
    ...template.items.flatMap((item) =>
      item.paidFor.map((row) => row.ledgerParticipantId),
    ),
    ...(template.itemizedRemainder?.paidFor.map(
      (row) => row.ledgerParticipantId,
    ) ?? []),
  ].filter((id, index, ids) => id && ids.indexOf(id) === index)
}

export type MaterializationResult = {
  created: boolean
  expenseId?: string
  activityId?: string
  groupId?: string
  title?: string
  amount?: number
  currencyCode?: string | null
  date?: string
  actor?: { type: 'ACCOUNT' | 'SYSTEM'; id: string }
  /** Exact activity payload/time persisted with the occurrence. */
  activityData?: ReturnType<typeof buildExpenseActivityData>
  activityTime?: Date
  /** Metadata used by the worker to coalesce overdue creation notifications. */
  recurringSeriesId?: string
  recurrenceSequence?: number
  nextOccurrenceDate?: string
  seriesStatus?: RecurringExpenseSeriesStatus
  suppressNotification?: boolean
  catchUpSummary?: {
    count: number
    startDate: string
    endDate: string
    affectedParticipants: string[]
    /** Series identifier for combined creation summaries. */
    seriesId?: string
    /** Human-renderable cadence fields. */
    frequency?: string
    interval?: number
    endType?: string
    occurrenceLimit?: number | null
    seriesEndDate?: string | null
    /** INITIAL_CREATION for past-dated schedule creation summaries. */
    mode?: 'INITIAL_CREATION'
  }
}

export function parseCatchUpBatch(
  value: unknown,
): RecurringCatchUpBatch | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Partial<RecurringCatchUpBatch>
  return typeof row.id === 'string' &&
    typeof row.startDate === 'string' &&
    typeof row.count === 'number' &&
    Number.isInteger(row.count) &&
    row.count >= 0
    ? {
        id: row.id,
        startDate: row.startDate,
        count: row.count,
        mode: row.mode === 'INITIAL_CREATION' ? 'INITIAL_CREATION' : undefined,
        dueThrough:
          typeof row.dueThrough === 'string' ? row.dueThrough : undefined,
      }
    : null
}

export function utcTodayDate(): Date {
  const now = new Date()
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  )
}

export function asDate(value: string) {
  const parsed = new Date(`${value.slice(0, 10)}T00:00:00.000Z`)
  if (Number.isNaN(parsed.getTime()))
    throw new RangeError('Invalid occurrence date')
  return parsed
}

/** Materialize exactly one ordered occurrence under a series row lock. */
export async function materializeRecurringExpense(
  payload: MaterializationPayload,
  existingBoss?: SpliitBoss,
): Promise<MaterializationResult> {
  const occurrenceDate = asDate(payload.occurrenceDate)
  const snapshot = await prisma.recurringExpenseSeries.findUnique({
    where: { id: payload.seriesId },
    include: { ledger: { include: { group: true } } },
  })
  if (!snapshot || !snapshot.ledger.group) return { created: false }
  if (snapshot.status !== RecurringExpenseSeriesStatus.ACTIVE)
    return { created: false }
  if (snapshot.occurrencesCreated + 1 !== payload.sequence)
    return { created: false }
  if (
    snapshot.nextOccurrenceDate.toISOString().slice(0, 10) !==
    payload.occurrenceDate.slice(0, 10)
  )
    return { created: false }
  if (
    snapshot.endType === 'COUNT' &&
    snapshot.occurrenceLimit !== null &&
    payload.sequence > snapshot.occurrenceLimit
  )
    return { created: false }
  if (
    snapshot.endType === 'DATE' &&
    snapshot.endDate !== null &&
    occurrenceDate > snapshot.endDate
  )
    return { created: false }
  const snapshotTemplate =
    snapshot.template as unknown as RecurringExpenseTemplate
  const conversion = await resolveConversion(
    {
      amount: snapshotTemplate.amount,
      conversion:
        snapshotTemplate.conversionSource === 'CUSTOM'
          ? {
              type: 'custom',
              currency: snapshotTemplate.originalCurrency ?? '',
              rate: snapshotTemplate.conversionRate ?? 1,
            }
          : snapshotTemplate.conversionSource === 'EXCHANGE'
            ? {
                type: 'exchange',
                currency: snapshotTemplate.originalCurrency ?? '',
              }
            : undefined,
    },
    {
      ledgerCurrency: snapshot.ledger.currencyCode ?? null,
      expenseDate: occurrenceDate,
    },
  )
  return prisma.$transaction(async (tx) => {
    // Archive mutations take the group lock before touching a series. Keep
    // this order identical here so an occurrence cannot slip in after the
    // archive balance check but before the series is paused.
    await tx.$queryRaw`
      SELECT g."id"
      FROM "RecurringExpenseSeries" AS s
      JOIN "Ledger" AS l ON l."id" = s."ledgerId"
      JOIN "Group" AS g ON g."ledgerId" = l."id"
      WHERE s."id" = ${payload.seriesId}
      FOR UPDATE OF g
    `
    await tx.$queryRaw`SELECT id FROM "RecurringExpenseSeries" WHERE id = ${payload.seriesId} FOR UPDATE`
    const series = await tx.recurringExpenseSeries.findUnique({
      where: { id: payload.seriesId },
      include: { ledger: { include: { group: true } } },
    })
    if (!series || !series.ledger.group) return { created: false }
    if (series.version !== snapshot.version) return { created: false }
    const existing = await tx.expense.findUnique({
      where: {
        recurringSeriesId_recurrenceSequence: {
          recurringSeriesId: payload.seriesId,
          recurrenceSequence: payload.sequence,
        },
      },
      select: { id: true },
    })
    if (existing) return { created: false, expenseId: existing.id }
    if (series.status !== RecurringExpenseSeriesStatus.ACTIVE)
      return { created: false }
    if (series.occurrencesCreated + 1 !== payload.sequence)
      return { created: false }
    if (
      series.nextOccurrenceDate.toISOString().slice(0, 10) !==
      payload.occurrenceDate.slice(0, 10)
    )
      return { created: false }
    if (
      series.endType === 'COUNT' &&
      series.occurrenceLimit !== null &&
      payload.sequence > series.occurrenceLimit
    ) {
      await tx.recurringExpenseSeries.update({
        where: { id: series.id },
        data: { status: RecurringExpenseSeriesStatus.COMPLETED },
      })
      return { created: false }
    }
    if (
      series.endType === 'DATE' &&
      series.endDate !== null &&
      occurrenceDate > series.endDate
    ) {
      await tx.recurringExpenseSeries.update({
        where: { id: series.id },
        data: { status: RecurringExpenseSeriesStatus.COMPLETED },
      })
      return { created: false }
    }
    const ordinal = series.nextOccurrenceOrdinal
    const expectedDate = calculateRecurrenceDate(
      series.anchorDate,
      series.frequency,
      series.interval,
      ordinal,
    )
    if (
      expectedDate.toISOString().slice(0, 10) !==
      payload.occurrenceDate.slice(0, 10)
    )
      return { created: false }
    if (series.ledger.group.archived) {
      await tx.recurringExpenseSeries.update({
        where: { id: series.id },
        data: {
          status: RecurringExpenseSeriesStatus.PAUSED,
          catchUpBatch: null,
          version: { increment: 1 },
        },
      })
      return { created: false }
    }

    const nextOrdinal = ordinal + 1
    const nextDate = calculateRecurrenceDate(
      series.anchorDate,
      series.frequency,
      series.interval,
      nextOrdinal,
    )
    const date = occurrenceDate.toISOString().slice(0, 10)
    const today = utcTodayDate()
    const storedBatch = parseCatchUpBatch(series.catchUpBatch)
    // Use the persisted boundary when the batch is already open;
    // otherwise compute today. This prevents a UTC-midnight crossing
    // from absorbing extra occurrences into an in-flight batch.
    const cutoff = storedBatch?.dueThrough
      ? asDate(storedBatch.dueThrough)
      : today
    // Only open a batch when there will be at least one more occurrence
    // after this one. If the series terminates after this occurrence
    // (COUNT reached or nextDate beyond endDate), don't suppress — let
    // the single occurrence notify normally.
    const willHaveNext =
      !endReached(series, payload.sequence, occurrenceDate) &&
      !(
        series.endType === 'DATE' &&
        series.endDate !== null &&
        nextDate > series.endDate
      )
    const startsBatch =
      !storedBatch &&
      occurrenceDate <= cutoff &&
      nextDate <= cutoff &&
      willHaveNext
    const batch =
      storedBatch ??
      (startsBatch
        ? {
            id: `recurring-catchup:${series.id}:${date}`,
            startDate: date,
            count: 0,
            dueThrough: cutoff.toISOString().slice(0, 10),
          }
        : null)
    const batchCount = batch ? batch.count + 1 : 0

    const template = snapshotTemplate
    const expenseId = randomId()
    const expense = await tx.expense.create({
      data: {
        ...occurrenceExpenseData(
          template,
          occurrenceDate,
          expenseId,
          series.id,
          payload.sequence,
          conversion.ledgerAmountMinor,
          conversion,
        ),
        ledgerId: series.ledgerId,
      },
    })
    const actor = series.creatorAccountId
      ? { type: 'ACCOUNT' as const, id: series.creatorAccountId }
      : { type: 'SYSTEM' as const, id: 'system' }
    const activityData = buildExpenseActivityData({
      summary: expense.title,
      title: expense.title,
      amount: expense.amount,
      currencyCode: conversion.originalCurrency,
      date,
      originalAmount: conversion.originalAmount ?? undefined,
      conversionRate: conversion.conversionRate ?? undefined,
      conversionSource: conversion.conversionSource,
      ledgerCurrencyCode: series.ledger.currencyCode ?? null,
      recurrence: {
        seriesId: series.id,
        frequency: series.frequency,
        interval: series.interval,
        endType: series.endType,
        occurrenceLimit: series.occurrenceLimit,
        endDate: series.endDate
          ? series.endDate.toISOString().slice(0, 10)
          : null,
      },
    })
    const activity = await logActivity(
      series.ledger.group.id,
      {
        type: 'RECURRING_EXPENSE_CREATED',
        actor,
        subject: { type: 'EXPENSE', id: expense.id },
        data: activityData,
      },
      tx,
    )
    const nextSequence = payload.sequence + 1
    const completed =
      endReached(series, payload.sequence, occurrenceDate) ||
      (series.endType === 'DATE' &&
        series.endDate !== null &&
        nextDate > series.endDate)
    await tx.recurringExpenseSeries.update({
      where: { id: series.id },
      data: {
        occurrencesCreated: payload.sequence,
        nextOccurrenceDate: nextDate,
        nextOccurrenceOrdinal: nextOrdinal,
        version: { increment: 1 },
        status: completed
          ? RecurringExpenseSeriesStatus.COMPLETED
          : RecurringExpenseSeriesStatus.ACTIVE,
        catchUpBatch:
          batch && !completed && nextDate <= cutoff
            ? { ...batch, count: batchCount }
            : null,
      },
    })
    if (!completed) {
      await enqueueMaterialization(
        tx,
        {
          seriesId: series.id,
          sequence: nextSequence,
          occurrenceDate: nextDate,
        },
        existingBoss,
      )
    }
    return {
      created: true,
      expenseId: expense.id,
      activityId: activity.id,
      groupId: series.ledger.group.id,
      title: expense.title,
      amount: expense.amount,
      currencyCode: conversion.originalCurrency,
      date,
      actor,
      activityData,
      activityTime: activity.time,
      recurringSeriesId: series.id,
      recurrenceSequence: payload.sequence,
      nextOccurrenceDate: nextDate.toISOString().slice(0, 10),
      seriesStatus: completed
        ? RecurringExpenseSeriesStatus.COMPLETED
        : RecurringExpenseSeriesStatus.ACTIVE,
      suppressNotification: batch !== null,
      catchUpSummary:
        batch && batchCount >= 2 && (completed || nextDate > cutoff)
          ? {
              count: batchCount,
              startDate: batch.startDate,
              endDate: date,
              affectedParticipants: recurringTemplateParticipantIds(template),
              seriesId: series.id,
              frequency: series.frequency,
              interval: series.interval,
              endType: series.endType,
              occurrenceLimit: series.occurrenceLimit,
              seriesEndDate: series.endDate
                ? series.endDate.toISOString().slice(0, 10)
                : null,
              mode: batch.mode,
            }
          : undefined,
    }
  })
}
