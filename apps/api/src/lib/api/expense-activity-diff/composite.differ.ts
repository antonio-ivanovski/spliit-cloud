import type { Expense } from '@spliit/domain'
import type { ExpenseChangedField } from '@spliit/domain/activities'
import type { ChangeContext, DiffEmission, ExpenseDiffer } from './types'

// ---------------------------------------------------------------------------
// Composite differ — iterates through all child differs and collects results
// ---------------------------------------------------------------------------

/**
 * The grand expense differ that composes all individual field differs.
 *
 * Iterates through every registered child differ, collects each one's
 * emission, and returns the complete set of changes. This is the
 * composition root for the diff pipeline.
 *
 * Each child differ is independently testable; the composite is tested
 * with smoke-level integration tests.
 */
export const compositeExpenseDiffer = (differs: ExpenseDiffer[]) => ({
  /** Returns the ordered list of child differs. */
  getDiffers(): ReadonlyArray<ExpenseDiffer> {
    return differs
  },

  /**
   * Run all child differs' `check()` methods and return changed field names.
   * Returns `null` when nothing changed.
   */
  changedFields(
    oldExpense: Expense,
    newExpense: Expense,
  ): ExpenseChangedField[] | null {
    const fields = differs
      .filter((d) => d.check(oldExpense, newExpense))
      .map((d) => d.field)
    return fields.length > 0 ? fields : null
  },

  /**
   * Run all child differs' `diff()` methods and collect emissions.
   * Returns `null` when nothing changed.
   */
  changeSummary(
    oldExpense: Expense,
    newExpense: Expense,
    ctx: ChangeContext,
  ): DiffEmission[] | null {
    const diffs = differs
      .map((d) => d.diff(oldExpense, newExpense, ctx))
      .filter((e): e is DiffEmission => e !== null)
    return diffs.length > 0 ? diffs : null
  },
})

/** Return type of {@link compositeExpenseDiffer}. */
export type CompositeExpenseDiffer = ReturnType<typeof compositeExpenseDiffer>
