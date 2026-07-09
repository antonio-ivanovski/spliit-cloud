import { createFormattedValueDiffer } from '../activity-diff/factories'
import { formatDisplayAmount } from './helpers'
import type { ExpenseDiffer } from './types'

/**
 * Detects and formats changes to the expense amount (including currency).
 * Compares ledger amount plus original amount/currency so conversion-only
 * edits still surface when the user-facing original total moves.
 * Display uses the original currency when present.
 */
export const amountDiffer: ExpenseDiffer = createFormattedValueDiffer({
  field: 'amount',
  equals: (oldExpense, newExpense) =>
    oldExpense.amount === newExpense.amount &&
    (oldExpense.originalAmount ?? null) ===
      (newExpense.originalAmount ?? null) &&
    (oldExpense.originalCurrency ?? null) ===
      (newExpense.originalCurrency ?? null),
  format: (expense, ctx) => formatDisplayAmount(expense, ctx),
})
