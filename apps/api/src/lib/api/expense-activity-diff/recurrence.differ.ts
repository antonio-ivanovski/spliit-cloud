import { recurrenceConfigSchema, type RecurrenceConfig } from '@spliit/domain'

import type { ExpenseDiffer } from './types'

const recurrenceLabels: Record<string, string> = {
  NONE: 'Not recurring',
  DAILY: 'Daily',
  WEEKLY: 'Weekly',
  MONTHLY: 'Monthly',
  YEARLY: 'Yearly',
}

type RecurrenceExpense = {
  recurrence?: unknown
  recurrenceRule: string
}

function normalizedRecurrence(value: unknown): RecurrenceConfig | null {
  const parsed = recurrenceConfigSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

function recurrenceKey(expense: RecurrenceExpense) {
  const recurrence = normalizedRecurrence(expense.recurrence)
  if (!recurrence) return expense.recurrenceRule

  const end = recurrence.end
  return JSON.stringify({
    frequency: recurrence.frequency,
    interval: recurrence.interval,
    end:
      end.type === 'DATE'
        ? { type: end.type, endDate: end.endDate.toISOString().slice(0, 10) }
        : end,
  })
}

function recurrenceLabel(expense: RecurrenceExpense) {
  const recurrence = normalizedRecurrence(expense.recurrence)
  if (recurrence) {
    const end = recurrence.end
    const suffix =
      end.type === 'COUNT'
        ? `, ${end.count} occurrences`
        : end.type === 'DATE'
          ? `, through ${end.endDate.toISOString().slice(0, 10)}`
          : ''
    return `Every ${recurrence.interval} ${recurrence.frequency.toLowerCase()}${suffix}`
  }
  return recurrenceLabels[expense.recurrenceRule] ?? expense.recurrenceRule
}

/** Detects and formats changes to the recurrence rule. */
export const recurrenceDiffer: ExpenseDiffer = {
  field: 'recurrence',

  check(oldExpense, newExpense) {
    return recurrenceKey(oldExpense) !== recurrenceKey(newExpense)
  },

  diff(oldExpense, newExpense) {
    if (!this.check(oldExpense, newExpense)) return null

    return {
      field: 'recurrence',
      before: recurrenceLabel(oldExpense),
      after: recurrenceLabel(newExpense),
    }
  },
}
