import { formatTimeMinutes, utcToWallTime } from '@spliit/domain'

import { formatDate, sameDate } from './helpers'
import type { ExpenseDiffer } from './types'

/**
 * Detects and formats changes to the expense date. Handles both Date objects
 * and ISO-string representations across the API boundary (DB round-tripping may
 * produce string dates).
 */
export const dateDiffer: ExpenseDiffer = {
  field: 'date',

  check(oldExpense, newExpense) {
    return (
      !sameDate(oldExpense.expenseDate, newExpense.expenseDate) ||
      oldExpense.expenseTimeZone !== newExpense.expenseTimeZone
    )
  },

  diff(oldExpense, newExpense) {
    if (!this.check(oldExpense, newExpense)) return null
    return {
      field: 'date',
      before: temporalLabel(oldExpense),
      after: temporalLabel(newExpense),
    }
  },
}

function temporalLabel(expense: {
  expenseDate: unknown
  expenseTimeZone: string
}) {
  try {
    const instant =
      expense.expenseDate instanceof Date
        ? expense.expenseDate
        : new Date(expense.expenseDate as string)
    const wall = utcToWallTime(instant, expense.expenseTimeZone)
    return `${wall.dateIso} ${formatTimeMinutes(wall.timeMinutes)} · ${expense.expenseTimeZone}`
  } catch {
    return `${formatDate(expense.expenseDate)} · ${expense.expenseTimeZone}`
  }
}
