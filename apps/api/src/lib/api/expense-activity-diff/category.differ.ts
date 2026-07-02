import type { ExpenseDiffer } from './types'

/** Detects and formats changes to the expense category. */
export const categoryDiffer: ExpenseDiffer = {
  field: 'category',

  check(oldExpense, newExpense) {
    return oldExpense.category !== newExpense.category
  },

  diff(oldExpense, newExpense, ctx) {
    if (!this.check(oldExpense, newExpense)) return null
    return {
      field: 'category',
      before: ctx.getCategoryName(oldExpense.category),
      after: ctx.getCategoryName(newExpense.category),
    }
  },
}
