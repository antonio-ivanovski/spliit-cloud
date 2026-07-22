import {
  prisma,
  RecurrenceEndType,
  RecurrenceFrequency,
  RecurringExpenseSeriesStatus,
  type Prisma,
} from '@spliit/db'
import {
  calculateRecurrenceDate,
  recurrenceConfigSchema,
  validateRecurrenceConfig,
  type RecurrenceConfig,
  type RecurringExpenseTemplate,
} from '@spliit/domain'
import {
  bossTransactionDb,
  hasDeadLetteredMaterialization,
  JOB_NAMES,
  env as jobsEnv,
  materializationSingletonKey,
  sendJob,
  startApiBoss,
  stopBoss,
  type SpliitBoss,
} from '@spliit/jobs'
import { resolveConversion } from '../expense-conversion'
import { buildExpenseActivityData, logActivity } from './activities'
import { randomId } from './shared'

let apiBossPromise: ReturnType<typeof startApiBoss> | null = null
export async function getApiBoss() {
  if (!apiBossPromise) {
    const pending = startApiBoss()
    const tracked = pending.catch((error) => {
      if (apiBossPromise === tracked) apiBossPromise = null
      throw error
    })
    apiBossPromise = tracked
  }
  return apiBossPromise
}

/** Stop the API-side enqueue client during graceful server shutdown/tests. */
export async function stopApiBoss(): Promise<void> {
  const pending = apiBossPromise
  apiBossPromise = null
  if (!pending) return
  const boss = await pending.catch(() => null)
  if (boss) await stopBoss(boss)
}

/** Accept the new config and the legacy rule during the rollout window. */
export function getExpenseRecurrence(
  expense: {
    recurrence?: unknown
    recurrenceRule?: string | null
  },
  anchorDate?: Date,
): RecurrenceConfig | null {
  const value = (expense as { recurrence?: unknown }).recurrence
  if (value != null) {
    const parsed = recurrenceConfigSchema.safeParse(value)
    if (parsed.success) return validateRecurrenceConfig(parsed.data, anchorDate)
    throw new RangeError('Invalid recurrence configuration')
  }
  const rule = expense.recurrenceRule
  if (!rule || rule === 'NONE') return null
  if (!Object.values(RecurrenceFrequency).includes(rule as never)) {
    throw new RangeError(`Unsupported recurrence rule: ${rule}`)
  }
  return validateRecurrenceConfig(
    {
      frequency: rule as RecurrenceConfig['frequency'],
      interval: 1,
      end: { type: 'INDEFINITE' },
    },
    anchorDate,
  )
}

export function toSeriesFields(config: RecurrenceConfig) {
  return {
    frequency: config.frequency,
    interval: config.interval,
    endType: config.end.type,
    occurrenceLimit: config.end.type === 'COUNT' ? config.end.count : null,
    endDate: config.end.type === 'DATE' ? config.end.endDate : null,
  } as const
}

export function buildRecurringTemplate(args: {
  expense: {
    title: string
    category: string
    amount: number
    isReimbursement: boolean
    notes?: string
    paidBySplitMode: string
    paidByList: Array<{ participant: string; shares: number }>
    splitMode: string
    paidFor: Array<{ participant: string; shares: number }>
    paidForOverride?: Array<{ participant: string; shares: number }>
    items?: Array<{
      title: string
      unitPrice: number
      quantity: number
      amount: number
      splitMode: string
      paidFor: Array<{ participant: string; shares: number }>
    }>
    itemizedRemainder?: {
      splitMode: string
      paidFor: Array<{ participant: string; shares: number }>
    }
  }
  conversion: {
    ledgerAmountMinor: number
    originalAmount: number | null
    originalCurrency: string | null
    conversionRate: number | null
    conversionSource: 'EXCHANGE' | 'CUSTOM' | null
  }
}): RecurringExpenseTemplate {
  const { expense, conversion } = args
  return {
    title: expense.title,
    categoryId: expense.category,
    // Keep entered-currency units so EXCHANGE can be resolved again per date.
    amount: conversion.originalAmount ?? expense.amount,
    originalAmount: conversion.originalAmount,
    originalCurrency: conversion.originalCurrency,
    conversionRate: conversion.conversionRate,
    conversionSource: conversion.conversionSource,
    paidBySplitMode: expense.paidBySplitMode,
    paidByList: expense.paidByList.map((p) => ({
      ledgerParticipantId: p.participant,
      shares: p.shares,
    })),
    paidFor: (expense.paidForOverride ?? expense.paidFor).map((p) => ({
      ledgerParticipantId: p.participant,
      shares: p.shares,
    })),
    splitMode: expense.splitMode,
    isReimbursement: expense.isReimbursement,
    notes: expense.notes ?? null,
    items: (expense.items ?? []).map((item) => ({
      title: item.title,
      unitPrice: item.unitPrice,
      quantity: item.quantity,
      amount: item.amount,
      splitMode: item.splitMode,
      paidFor: item.paidFor.map((p) => ({
        ledgerParticipantId: p.participant,
        shares: p.shares,
      })),
    })),
    itemizedRemainder: expense.itemizedRemainder
      ? {
          splitMode: expense.itemizedRemainder.splitMode,
          paidFor: expense.itemizedRemainder.paidFor.map((p) => ({
            ledgerParticipantId: p.participant,
            shares: p.shares,
          })),
        }
      : null,
  }
}

function endReached(
  series: {
    endType: RecurrenceEndType
    occurrenceLimit: number | null
    endDate: Date | null
  },
  sequence: number,
  date: Date,
) {
  return (
    (series.endType === RecurrenceEndType.COUNT &&
      series.occurrenceLimit !== null &&
      sequence >= series.occurrenceLimit) ||
    (series.endType === RecurrenceEndType.DATE &&
      series.endDate !== null &&
      date.getTime() >= series.endDate.getTime())
  )
}

export function initialSeriesCompleted(
  fields: {
    endType: RecurrenceEndType
    occurrenceLimit: number | null
    endDate: Date | null
  },
  anchorDate: Date,
  nextDate: Date,
) {
  return (
    endReached(fields, 1, anchorDate) ||
    (fields.endType === RecurrenceEndType.DATE &&
      fields.endDate !== null &&
      nextDate > fields.endDate)
  )
}

/** Return the earliest execution time for a date-only occurrence. */
export function recurrenceJobStartAfter(date: Date) {
  const executionDate = new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate(),
      0,
      5,
    ),
  )
  const now = new Date()
  return executionDate.getTime() <= now.getTime() ? undefined : executionDate
}

/** Enqueue through a transaction-bound pg-boss adapter, preserving atomicity. */
export async function enqueueMaterialization(
  tx: Prisma.TransactionClient,
  payload: { seriesId: string; sequence: number; occurrenceDate: Date },
  existingBoss?: SpliitBoss,
) {
  if (!jobsEnv.JOBS_ENABLED) return null
  const boss = existingBoss ?? (await getApiBoss())
  return sendJob(
    boss,
    JOB_NAMES.MATERIALIZE_RECURRING_EXPENSE,
    {
      seriesId: payload.seriesId,
      sequence: payload.sequence,
      occurrenceDate: payload.occurrenceDate.toISOString().slice(0, 10),
    },
    {
      deadLetter: `${JOB_NAMES.MATERIALIZE_RECURRING_EXPENSE}.dead-letter`,
      startAfter: recurrenceJobStartAfter(payload.occurrenceDate),
      singletonKey: materializationSingletonKey(payload),
      db: bossTransactionDb(tx),
    },
  )
}

export async function createSeriesForExpense(args: {
  tx: Prisma.TransactionClient
  seriesId: string
  ledgerId: string
  creatorAccountId: string
  anchorDate: Date
  config: RecurrenceConfig
  template: RecurringExpenseTemplate
  boss?: SpliitBoss
}) {
  const nextDate = calculateRecurrenceDate(
    args.anchorDate,
    args.config.frequency,
    args.config.interval,
    2,
  )
  const fields = toSeriesFields(args.config)
  const completed = initialSeriesCompleted(fields, args.anchorDate, nextDate)
  const series = await args.tx.recurringExpenseSeries.create({
    data: {
      id: args.seriesId,
      ledgerId: args.ledgerId,
      creatorAccountId: args.creatorAccountId,
      frequency: fields.frequency,
      interval: fields.interval,
      anchorDate: args.anchorDate,
      nextOccurrenceDate: nextDate,
      nextOccurrenceOrdinal: 2,
      endType: fields.endType,
      occurrenceLimit: fields.occurrenceLimit,
      endDate: fields.endDate,
      occurrencesCreated: 1,
      status: completed
        ? RecurringExpenseSeriesStatus.COMPLETED
        : RecurringExpenseSeriesStatus.ACTIVE,
      template: args.template,
    },
  })
  if (!completed) {
    await enqueueMaterialization(
      args.tx,
      {
        seriesId: series.id,
        sequence: 2,
        occurrenceDate: nextDate,
      },
      args.boss,
    )
  }
  return series
}

export function occurrenceExpenseData(
  template: RecurringExpenseTemplate,
  date: Date,
  id: string,
  seriesId: string,
  sequence: number,
  amount: number,
  conversion?: {
    conversionRate: number | null
    originalAmount: number | null
    originalCurrency: string | null
    conversionSource: 'EXCHANGE' | 'CUSTOM' | null
  },
) {
  return {
    id,
    expenseDate: date,
    recurringSeriesId: seriesId,
    recurrenceSequence: sequence,
    categoryId: template.categoryId,
    amount,
    originalAmount: conversion?.originalAmount ?? template.originalAmount,
    originalCurrency: conversion?.originalCurrency ?? template.originalCurrency,
    conversionRate: conversion?.conversionRate ?? template.conversionRate,
    conversionSource: conversion?.conversionSource ?? template.conversionSource,
    title: template.title,
    paidBySplitMode: template.paidBySplitMode as never,
    splitMode: template.splitMode as never,
    isReimbursement: template.isReimbursement,
    notes: template.notes,
    paidByList: { createMany: { data: template.paidByList } },
    paidFor: { createMany: { data: template.paidFor } },
    items: {
      create: template.items.map((item) => ({
        id: randomId(),
        title: item.title,
        unitPrice: item.unitPrice,
        quantity: item.quantity,
        amount: item.amount,
        splitMode: item.splitMode as never,
        paidFor: { createMany: { data: item.paidFor } },
      })),
    },
    ...(template.itemizedRemainder
      ? {
          itemizedRemainder: {
            create: {
              splitMode: template.itemizedRemainder.splitMode as never,
              paidFor: {
                createMany: { data: template.itemizedRemainder.paidFor },
              },
            },
          },
        }
      : {}),
  }
}

export function toRecurrenceConfig(series: {
  frequency: RecurrenceFrequency
  interval: number
  endType: RecurrenceEndType
  occurrenceLimit: number | null
  endDate: Date | null
}): RecurrenceConfig {
  return {
    frequency: series.frequency,
    interval: series.interval,
    end:
      series.endType === 'COUNT'
        ? { type: 'COUNT', count: series.occurrenceLimit ?? 1 }
        : series.endType === 'DATE'
          ? { type: 'DATE', endDate: series.endDate ?? new Date() }
          : { type: 'INDEFINITE' },
  }
}

export type MaterializationPayload = {
  seriesId: string
  sequence: number
  occurrenceDate: string
}

type RecurringCatchUpBatch = {
  id: string
  startDate: string
  count: number
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
  }
}

function parseCatchUpBatch(value: unknown): RecurringCatchUpBatch | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Partial<RecurringCatchUpBatch>
  return typeof row.id === 'string' &&
    typeof row.startDate === 'string' &&
    typeof row.count === 'number' &&
    Number.isInteger(row.count) &&
    row.count >= 0
    ? { id: row.id, startDate: row.startDate, count: row.count }
    : null
}

function utcTodayDate(): Date {
  const now = new Date()
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  )
}

function asDate(value: string) {
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
        data: { status: RecurringExpenseSeriesStatus.PAUSED },
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
    const startsBatch =
      !storedBatch && occurrenceDate <= today && nextDate <= today
    const batch =
      storedBatch ??
      (startsBatch
        ? {
            id: `recurring-catchup:${series.id}:${date}`,
            startDate: date,
            count: 0,
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
          batch && !completed && nextDate <= today
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
        batch && batchCount >= 2 && (completed || nextDate > today)
          ? {
              count: batchCount,
              startDate: batch.startDate,
              endDate: date,
              affectedParticipants: recurringTemplateParticipantIds(template),
            }
          : undefined,
    }
  })
}

export async function reconcileDueRecurringExpenses(
  boss: SpliitBoss,
  options: { cursor?: string } = {},
) {
  const pageSize = 250
  const enqueueBatchSize = 25
  const pausedGroups = await prisma.recurringExpenseSeries.findMany({
    where: {
      status: RecurringExpenseSeriesStatus.PAUSED,
      ledger: { group: { archived: false } },
    },
    select: { ledger: { select: { group: { select: { id: true } } } } },
  })
  const pausedGroupIds = new Set<string>()
  for (const row of Array.isArray(pausedGroups) ? pausedGroups : []) {
    if (row.ledger.group) pausedGroupIds.add(row.ledger.group.id)
  }
  for (const groupId of pausedGroupIds) {
    await resumeRecurringExpenseSeries(groupId, boss)
  }
  const today = new Date()
  const due = await prisma.recurringExpenseSeries.findMany({
    where: {
      status: RecurringExpenseSeriesStatus.ACTIVE,
      nextOccurrenceDate: { lte: today },
      ledger: { group: { archived: false } },
    },
    ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
    take: pageSize,
    orderBy: { id: 'asc' },
    select: { id: true, occurrencesCreated: true, nextOccurrenceDate: true },
  })
  for (let index = 0; index < due.length; index += enqueueBatchSize) {
    const batch = due.slice(index, index + enqueueBatchSize)
    await Promise.all(
      batch.map(async (series) => {
        const sequence = series.occurrencesCreated + 1
        const payload = {
          seriesId: series.id,
          sequence,
          occurrenceDate: series.nextOccurrenceDate.toISOString().slice(0, 10),
        }
        if (await hasDeadLetteredMaterialization(boss, payload)) return
        await sendJob(boss, JOB_NAMES.MATERIALIZE_RECURRING_EXPENSE, payload, {
          singletonKey: materializationSingletonKey(payload),
          startAfter: recurrenceJobStartAfter(series.nextOccurrenceDate),
        })
      }),
    )
  }
  if (due.length === pageSize) {
    const cursor = due[due.length - 1]?.id
    if (cursor) {
      await sendJob(
        boss,
        JOB_NAMES.RECONCILE_RECURRING_EXPENSES,
        { cursor },
        { singletonKey: `recurring-expense-reconciliation:${cursor}` },
      )
    }
  }
  return due.length
}

/** Pause/resume hooks used by group archive mutations. Skipped archive dates
 * are not counted as occurrences; the anchor is moved to the resumed date so
 * the next created row remains the next sequence number. */
export async function pauseRecurringExpenseSeries(groupId: string) {
  const group = await prisma.group.findUnique({
    where: { id: groupId },
    select: { ledgerId: true, archived: true },
  })
  if (!group?.ledgerId || !group.archived) return 0
  return prisma.recurringExpenseSeries.updateMany({
    where: {
      ledgerId: group.ledgerId,
      status: RecurringExpenseSeriesStatus.ACTIVE,
    },
    data: {
      status: RecurringExpenseSeriesStatus.PAUSED,
      version: { increment: 1 },
    },
  })
}

export async function resumeRecurringExpenseSeries(
  groupId: string,
  existingBoss?: SpliitBoss,
) {
  const today = new Date()
  // Resolve the enqueue client before opening the transaction. When jobs are
  // disabled, keep the database state authoritative and let reconciliation
  // enqueue the occurrence once workers are enabled again.
  const boss = jobsEnv.JOBS_ENABLED
    ? (existingBoss ?? (await getApiBoss()))
    : undefined

  return prisma.$transaction(async (tx) => {
    // Archive and resume use the same Group -> Series lock order. The group
    // is re-read under the lock so a concurrent re-archive cannot leave an
    // ACTIVE series behind.
    await tx.$queryRaw`SELECT "id" FROM "Group" WHERE "id" = ${groupId} FOR UPDATE`
    const group = await tx.group.findUnique({
      where: { id: groupId },
      select: { ledgerId: true, archived: true },
    })
    if (!group?.ledgerId || group.archived) return 0

    const pausedResult = await tx.recurringExpenseSeries.findMany({
      where: {
        ledgerId: group.ledgerId,
        status: RecurringExpenseSeriesStatus.PAUSED,
      },
      select: { id: true },
      orderBy: { id: 'asc' },
    })
    const paused = Array.isArray(pausedResult) ? pausedResult : []
    let resumed = 0
    for (const candidate of paused) {
      await tx.$queryRaw`SELECT "id" FROM "RecurringExpenseSeries" WHERE "id" = ${candidate.id} FOR UPDATE`
      const series = await tx.recurringExpenseSeries.findUnique({
        where: { id: candidate.id },
      })
      if (!series || series.status !== RecurringExpenseSeriesStatus.PAUSED)
        continue

      let ordinal = Math.max(1, series.nextOccurrenceOrdinal)
      let next = calculateRecurrenceDate(
        series.anchorDate,
        series.frequency,
        series.interval,
        ordinal,
      )
      while (next <= today) {
        ordinal += 1
        next = calculateRecurrenceDate(
          series.anchorDate,
          series.frequency,
          series.interval,
          ordinal,
        )
      }
      if (
        series.endType === 'DATE' &&
        series.endDate &&
        next > series.endDate
      ) {
        await tx.recurringExpenseSeries.update({
          where: { id: series.id },
          data: {
            status: RecurringExpenseSeriesStatus.COMPLETED,
            version: { increment: 1 },
          },
        })
        continue
      }
      if (
        series.endType === 'COUNT' &&
        series.occurrenceLimit !== null &&
        series.occurrencesCreated >= series.occurrenceLimit
      ) {
        await tx.recurringExpenseSeries.update({
          where: { id: series.id },
          data: {
            status: RecurringExpenseSeriesStatus.COMPLETED,
            version: { increment: 1 },
          },
        })
        continue
      }
      if (next > today) {
        const sequence = series.occurrencesCreated + 1
        await tx.recurringExpenseSeries.update({
          where: { id: series.id },
          data: {
            status: RecurringExpenseSeriesStatus.ACTIVE,
            nextOccurrenceDate: next,
            nextOccurrenceOrdinal: ordinal,
            version: { increment: 1 },
          },
        })
        await enqueueMaterialization(
          tx,
          {
            seriesId: series.id,
            sequence,
            occurrenceDate: next,
          },
          boss,
        )
        resumed++
      }
    }
    return resumed
  })
}
