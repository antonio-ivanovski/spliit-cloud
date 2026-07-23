import {
  calculateRecurrenceDate as calculateDomainRecurrenceDate,
  type RecurrenceConfig as DomainRecurrenceConfig,
  type RecurrenceEnd as DomainRecurrenceEnd,
} from '@spliit/domain'

export type RecurrenceFrequency = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY'

export type RecurrenceEnd = DomainRecurrenceEnd

export type RecurrenceConfig = DomainRecurrenceConfig

/**
 * Date-only recurrence math. Using UTC here keeps a date picked in the form
 * stable around DST boundaries, while month/year calculations stay anchored
 * to the original calendar day instead of accumulating clamped dates.
 */
export function calculateRecurrenceDate(
  anchor: Date,
  config: RecurrenceConfig,
  sequence: number,
): Date {
  return calculateDomainRecurrenceDate(
    anchor,
    config.frequency,
    config.interval,
    sequence + 1,
  )
}

export function isRecurrenceDateAllowed(
  config: RecurrenceConfig,
  sequence: number,
  date: Date,
): boolean {
  if (config.end.type === 'INDEFINITE') return true
  if (config.end.type === 'COUNT') return sequence <= config.end.count - 1
  const endDate = new Date(config.end.endDate)
  endDate.setUTCHours(23, 59, 59, 999)
  return date.getTime() <= endDate.getTime()
}

export type RecurrenceScheduleEntry = {
  date: Date
  sequence: number
}

export type RecurrenceSchedule = {
  entries: RecurrenceScheduleEntry[]
  hasMore: boolean
  /** Total entries from the current occurrence onward; null means indefinite. */
  totalCount: number | null
  /** Future entries after the current occurrence; null means indefinite. */
  remainingCount: number | null
  /** Current occurrence number in the persisted series. */
  currentSequence: number
  anchor?: Date
  config?: RecurrenceConfig | null
  /** Resolve an occurrence by zero-based offset from the current occurrence. */
  getEntryAt: (offset: number) => RecurrenceScheduleEntry | null
}

function dateForSequence(
  anchor: Date,
  config: RecurrenceConfig,
  sequence: number,
  currentSequence: number,
) {
  return sequence === 1
    ? anchor
    : calculateRecurrenceDate(anchor, config, sequence - currentSequence)
}

function isSequenceAllowed(
  anchor: Date,
  config: RecurrenceConfig,
  sequence: number,
  currentSequence: number,
) {
  return isRecurrenceDateAllowed(
    config,
    sequence - 1,
    dateForSequence(anchor, config, sequence, currentSequence),
  )
}

/** Find a finite DATE schedule size without iterating every calendar day. */
function getDateScheduleCount(
  anchor: Date,
  config: RecurrenceConfig,
  currentSequence: number,
): number | null {
  if (config.end.type !== 'DATE') return null
  const endDate = new Date(config.end.endDate)
  const anchorDay = dateOnlyTime(anchor)
  const endDay = dateOnlyTime(endDate)
  const difference = Math.max(0, endDay - anchorDay)
  let offset = 0
  switch (config.frequency) {
    case 'DAILY':
      offset = Math.floor(difference / config.interval)
      break
    case 'WEEKLY':
      offset = Math.floor(difference / (config.interval * 7))
      break
    case 'MONTHLY': {
      const months =
        (endDate.getUTCFullYear() - anchor.getUTCFullYear()) * 12 +
        endDate.getUTCMonth() -
        anchor.getUTCMonth()
      offset = Math.max(0, Math.floor(months / config.interval))
      break
    }
    case 'YEARLY':
      offset = Math.max(
        0,
        Math.floor(
          (endDate.getUTCFullYear() - anchor.getUTCFullYear()) /
            config.interval,
        ),
      )
      break
  }

  // Calendar clamping can make a boundary candidate fall just outside the
  // requested date. Find the exact last allowed sequence around the estimate.
  let low = currentSequence
  let high = currentSequence + offset + 2
  while (
    high > currentSequence &&
    isSequenceAllowed(anchor, config, high, currentSequence)
  ) {
    low = high
    high += Math.max(1, offset + 1)
  }
  if (
    low === currentSequence &&
    !isSequenceAllowed(anchor, config, low, currentSequence)
  ) {
    return 0
  }

  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2)
    if (isSequenceAllowed(anchor, config, middle, currentSequence)) low = middle
    else high = middle
  }
  return Math.max(0, low - currentSequence + 1)
}

/** Build the material-free schedule used by the recurrence editor. */
export function getRecurrenceSchedule(
  anchor: Date | undefined,
  config: RecurrenceConfig | null | undefined,
  currentSequence = 1,
  cap = 101,
): RecurrenceSchedule {
  if (!anchor || !config || config.interval < 1 || config.interval > 99) {
    return {
      entries: [],
      hasMore: false,
      totalCount: 0,
      remainingCount: 0,
      currentSequence: Math.max(1, Math.round(currentSequence)),
      anchor,
      config,
      getEntryAt: () => null,
    }
  }

  const sequenceStart = Math.max(1, Math.round(currentSequence))
  const totalCount =
    config.end.type === 'COUNT'
      ? Math.max(0, config.end.count - sequenceStart + 1)
      : config.end.type === 'DATE'
        ? getDateScheduleCount(anchor, config, sequenceStart)
        : null
  const getEntryAt = (offset: number): RecurrenceScheduleEntry | null => {
    if (!Number.isInteger(offset) || offset < 0) return null
    if (totalCount !== null && offset >= totalCount) return null
    const sequence = sequenceStart + offset
    const date = dateForSequence(anchor, config, sequence, sequenceStart)
    if (!isSequenceAllowed(anchor, config, sequence, sequenceStart)) return null
    return { date, sequence }
  }
  const entries: RecurrenceScheduleEntry[] = []

  for (
    let offset = 0;
    entries.length < cap &&
    (totalCount === null || entries.length < totalCount);
    offset += 1
  ) {
    const entry = getEntryAt(offset)
    if (!entry) break
    entries.push(entry)
  }

  const hasMore = totalCount === null || entries.length < totalCount
  return {
    entries,
    hasMore,
    totalCount,
    remainingCount: totalCount === null ? null : Math.max(0, totalCount - 1),
    currentSequence: sequenceStart,
    anchor,
    config,
    getEntryAt,
  }
}

/** Return schedule metadata without materializing any entries. */
export function getRecurrenceScheduleMetadata(
  anchor: Date | undefined,
  config: RecurrenceConfig | null | undefined,
  currentSequence = 1,
): RecurrenceSchedule {
  return getRecurrenceSchedule(anchor, config, currentSequence, 0)
}

/** Return occurrence dates after the entered expense (up to three by default). */
export function getRecurrencePreviewDates(
  anchor: Date | undefined,
  config: RecurrenceConfig | null | undefined,
  limit = 3,
  currentSequence = 1,
): Date[] {
  return getRecurrenceSchedule(anchor, config, currentSequence, limit + 1)
    .entries.slice(1)
    .map(({ date }) => date)
}

export function formatDateInputValue(date: Date): string {
  return date.toISOString().slice(0, 10)
}

export function parseDateInputValue(value: string): Date {
  return new Date(`${value}T12:00:00.000Z`)
}

export function dateOnlyTime(date: Date): number {
  return Math.floor(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) /
      (24 * 60 * 60 * 1000),
  )
}

export function utcTodayDate(): Date {
  const now = new Date()
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  )
}

export type OccurrenceScheduleStatus = 'current' | 'completed' | 'upcoming'

export function getOccurrenceScheduleStatus(
  entry: RecurrenceScheduleEntry,
  currentSequence: number,
  today: Date = utcTodayDate(),
): OccurrenceScheduleStatus {
  if (entry.sequence === currentSequence) return 'current'
  if (dateOnlyTime(entry.date) <= dateOnlyTime(today)) return 'completed'
  return 'upcoming'
}

/** True when frequency, interval, or end differ. */
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

/** Count projected occurrences after the current one that fall on or before today. */
export function countDueBackfillOccurrences(
  schedule: RecurrenceSchedule,
  today: Date = utcTodayDate(),
): number {
  let count = 0
  const todayDay = dateOnlyTime(today)
  for (let offset = 1; ; offset += 1) {
    const entry = schedule.getEntryAt(offset)
    if (!entry) break
    if (dateOnlyTime(entry.date) > todayDay) break
    count += 1
    if (schedule.totalCount !== null && offset >= schedule.totalCount - 1) break
    // Cap indefinite scans to a year of daily-scale safety.
    if (offset > 400) break
  }
  return count
}
