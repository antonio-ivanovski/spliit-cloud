import { formatDate, sameDate } from './helpers'
import type { ExpenseDiffer } from './types'

/**
 * Detects and formats changes to the expense date.
 * Handles both Date objects and ISO-string representations across the API
 * boundary (DB round-tripping may produce string dates).
 */
export const dateDiffer: ExpenseDiffer = {
  field: 'date',

  check(oldExpense, newExpense) {
    return !sameDate(oldExpense.expenseDate, newExpense.expenseDate)
  },

  diff(oldExpense, newExpense) {
    if (!this.check(oldExpense, newExpense)) return null
    return {
      field: 'date',
      before: formatDate(oldExpense.expenseDate),
      after: formatDate(newExpense.expenseDate),
    }
  },
}
