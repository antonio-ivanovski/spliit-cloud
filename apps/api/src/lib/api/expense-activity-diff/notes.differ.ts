import type { ExpenseDiffer } from './types'

/**
 * Detects and formats changes to the expense notes.
 *
 * The check is purely about presence/absence (not content), avoiding
 * leaking note text into the activity feed. Before/after use semantic
 * labels: "Added", "Removed", or "Present" (when content changed but
 * notes exist on both sides).
 */
export const notesDiffer: ExpenseDiffer = {
  field: 'notes',

  check(oldExpense, newExpense) {
    return (oldExpense.notes ?? null) !== (newExpense.notes ?? null)
  },

  diff(oldExpense, newExpense) {
    if (!this.check(oldExpense, newExpense)) return null

    const hadNotes = !!oldExpense.notes
    const hasNotes = !!newExpense.notes

    let before: string | null = null
    let after: string | null = null
    if (!hadNotes && hasNotes) {
      after = 'Added'
    } else if (hadNotes && !hasNotes) {
      before = 'Removed'
    } else {
      // Both present — content changed but we never leak the text.
      before = 'Present'
      after = 'Present'
    }
    return { field: 'notes', before, after }
  },
}
