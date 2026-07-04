import { documentsKey } from './helpers'
import type { ExpenseDiffer } from './types'

/**
 * Detects and formats changes to expense documents (attachments).
 * Uses a stable order-independent key for comparison.
 * Before/after shows attachment counts.
 */
export const documentsDiffer: ExpenseDiffer = {
  field: 'documents',

  check(oldExpense, newExpense) {
    return (
      documentsKey(oldExpense.documents) !== documentsKey(newExpense.documents)
    )
  },

  diff(oldExpense, newExpense) {
    if (!this.check(oldExpense, newExpense)) return null
    const fmt = (n: number) => {
      if (n === 0) return null
      return n === 1 ? '1 attachment' : `${n} attachments`
    }
    return {
      field: 'documents',
      before: fmt(oldExpense.documents.length),
      after: fmt(newExpense.documents.length),
    }
  },
}
