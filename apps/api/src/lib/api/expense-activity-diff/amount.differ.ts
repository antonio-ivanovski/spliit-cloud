import { formatDisplayAmount } from './helpers'
import type { ExpenseDiffer } from './types'

/**
 * Detects and formats changes to the expense amount (including currency).
 * Amount is compared as raw integer cents; the before/after display uses
 * the original currency when present (e.g. for conversions).
 */
export const amountDiffer: ExpenseDiffer = {
  field: 'amount',

  check(oldExpense, newExpense) {
    return oldExpense.amount !== newExpense.amount
  },

  diff(oldExpense, newExpense, ctx) {
    if (!this.check(oldExpense, newExpense)) return null
    return {
      field: 'amount',
      before: formatDisplayAmount(oldExpense, ctx),
      after: formatDisplayAmount(newExpense, ctx),
    }
  },
}
