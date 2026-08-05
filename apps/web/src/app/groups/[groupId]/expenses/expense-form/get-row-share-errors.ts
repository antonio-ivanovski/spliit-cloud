import {
  getDisplayShareErrorKey,
  type ShareErrorKey,
  type SplitMode,
} from '@spliit/domain'

export type RowShareError = {
  index: number
  participantId: string
  messageKey: ShareErrorKey
}

type RowShare = { participant: string; shares: number | string }

/**
 * Per-row share validation for the card summary, computed from the live form
 * values.
 *
 * RHF's error tree replaces the `paidFor` / `paidByList` subtree with the
 * array-level sum issue (`amountSum` / `percentageSum`) when both exist, so
 * per-row messages vanish exactly when the user needs them. This helper
 * recomputes the row-level issues from the current values so the card can show
 * a summary above the rows regardless of the error-tree clobbering.
 *
 * The per-row decision itself is `getDisplayShareErrorKey` from the domain
 * package — the same single source the Zod form schema uses — so the summary
 * and validation can never drift apart.
 */
export function getRowShareErrors(args: {
  rows: RowShare[]
  splitMode: SplitMode
  /**
   * Mirrors the schema guard: share rows are not validated while the amount
   * itself is zero/invalid.
   */
  amount: number
  /** Paid-by shares may be signed (negative income expenses). */
  allowNegative?: boolean
}): RowShareError[] {
  const { rows, splitMode, amount, allowNegative = false } = args
  if (splitMode === 'EVENLY' || splitMode === 'ITEMIZED') return []
  if (amount === 0) return []

  const errors: RowShareError[] = []
  rows.forEach((row, index) => {
    const messageKey = getDisplayShareErrorKey(Number(row.shares), splitMode, {
      allowNegative,
    })
    if (messageKey) {
      errors.push({
        index,
        participantId: row.participant,
        messageKey,
      })
    }
  })
  return errors
}
