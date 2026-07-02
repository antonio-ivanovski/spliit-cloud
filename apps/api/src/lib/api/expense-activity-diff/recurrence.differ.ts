import type { ExpenseDiffer } from './types'

const recurrenceLabels: Record<string, string> = {
  NONE: 'Not recurring',
  DAILY: 'Daily',
  WEEKLY: 'Weekly',
  MONTHLY: 'Monthly',
}

/** Detects and formats changes to the recurrence rule. */
export const recurrenceDiffer: ExpenseDiffer = {
  field: 'recurrence',

  check(oldExpense, newExpense) {
    return oldExpense.recurrenceRule !== newExpense.recurrenceRule
  },

  diff(oldExpense, newExpense) {
    if (!this.check(oldExpense, newExpense)) return null

    const label = (r: string) => recurrenceLabels[r] ?? r
    return {
      field: 'recurrence',
      before: label(oldExpense.recurrenceRule),
      after: label(newExpense.recurrenceRule),
    }
  },
}
