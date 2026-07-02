import { splitSemantics } from './semantics'
import type { ExpenseDiffer } from './types'

/**
 * Detects and formats changes to the expense split configuration.
 *
 * The split is considered changed if any of the following differ:
 * - paid-for row shares (order-independent)
 * - split mode
 * - itemized remainder configuration
 *
 * Wraps {@link splitSemantics} for comparison and formatting logic.
 */
export const splitDiffer: ExpenseDiffer = {
  field: 'split',

  check(oldExpense, newExpense) {
    return (
      splitSemantics.paidForKey(oldExpense.paidFor) !==
        splitSemantics.paidForKey(newExpense.paidFor) ||
      oldExpense.splitMode !== newExpense.splitMode ||
      splitSemantics.remainderKey(oldExpense.itemizedRemainder) !==
        splitSemantics.remainderKey(newExpense.itemizedRemainder)
    )
  },

  diff(oldExpense, newExpense, ctx) {
    if (!this.check(oldExpense, newExpense)) return null
    return {
      field: 'split',
      before: splitSemantics.format(
        oldExpense.splitMode,
        oldExpense.paidFor,
        ctx,
      ),
      after: splitSemantics.format(
        newExpense.splitMode,
        newExpense.paidFor,
        ctx,
      ),
    }
  },
}
