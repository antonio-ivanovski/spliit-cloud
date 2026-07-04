import { payerSemantics } from './semantics'
import type { ExpenseDiffer } from './types'

/**
 * Detects and formats changes to the set of payers.
 *
 * Wraps {@link payerSemantics} to apply semantic comparison that avoids
 * false positives when `paidBySplitMode` is `BY_AMOUNT` (shares are derived
 * from the expense total, so an amount-only edit should not flag a payer
 * change).
 */
export const payersDiffer: ExpenseDiffer = {
  field: 'payers',

  check(oldExpense, newExpense) {
    return (
      payerSemantics.key(oldExpense.paidByList, oldExpense.paidBySplitMode) !==
      payerSemantics.key(newExpense.paidByList, newExpense.paidBySplitMode)
    )
  },

  diff(oldExpense, newExpense, ctx) {
    if (!this.check(oldExpense, newExpense)) return null
    return {
      field: 'payers',
      before: payerSemantics.format(oldExpense.paidByList, ctx),
      after: payerSemantics.format(newExpense.paidByList, ctx),
    }
  },
}
