import type {
  RecurrenceConfig,
  RecurrenceEnd,
  RecurrenceFrequency,
} from './types'

export type LegacyRecurrenceRule = 'NONE' | 'DAILY' | 'WEEKLY' | 'MONTHLY'

export function legacyRuleToRecurrence(
  rule: RecurrenceFrequency | LegacyRecurrenceRule | null | undefined,
): RecurrenceConfig | null {
  if (!rule || rule === 'NONE') return null
  return {
    frequency: rule,
    interval: 1,
    end: { type: 'INDEFINITE' },
  }
}

/**
 * Keep the old field meaningful for callers that have not migrated to the
 * recurrence object yet. Interval-aware and yearly schedules cannot be
 * represented by the legacy enum, so they deliberately return NONE.
 */
export function recurrenceToLegacyRule(
  recurrence: RecurrenceConfig | null | undefined,
): LegacyRecurrenceRule {
  if (!recurrence || recurrence.interval !== 1) return 'NONE'
  if (recurrence.end.type !== 'INDEFINITE') return 'NONE'
  return recurrence.frequency === 'YEARLY' ? 'NONE' : recurrence.frequency
}

export function isRecurrenceFrequency(
  value: unknown,
): value is RecurrenceFrequency {
  return (
    value === 'DAILY' ||
    value === 'WEEKLY' ||
    value === 'MONTHLY' ||
    value === 'YEARLY'
  )
}

export function parseRecurrenceEnd(value: unknown): RecurrenceEnd | null {
  if (!value || typeof value !== 'object') return null
  const end = value as Record<string, unknown>
  if (end.type === 'INDEFINITE') return { type: 'INDEFINITE' }
  if (
    end.type === 'COUNT' &&
    Number.isInteger(end.count) &&
    Number(end.count) >= 1
  ) {
    return { type: 'COUNT', count: Number(end.count) }
  }
  if (
    end.type === 'DATE' &&
    typeof end.endDate === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(end.endDate)
  ) {
    return {
      type: 'DATE',
      endDate: new Date(`${end.endDate}T00:00:00.000Z`),
    }
  }
  return null
}

export function parseRecurrenceConfig(value: unknown): RecurrenceConfig | null {
  if (!value || typeof value !== 'object') return null
  const recurrence = value as Record<string, unknown>
  if (!isRecurrenceFrequency(recurrence.frequency)) return null
  if (
    !Number.isInteger(recurrence.interval) ||
    Number(recurrence.interval) < 1 ||
    Number(recurrence.interval) > 99
  ) {
    return null
  }
  const end = parseRecurrenceEnd(recurrence.end)
  if (!end) return null
  return {
    frequency: recurrence.frequency,
    interval: Number(recurrence.interval),
    end,
  }
}
