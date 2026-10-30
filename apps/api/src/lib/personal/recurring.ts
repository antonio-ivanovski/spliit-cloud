import { TRPCError } from '@trpc/server'

import { prisma, RecurringExpenseSeriesStatus, type Prisma } from '@spliit/db'
import {
  advancePastOverdue,
  calculateRecurrenceDate,
  dateOnlyInTimeZone,
  personalRecurringCreateSchema,
  personalRecurringUpdateSchema,
  projectPersonalRecurringOccurrences,
  resolvePersonalRecurringCategory,
  toPersonalRecurringSeriesFields,
  type PersonalRecurringCreate,
  type PersonalRecurringEndInput,
} from '@spliit/domain'

import { getApiBossForWrite } from '../api/boss'
import { randomId } from '../api/shared'
import { ensurePersonalProfile, parseIsoDate, toIsoDate } from './profile'
import { enqueuePersonalRecurringMaterialization } from './recurring-materialize'

export type PersonalRecurringSeriesDto = {
  id: string
  status: 'ACTIVE' | 'PAUSED' | 'COMPLETED' | 'CANCELLED'
  frequency: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY'
  interval: number
  anchorDate: string
  nextOccurrenceDate: string
  nextOccurrenceOrdinal: number
  endType: 'INDEFINITE' | 'COUNT' | 'DATE'
  occurrenceLimit: number | null
  endDate: string | null
  occurrencesCreated: number
  generatedCount: number
  kind: 'EXPENSE' | 'INCOME'
  amount: number
  currencyCode: string
  categoryId: string
  title: string | null
  note: string | null
  version: number
  timeZone: string
}

export type PersonalRecurringUpcomingItem = {
  seriesId: string
  sequence: number
  date: string
  overdue: boolean
  kind: 'EXPENSE' | 'INCOME'
  amount: number
  currencyCode: string
  categoryId: string
  title: string | null
}

function toSeriesDto(
  row: {
    id: string
    status: string
    frequency: string
    interval: number
    anchorDate: Date
    nextOccurrenceDate: Date
    nextOccurrenceOrdinal: number
    endType: string
    occurrenceLimit: number | null
    endDate: Date | null
    occurrencesCreated: number
    kind: string
    amount: number
    currencyCode: string
    categoryId: string
    title: string | null
    note: string | null
    version: number
    timeZone: string
  },
  generatedCount: number,
): PersonalRecurringSeriesDto {
  return {
    id: row.id,
    status: row.status as PersonalRecurringSeriesDto['status'],
    frequency: row.frequency as PersonalRecurringSeriesDto['frequency'],
    interval: row.interval,
    anchorDate: toIsoDate(row.anchorDate),
    nextOccurrenceDate: toIsoDate(row.nextOccurrenceDate),
    nextOccurrenceOrdinal: row.nextOccurrenceOrdinal,
    endType: row.endType as PersonalRecurringSeriesDto['endType'],
    occurrenceLimit: row.occurrenceLimit,
    endDate: row.endDate ? toIsoDate(row.endDate) : null,
    occurrencesCreated: row.occurrencesCreated,
    generatedCount,
    kind: row.kind as PersonalRecurringSeriesDto['kind'],
    amount: row.amount,
    currencyCode: row.currencyCode,
    categoryId: row.categoryId,
    title: row.title,
    note: row.note,
    version: row.version,
    timeZone: row.timeZone,
  }
}

async function loadOwnedSeries(accountId: string, id: string) {
  const row = await prisma.personalRecurringSeries.findFirst({
    where: { id, accountId },
  })
  if (!row) {
    throw new TRPCError({
      code: 'NOT_FOUND',
      message: 'Planned transaction not found',
    })
  }
  return row
}

export async function listPersonalRecurringSeries(
  accountId: string,
): Promise<{ series: PersonalRecurringSeriesDto[] }> {
  const rows = await prisma.personalRecurringSeries.findMany({
    where: { accountId },
    orderBy: [{ status: 'asc' }, { nextOccurrenceDate: 'asc' }],
  })
  const counts = await prisma.personalTransaction.groupBy({
    by: ['personalRecurringSeriesId'],
    where: {
      accountId,
      personalRecurringSeriesId: { in: rows.map((row) => row.id) },
    },
    _count: { _all: true },
  })
  const bySeries = new Map(
    counts.map((row) => [row.personalRecurringSeriesId, row._count._all]),
  )
  return {
    series: rows.map((row) => toSeriesDto(row, bySeries.get(row.id) ?? 0)),
  }
}

export async function createPersonalRecurringSeries(
  accountId: string,
  raw: PersonalRecurringCreate,
  tx: Prisma.TransactionClient = prisma,
) {
  const input = personalRecurringCreateSchema.parse(raw)
  const profile = await ensurePersonalProfile(accountId, tx)
  const categoryId = resolvePersonalRecurringCategory(
    input.kind,
    input.categoryId,
  )
  const fields = toPersonalRecurringSeriesFields(input.end, input.anchorDate, 0)
  const anchorDate = parseIsoDate(input.anchorDate)
  const id = randomId()

  const created = await tx.personalRecurringSeries.create({
    data: {
      id,
      accountId,
      timeZone: profile.timeZone,
      frequency: input.frequency,
      interval: input.interval,
      anchorDate,
      anchorSequence: 1,
      nextOccurrenceDate: anchorDate,
      nextOccurrenceOrdinal: 1,
      endType: fields.endType,
      occurrenceLimit: fields.occurrenceLimit,
      endDate: fields.endDate,
      occurrencesCreated: 0,
      status: RecurringExpenseSeriesStatus.ACTIVE,
      kind: input.kind,
      amount: input.amount,
      currencyCode: profile.currencyCode,
      categoryId,
      title: input.title?.trim() ? input.title.trim() : null,
      note: input.note?.trim() ? input.note.trim() : null,
      version: 1,
    },
    select: { id: true },
  })

  const todayLocal = dateOnlyInTimeZone(new Date(), profile.timeZone)
  const due = anchorDate.getTime() <= todayLocal.getTime()
  let boss: Awaited<ReturnType<typeof getApiBossForWrite>> | undefined
  try {
    boss = await getApiBossForWrite()
  } catch {
    boss = undefined
  }
  if (boss) {
    await enqueuePersonalRecurringMaterialization(
      tx,
      {
        seriesId: created.id,
        sequence: 1,
        occurrenceDate: anchorDate,
      },
      boss,
      // Future anchors run at their date; due anchors run now. When jobs are
      // enabled this keeps the first occurrence on schedule without a
      // reconcile round-trip.
      due ? undefined : anchorDate,
    )
  }
  return { id: created.id }
}

export async function updatePersonalRecurringSeries(
  accountId: string,
  id: string,
  raw: {
    kind?: 'EXPENSE' | 'INCOME'
    amount?: number
    categoryId?: string
    title?: string | null
    note?: string | null
    end?: PersonalRecurringEndInput
  },
  expectedVersion?: number,
): Promise<{ id: string }> {
  const input = personalRecurringUpdateSchema.parse(raw)
  const row = await loadOwnedSeries(accountId, id)
  if (row.status === 'COMPLETED' || row.status === 'CANCELLED') {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Completed or cancelled plans cannot be edited',
    })
  }
  const nextKind = input.kind ?? (row.kind as 'EXPENSE' | 'INCOME')
  if (input.categoryId !== undefined) {
    resolvePersonalRecurringCategory(nextKind, input.categoryId)
  } else if (input.kind && input.kind !== row.kind) {
    resolvePersonalRecurringCategory(nextKind, row.categoryId)
  }

  let endPatch: {
    endType: typeof row.endType
    occurrenceLimit: number | null
    endDate: Date | null
  } | null = null
  if (input.end !== undefined) {
    // COUNT limits count total occurrences (created + future); shrinking
    // below what already materialized would orphan history.
    const fields = toPersonalRecurringSeriesFields(
      input.end,
      toIsoDate(row.anchorDate),
      row.occurrencesCreated,
    )
    endPatch = {
      endType: fields.endType,
      occurrenceLimit: fields.occurrenceLimit,
      endDate: fields.endDate,
    }
  }

  const result = await prisma.personalRecurringSeries.updateMany({
    where: {
      id,
      accountId,
      ...(expectedVersion !== undefined ? { version: expectedVersion } : {}),
    },
    data: {
      version: { increment: 1 },
      ...(input.kind ? { kind: input.kind } : {}),
      ...(input.amount !== undefined ? { amount: input.amount } : {}),
      ...(input.categoryId !== undefined
        ? {
            categoryId: resolvePersonalRecurringCategory(
              nextKind,
              input.categoryId,
            ),
          }
        : input.kind && input.kind !== row.kind
          ? {
              categoryId: resolvePersonalRecurringCategory(
                nextKind,
                row.categoryId,
              ),
            }
          : {}),
      ...(input.title !== undefined
        ? { title: input.title?.trim() ? input.title.trim() : null }
        : {}),
      ...(input.note !== undefined
        ? { note: input.note?.trim() ? input.note.trim() : null }
        : {}),
      ...(endPatch
        ? {
            endType: endPatch.endType,
            occurrenceLimit: endPatch.occurrenceLimit,
            endDate: endPatch.endDate,
          }
        : {}),
    },
  })
  if (result.count === 0) {
    throw new TRPCError({
      code: 'CONFLICT',
      message: 'This plan changed. Refresh and try again.',
    })
  }

  // Shrinking the end below the created count completes the series without
  // writing. COUNT counts materialized rows: limit == created means no future
  // rows remain, regardless of the slot ordinal.
  if (endPatch) {
    const updated = await prisma.personalRecurringSeries.findUniqueOrThrow({
      where: { id },
    })
    const nextDate = calculateRecurrenceDate(
      updated.anchorDate,
      updated.frequency,
      updated.interval,
      updated.nextOccurrenceOrdinal,
    )
    const outOfBounds =
      (updated.endType === 'COUNT' &&
        updated.occurrenceLimit !== null &&
        updated.occurrencesCreated >= updated.occurrenceLimit) ||
      (updated.endType === 'DATE' &&
        updated.endDate !== null &&
        nextDate > updated.endDate)
    if (outOfBounds && updated.status === 'ACTIVE') {
      await prisma.personalRecurringSeries.update({
        where: { id },
        data: {
          status: RecurringExpenseSeriesStatus.COMPLETED,
          version: { increment: 1 },
        },
      })
    }
  }
  return { id }
}

export async function pausePersonalRecurringSeries(
  accountId: string,
  id: string,
): Promise<{ id: string }> {
  const result = await prisma.personalRecurringSeries.updateMany({
    where: { id, accountId, status: 'ACTIVE' },
    data: {
      status: RecurringExpenseSeriesStatus.PAUSED,
      version: { increment: 1 },
    },
  })
  if (result.count === 0) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Only active plans can be paused',
    })
  }
  return { id }
}

export async function resumePersonalRecurringSeries(
  accountId: string,
  id: string,
): Promise<{ id: string; skipped: number }> {
  let boss: Awaited<ReturnType<typeof getApiBossForWrite>> | undefined
  try {
    boss = await getApiBossForWrite()
  } catch {
    boss = undefined
  }
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "PersonalRecurringSeries" WHERE "id" = ${id} FOR UPDATE`
    const series = await tx.personalRecurringSeries.findFirst({
      where: { id, accountId },
    })
    if (!series) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'Planned transaction not found',
      })
    }
    if (series.status !== 'PAUSED') {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Only paused plans can be resumed',
      })
    }
    // COUNT counts materialized rows: an already-complete budget completes
    // immediately without advancing or enqueueing.
    if (
      series.endType === 'COUNT' &&
      series.occurrenceLimit !== null &&
      series.occurrencesCreated >= series.occurrenceLimit
    ) {
      await tx.personalRecurringSeries.update({
        where: { id: series.id },
        data: {
          status: RecurringExpenseSeriesStatus.COMPLETED,
          version: { increment: 1 },
        },
      })
      return { id: series.id, skipped: 0 }
    }
    const todayLocal = dateOnlyInTimeZone(new Date(), series.timeZone)
    const advanced = advancePastOverdue({
      anchorDate: series.anchorDate,
      frequency: series.frequency,
      interval: series.interval,
      nextOccurrenceOrdinal: series.nextOccurrenceOrdinal,
      timeZone: series.timeZone,
      today: todayLocal,
      endType: series.endType,
      occurrenceLimit: series.occurrenceLimit,
      endDate: series.endDate,
    })
    const advancedDate = advanced.nextOccurrenceDate
    const datePassed =
      series.endType === 'DATE' &&
      series.endDate !== null &&
      advancedDate > series.endDate
    if (datePassed) {
      await tx.personalRecurringSeries.update({
        where: { id: series.id },
        data: {
          status: RecurringExpenseSeriesStatus.COMPLETED,
          nextOccurrenceDate: advancedDate,
          nextOccurrenceOrdinal: advanced.nextOccurrenceOrdinal,
          version: { increment: 1 },
        },
      })
      return { id: series.id, skipped: advanced.skipped }
    }
    await tx.personalRecurringSeries.update({
      where: { id: series.id },
      data: {
        status: RecurringExpenseSeriesStatus.ACTIVE,
        nextOccurrenceDate: advancedDate,
        nextOccurrenceOrdinal: advanced.nextOccurrenceOrdinal,
        version: { increment: 1 },
      },
    })
    const startAfter =
      advancedDate.getTime() > todayLocal.getTime() ? advancedDate : undefined
    await enqueuePersonalRecurringMaterialization(
      tx,
      {
        seriesId: series.id,
        sequence: advanced.nextOccurrenceOrdinal,
        occurrenceDate: advancedDate,
      },
      boss,
      startAfter,
    )
    return { id: series.id, skipped: advanced.skipped }
  })
}

export async function cancelPersonalRecurringSeries(
  accountId: string,
  id: string,
): Promise<{ id: string }> {
  const result = await prisma.personalRecurringSeries.updateMany({
    where: {
      id,
      accountId,
      status: { in: ['ACTIVE', 'PAUSED'] },
    },
    data: {
      status: RecurringExpenseSeriesStatus.CANCELLED,
      version: { increment: 1 },
    },
  })
  if (result.count === 0) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Only active or paused plans can be cancelled',
    })
  }
  return { id }
}

export async function deletePersonalRecurringSeries(
  accountId: string,
  id: string,
): Promise<{ ok: true }> {
  const row = await loadOwnedSeries(accountId, id)
  const generated = await prisma.personalTransaction.count({
    where: { accountId, personalRecurringSeriesId: row.id },
  })
  if (generated > 0) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message:
        'This plan already created entries. Cancel it to stop future entries.',
    })
  }
  await prisma.personalRecurringSeries.delete({
    where: { id: row.id },
  })
  return { ok: true as const }
}

export async function skipNextPersonalRecurringOccurrence(
  accountId: string,
  id: string,
): Promise<{ id: string; date: string }> {
  const row = await loadOwnedSeries(accountId, id)
  if (row.status !== 'ACTIVE' && row.status !== 'PAUSED') {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Only active or paused plans can skip an occurrence',
    })
  }
  const nextOrdinal = row.nextOccurrenceOrdinal + 1
  const nextDate = calculateRecurrenceDate(
    row.anchorDate,
    row.frequency,
    row.interval,
    nextOrdinal,
  )
  // Skipped slots never consume COUNT budget: only DATE passing the end (or
  // an already-complete COUNT) completes the series.
  const completed =
    (row.endType === 'COUNT' &&
      row.occurrenceLimit !== null &&
      row.occurrencesCreated >= row.occurrenceLimit) ||
    (row.endType === 'DATE' && row.endDate !== null && nextDate > row.endDate)
  const updated = await prisma.personalRecurringSeries.updateMany({
    where: {
      id: row.id,
      accountId,
      nextOccurrenceOrdinal: row.nextOccurrenceOrdinal,
    },
    data: {
      nextOccurrenceDate: nextDate,
      nextOccurrenceOrdinal: nextOrdinal,
      status: completed ? RecurringExpenseSeriesStatus.COMPLETED : row.status,
      version: { increment: 1 },
    },
  })
  if (updated.count === 0) {
    throw new TRPCError({
      code: 'CONFLICT',
      message: 'This plan changed. Refresh and try again.',
    })
  }
  return { id: row.id, date: toIsoDate(nextDate) }
}

export async function getPersonalRecurringUpcoming(
  accountId: string,
  filters: { from?: string; to?: string; seriesId?: string; limit?: number },
): Promise<{ occurrences: PersonalRecurringUpcomingItem[] }> {
  const limit = filters.limit ?? 10
  if (!Number.isInteger(limit) || limit < 1 || limit > 366) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid limit' })
  }
  const from = filters.from ? parseIsoDate(filters.from) : undefined
  const to = filters.to ? parseIsoDate(filters.to) : undefined
  if (from && Number.isNaN(from.getTime())) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid from date' })
  }
  if (to && Number.isNaN(to.getTime())) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid to date' })
  }
  const rows = await prisma.personalRecurringSeries.findMany({
    where: {
      accountId,
      status: { in: ['ACTIVE', 'PAUSED'] },
      ...(filters.seriesId ? { id: filters.seriesId } : {}),
    },
    orderBy: { nextOccurrenceDate: 'asc' },
    take: 200,
  })
  const now = new Date()
  const all: PersonalRecurringUpcomingItem[] = []
  for (const row of rows) {
    // Read-only: project from the owned row without writes.
    const projected = projectPersonalRecurringOccurrences({
      series: {
        anchorDate: row.anchorDate,
        frequency: row.frequency,
        interval: row.interval,
        endType: row.endType,
        occurrenceLimit: row.occurrenceLimit,
        endDate: row.endDate,
        nextOccurrenceOrdinal: row.nextOccurrenceOrdinal,
        timeZone: row.timeZone,
        occurrencesCreated: row.occurrencesCreated,
      },
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
      limit,
      now,
      dateOnlyInTimeZone,
    })
    for (const occurrence of projected) {
      all.push({
        seriesId: row.id,
        sequence: occurrence.sequence,
        date: occurrence.dateIso,
        overdue: occurrence.overdue,
        kind: row.kind as PersonalRecurringUpcomingItem['kind'],
        amount: row.amount,
        currencyCode: row.currencyCode,
        categoryId: row.categoryId,
        title: row.title,
      })
    }
  }
  all.sort((a, b) =>
    a.date === b.date ? a.sequence - b.sequence : a.date < b.date ? -1 : 1,
  )
  return { occurrences: all.slice(0, limit) }
}
