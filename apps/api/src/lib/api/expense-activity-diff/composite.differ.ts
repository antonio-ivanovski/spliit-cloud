import type { Expense } from '@spliit/domain'
import type { ExpenseChangedField } from '@spliit/domain/activities'

import { createCompositeDiffer } from '../activity-diff/composite.differ'
import type { ChangeContext, DiffEmission, ExpenseDiffer } from './types'

// ---------------------------------------------------------------------------
// Composite differ — iterates through all child differs and collects results
// ---------------------------------------------------------------------------

/**
 * The grand expense differ that composes all individual field differs.
 *
 * Iterates through every registered child differ, collects each one's emission,
 * and returns the complete set of changes. This is the composition root for the
 * diff pipeline.
 *
 * Each child differ is independently testable; the composite is tested with
 * smoke-level integration tests.
 */
export const compositeExpenseDiffer = (differs: ExpenseDiffer[]) =>
  createCompositeDiffer<
    Expense,
    ExpenseChangedField,
    ChangeContext,
    DiffEmission
  >(differs)

/** Return type of {@link compositeExpenseDiffer}. */
export type CompositeExpenseDiffer = ReturnType<typeof compositeExpenseDiffer>
