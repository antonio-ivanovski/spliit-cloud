import type {
  ExpenseActivityChange,
  ExpenseChangedField,
} from '@spliit/domain/activities'
import { amountDiffer } from './amount.differ'
import { categoryDiffer } from './category.differ'
import { compositeExpenseDiffer } from './composite.differ'
import { dateDiffer } from './date.differ'
import { documentsDiffer } from './documents.differ'
import { itemsDiffer } from './items.differ'
import { notesDiffer } from './notes.differ'
import { payersDiffer } from './payers.differ'
import { recurrenceDiffer } from './recurrence.differ'
import { splitDiffer } from './split.differ'
import { titleDiffer } from './title.differ'
import type { ChangeContext, DifferenceableExpense } from './types'

// ---------------------------------------------------------------------------
// Re-exports (public surface)
// ---------------------------------------------------------------------------

export { compositeExpenseDiffer } from './composite.differ'
export type { CompositeExpenseDiffer } from './composite.differ'
export { getAffectedParticipantIds } from './participant-collector'
export { payerSemantics, splitSemantics } from './semantics'
export type { ChangeContext, DiffEmission, ExpenseDiffer } from './types'

// Individual differs
export { amountDiffer } from './amount.differ'
export { categoryDiffer } from './category.differ'
export { dateDiffer } from './date.differ'
export { documentsDiffer } from './documents.differ'
export { itemsDiffer } from './items.differ'
export { notesDiffer } from './notes.differ'
export { payersDiffer } from './payers.differ'
export { recurrenceDiffer } from './recurrence.differ'
export { splitDiffer } from './split.differ'
export { titleDiffer } from './title.differ'

// ---------------------------------------------------------------------------
// Default composite (all differs in order)
// ---------------------------------------------------------------------------

const defaultDiffer = compositeExpenseDiffer([
  titleDiffer,
  amountDiffer,
  dateDiffer,
  categoryDiffer,
  notesDiffer,
  recurrenceDiffer,
  payersDiffer,
  splitDiffer,
  itemsDiffer,
  documentsDiffer,
])

// ---------------------------------------------------------------------------
// Backward-compatible public API
// ---------------------------------------------------------------------------

/**
 * Lightweight, field-grouped diff between two expense versions. Returns
 * the list of field groups whose value differs, or `null` when nothing
 * meaningful changed.
 *
 * Delegates to the default composite differ's `changedFields()`.
 */
export function getExpenseChangedFields(
  oldExpense: DifferenceableExpense,
  newExpense: DifferenceableExpense,
): ExpenseChangedField[] | null {
  return defaultDiffer.changedFields(oldExpense, newExpense)
}

/**
 * Full change summary for the activity feed. Returns both a
 * backward-compatible `changedFields` list and per-field before/after
 * strings suitable for compact rendering in the activity feed.
 *
 * Delegates to the default composite differ.
 */
export function getExpenseChangeSummary(
  oldExpense: DifferenceableExpense,
  newExpense: DifferenceableExpense,
  ctx: ChangeContext,
): {
  changedFields: ExpenseChangedField[]
  changes: ExpenseActivityChange[]
} | null {
  const diffs = defaultDiffer.changeSummary(oldExpense, newExpense, ctx)
  if (!diffs) return null
  return {
    changedFields: diffs.map((d) => d.field),
    changes: diffs as ExpenseActivityChange[],
  }
}
