import type { ExpenseDiffer } from './types'

/**
 * Detects and formats changes to the expense notes.
 *
 * The check is purely about presence/absence (not content), avoiding leaking
 * note text into the activity feed. Before/after use semantic labels: "Added",
 * "Removed", or "Present" (when content changed but notes exist on both
 * sides).
 *
 * Empty / null / undefined / whitespace-only notes are normalized to a single
 * canonical representation so the round-trip between DB (nullable text) and the
 * form (empty string) does not produce a false-positive diff when the user did
 * not actually change the notes.
 */
function normalize(notes: string | null | undefined): string {
  return (notes ?? '').trim()
}

function hasContent(notes: string | null | undefined): boolean {
  return normalize(notes) !== ''
}

export const notesDiffer: ExpenseDiffer = {
  field: 'notes',

  check(oldExpense, newExpense) {
    return normalize(oldExpense.notes) !== normalize(newExpense.notes)
  },

  diff(oldExpense, newExpense) {
    if (!this.check(oldExpense, newExpense)) return null

    const hadNotes = hasContent(oldExpense.notes)
    const hasNotes = hasContent(newExpense.notes)

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
