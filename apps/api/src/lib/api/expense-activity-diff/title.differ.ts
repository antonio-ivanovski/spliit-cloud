import type { ExpenseDiffer } from './types'

/** Detects and formats changes to the expense title. */
export const titleDiffer: ExpenseDiffer = {
  field: 'title',

  check(oldExpense, newExpense) {
    return oldExpense.title !== newExpense.title
  },

  diff(oldExpense, newExpense) {
    if (!this.check(oldExpense, newExpense)) return null
    return {
      field: 'title',
      before: oldExpense.title,
      after: newExpense.title,
    }
  },
}
