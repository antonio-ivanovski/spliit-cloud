import { createFormattedValueDiffer } from '../activity-diff/factories'
import { formatDisplayAmount } from './helpers'
import type { ExpenseDiffer } from './types'

/**
 * Detects and formats changes to the expense amount (including currency).
 * Amount is compared as raw integer cents; the before/after display uses
 * the original currency when present (e.g. for conversions).
 */
export const amountDiffer: ExpenseDiffer = createFormattedValueDiffer({
  field: 'amount',
  equals: (oldExpense, newExpense) => oldExpense.amount === newExpense.amount,
  format: (expense, ctx) => formatDisplayAmount(expense, ctx),
})
