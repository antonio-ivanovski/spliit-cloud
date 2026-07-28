import { prisma } from '@spliit/db'

export type RecurringSeriesProgress = {
  seriesId: string
  status: string
  occurrencesCreated: number
  /** ISO date (YYYY-MM-DD) the worker will materialize next. */
  nextOccurrenceDate: string
  /**
   * Cutoff date from `catchUpBatch.dueThrough`, when the worker has coalesced a
   * run into a single batch; null otherwise.
   */
  dueThrough: string | null
  /**
   * True while an ACTIVE series still has occurrences to materialize within the
   * current UTC day or earlier.
   */
  pending: boolean
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function utcToday(): Date {
  const now = new Date()
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  )
}

function readDueThrough(batch: unknown): string | null {
  if (!batch || typeof batch !== 'object') return null
  const value = (batch as { dueThrough?: unknown }).dueThrough
  return typeof value === 'string' ? value.slice(0, 10) : null
}

/**
 * Read-only snapshot of where a recurring-expense series is in its catch-up
 * pipeline. Used by the web client to poll after creating a past-dated series:
 * it returns `pending=true` while occurrences remain due, and `pending=false`
 * once the worker drains the queue or the series moves to a terminal status.
 *
 * Returns null when the series does not exist or belongs to a different
 * group/ledger — the procedure surfaces this as a normal `null` result rather
 * than a 404.
 */
export async function getRecurringSeriesProgress(
  groupId: string,
  seriesId: string,
): Promise<RecurringSeriesProgress | null> {
  const group = await prisma.group.findUnique({
    where: { id: groupId },
    select: { ledgerId: true },
  })
  if (!group?.ledgerId) return null

  const series = await prisma.recurringExpenseSeries.findFirst({
    where: { id: seriesId, ledgerId: group.ledgerId },
    select: {
      id: true,
      status: true,
      occurrencesCreated: true,
      nextOccurrenceDate: true,
      catchUpBatch: true,
    },
  })
  if (!series) return null

  const today = utcToday()
  const nextDate = toIsoDate(series.nextOccurrenceDate)
  const status = String(series.status)
  const pending = status === 'ACTIVE' && series.nextOccurrenceDate <= today

  return {
    seriesId: series.id,
    status,
    occurrencesCreated: series.occurrencesCreated,
    nextOccurrenceDate: nextDate,
    dueThrough: readDueThrough(series.catchUpBatch),
    pending,
  }
}
