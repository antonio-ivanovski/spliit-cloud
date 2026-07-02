import type { ChangeContext, ItemizedRemainderLike, ShareRow } from './types'

// ---------------------------------------------------------------------------
// Payer semantics — avoids false positives when shares derive from amount
// ---------------------------------------------------------------------------

/**
 * Encapsulates the payer-row comparison semantics that prevent false-positive
 * payer diffs when shares are derived from the total amount.
 *
 * When `paidBySplitMode` is `BY_AMOUNT`, shares are proportional to the
 * expense total. Changing only the amount should NOT flag a payer change even
 * though share numbers change.
 */
export const payerSemantics = {
  /** Stable, order-independent, mode-aware comparison key for payer rows. */
  key(rows: ReadonlyArray<ShareRow>, mode: string): string {
    const sorted = [...rows].sort((a, b) =>
      a.participant.localeCompare(b.participant),
    )
    if (mode === 'BY_AMOUNT') {
      return sorted.map((r) => r.participant).join('|')
    }
    return sorted.map((r) => `${r.participant}:${r.shares}`).join('|')
  },

  /** Format payer rows as a comma-separated list of participant names. */
  format(rows: ReadonlyArray<ShareRow>, ctx: ChangeContext): string {
    return rows.map((r) => ctx.getParticipantName(r.participant)).join(', ')
  },
}

// ---------------------------------------------------------------------------
// Split semantics — avoids false positives from row reordering
// ---------------------------------------------------------------------------

/**
 * Encapsulates the split-rows comparison semantics that prevent false-positive
 * split diffs due to row reordering.
 */
export const splitSemantics = {
  /** Order-independent comparison key for paid-for rows. */
  paidForKey(rows: ReadonlyArray<ShareRow>): string {
    return [...rows]
      .sort((a, b) => a.participant.localeCompare(b.participant))
      .map((r) => `${r.participant}:${r.shares}`)
      .join('|')
  },

  /** Comparison key for the itemized remainder block. */
  remainderKey(r: ItemizedRemainderLike | undefined): string {
    if (!r) return ''
    return `${r.splitMode}|${this.paidForKey(r.paidFor)}`
  },

  /** Format a split description (mode + participant names with shares). */
  format(
    mode: string,
    rows: ReadonlyArray<ShareRow>,
    ctx: ChangeContext,
  ): string {
    const names = rows
      .map((r) => {
        const name = ctx.getParticipantName(r.participant)
        if (mode === 'BY_PERCENTAGE') return `${name} ${r.shares / 100}%`
        if (mode === 'BY_SHARES') return `${name} ${r.shares}`
        return name
      })
      .join(', ')
    const modeLabel = mode === 'EVENLY' ? 'Equal split' : `Custom split`
    return `${modeLabel}: ${names}`
  },
}
