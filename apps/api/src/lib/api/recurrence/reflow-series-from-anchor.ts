import { calculateRecurrenceDate, type RecurrenceConfig } from '@spliit/domain'

import { catchUpDueThrough } from './catch-up-date'

/** True when frequency, interval, or end differ (template-only edits are equal). */
export function isScheduleConfigEqual(
  a: RecurrenceConfig,
  b: RecurrenceConfig,
): boolean {
  if (a.frequency !== b.frequency || a.interval !== b.interval) return false
  if (a.end.type !== b.end.type) return false
  if (a.end.type === 'COUNT' && b.end.type === 'COUNT') {
    return a.end.count === b.end.count
  }
  if (a.end.type === 'DATE' && b.end.type === 'DATE') {
    return (
      a.end.endDate.toISOString().slice(0, 10) ===
      b.end.endDate.toISOString().slice(0, 10)
    )
  }
  return true
}

/** Ordinal 1 is the anchor sequence; later sequences advance from there. */
export function expectedOccurrenceDate(
  anchorDate: Date,
  config: RecurrenceConfig,
  anchorSequence: number,
  sequence: number,
): Date {
  const ordinal = sequence - anchorSequence + 1
  return calculateRecurrenceDate(
    anchorDate,
    config.frequency,
    config.interval,
    ordinal,
  )
}

/** Row is outside the new schedule (COUNT past limit or DATE after end). */
export function isOutsideTermination(
  config: RecurrenceConfig,
  sequence: number,
  date: Date,
): boolean {
  if (config.end.type === 'COUNT') return sequence > config.end.count
  if (config.end.type === 'DATE') {
    return date.getTime() > config.end.endDate.getTime()
  }
  return false
}

/**
 * Next materialization cursor after the high-water sequence, under a schedule
 * re-anchored at `anchorSequence` / `anchorDate`.
 */
export function computeNextMaterializationCursor(args: {
  anchorDate: Date
  anchorSequence: number
  maxSequence: number
  config: RecurrenceConfig
}): { nextOrdinal: number; nextOccurrenceDate: Date; completed: boolean } {
  const { anchorDate, anchorSequence, maxSequence, config } = args
  const nextOrdinal = maxSequence - anchorSequence + 2
  const nextOccurrenceDate = calculateRecurrenceDate(
    anchorDate,
    config.frequency,
    config.interval,
    nextOrdinal,
  )
  const completed =
    (config.end.type === 'COUNT' && maxSequence >= config.end.count) ||
    (config.end.type === 'DATE' &&
      nextOccurrenceDate.getTime() > config.end.endDate.getTime())
  return { nextOrdinal, nextOccurrenceDate, completed }
}

/** Seed catch-up when the next unmaterialized occurrence is already due. */
export function buildCatchUpSeedAfterReflow(args: {
  seriesId: string
  anchorDate: Date
  nextOccurrenceDate: Date
  completed: boolean
  config: RecurrenceConfig
  maxSequence: number
  timeZone?: string
}): {
  id: string
  startDate: string
  count: number
  mode: 'INITIAL_CREATION'
  dueThrough: string
} | null {
  const {
    seriesId,
    anchorDate,
    nextOccurrenceDate,
    completed,
    config,
    maxSequence,
    timeZone = 'UTC',
  } = args
  if (completed) return null
  const dueThrough = catchUpDueThrough(new Date(), timeZone)
  const today = new Date(`${dueThrough}T00:00:00.000Z`)
  if (nextOccurrenceDate.getTime() > today.getTime()) return null
  const nextPermitted = !isOutsideTermination(
    config,
    maxSequence + 1,
    nextOccurrenceDate,
  )
  if (!nextPermitted) return null
  const startDate = anchorDate.toISOString().slice(0, 10)
  return {
    id: `recurring-catchup:${seriesId}:${startDate}:reflow`,
    startDate,
    count: 0,
    mode: 'INITIAL_CREATION',
    dueThrough,
  }
}
