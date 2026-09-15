import { prisma } from '@spliit/db'
import { dateOnlyInTimeZone, utcToWallTime } from '@spliit/domain'

import {
  expectedOccurrenceDate,
  isOutsideTermination,
  isScheduleConfigEqual,
} from '../recurrence/reflow-series-from-anchor'
import { getExpenseRecurrence } from '../recurrence/template'
import type { getExpense } from './queries'

type ExistingExpense = NonNullable<Awaited<ReturnType<typeof getExpense>>>
type IncomingExpense = Parameters<typeof getExpenseRecurrence>[0] & {
  expenseDate: string | Date
  expenseTimeZone: string
  documents: Array<{ id: string }>
}

/**
 * Documents the edit would delete: existing rows missing from the incoming
 * payload. `updateExpense` deletes those rows and their stored objects, so
 * spotting them here lets the caller require the delete scope _before_ any side
 * effect runs. Ids are stable across document promotion, so the raw input
 * compares exactly like the promoted list the writer diffs.
 */
export function findRemovedExpenseDocuments(
  existing: Pick<ExistingExpense, 'documents'>,
  incoming: Pick<IncomingExpense, 'documents'>,
): Array<{ id: string }> {
  return existing.documents.filter(
    (existingDoc) =>
      !incoming.documents.some((doc) => doc.id === existingDoc.id),
  )
}

/**
 * Future occurrences a `THIS_AND_FUTURE` edit would drop. Mirrors the
 * schedule-reflow computation in `updateExpense` (same anchor resolution, same
 * termination test) so the scope gate and the writer agree on whether the edit
 * destroys data. Template-only edits keep an equal schedule and drop nothing.
 */
export async function findDroppedOccurrenceIds(
  existing: ExistingExpense,
  incoming: IncomingExpense,
): Promise<string[]> {
  const series = existing.recurringSeries
  if (!series || existing.recurrenceSequence === null) return []
  if (!existing.recurrence) return []

  const preserveRecurringCalendarDates =
    existing.recurringSeriesId !== null && existing.recurrenceSequence !== null
  const incomingExpenseDate = new Date(incoming.expenseDate)
  const incomingTimeZone = incoming.expenseTimeZone
  const existingWall = utcToWallTime(
    new Date(existing.expenseDate),
    existing.expenseTimeZone,
  )
  const resolvedWallDate = preserveRecurringCalendarDates
    ? new Date(`${existingWall.dateIso}T00:00:00.000Z`)
    : dateOnlyInTimeZone(incomingExpenseDate, incomingTimeZone)

  let recurrence: ReturnType<typeof getExpenseRecurrence>
  try {
    recurrence = getExpenseRecurrence(incoming, resolvedWallDate)
  } catch {
    // Unparseable recurrence fails the same way in the writer; stay
    // fail-closed here so a malformed schedule can never dodge the gate.
    throw new DestructiveEditUnknownError()
  }
  if (!recurrence) return []
  if (isScheduleConfigEqual(existing.recurrence, recurrence)) return []

  const anchorSequence = existing.recurrenceSequence ?? 1
  const rows = await prisma.expense.findMany({
    where: {
      recurringSeriesId: series.id,
      recurrenceSequence: { gte: existing.recurrenceSequence ?? 1 },
    },
    orderBy: { recurrenceSequence: 'asc' },
    select: {
      id: true,
      expenseDate: true,
      expenseTimeZone: true,
      recurrenceSequence: true,
    },
  })
  const dropped: string[] = []
  for (const row of rows) {
    if (row.id === existing.id) continue
    const seq = row.recurrenceSequence ?? anchorSequence
    const expected = expectedOccurrenceDate(
      resolvedWallDate,
      recurrence,
      anchorSequence,
      seq,
    )
    if (isOutsideTermination(recurrence, seq, expected)) dropped.push(row.id)
  }
  return dropped
}

export class DestructiveEditUnknownError extends Error {
  constructor() {
    super('Could not determine whether this edit drops data')
    this.name = 'DestructiveEditUnknownError'
  }
}
