import type { Expense } from '@spliit/domain'
import type { ExpenseChangedField } from '@spliit/domain/activities'
import type {
  ActivityDiffer,
  DiffEmission as GenericDiffEmission,
} from '../activity-diff/types'

// ---------------------------------------------------------------------------
// Core types
// ---------------------------------------------------------------------------

export type ShareRow = { participant: string; shares: number }
export type ItemizedRemainderLike = NonNullable<Expense['itemizedRemainder']>
export type DifferenceableExpense = Expense

/** Context for formatting human-readable before/after strings. */
export type ChangeContext = {
  getParticipantName: (id: string) => string
  getCategoryName: (id: string) => string
  /** Format an integer minor-unit amount with its currency code. */
  formatCurrencyCents: (cents: number, currency: string | null) => string
}

/** A single diff emission produced by one narrow-purpose differ. */
export type DiffEmission = GenericDiffEmission<ExpenseChangedField>

/**
 * A self-contained differ that detects and formats changes for a single
 * expense field group. Each differ has a single narrow responsibility.
 *
 * Differs are plain objects — no classes — that are composed by the
 * composite differ which iterates through them collecting emissions.
 */
export type ExpenseDiffer = ActivityDiffer<
  DifferenceableExpense,
  ExpenseChangedField,
  ChangeContext,
  DiffEmission
>
