import { itemsKey } from './helpers'
import type { ExpenseDiffer } from './types'

/**
 * Detects and formats changes to expense items (itemized expenses).
 * Compares full item structures including paid-for assignments and amounts.
 * Before/after shows item counts rather than item details.
 */
export const itemsDiffer: ExpenseDiffer = {
  field: 'items',

  check(oldExpense, newExpense) {
    return itemsKey(oldExpense.items) !== itemsKey(newExpense.items)
  },

  diff(oldExpense, newExpense) {
    if (!this.check(oldExpense, newExpense)) return null
    const fmt = (n: number) => (n > 0 ? `${n}` : null)
    return {
      field: 'items',
      before: fmt((oldExpense.items ?? []).length),
      after: fmt((newExpense.items ?? []).length),
    }
  },
}
