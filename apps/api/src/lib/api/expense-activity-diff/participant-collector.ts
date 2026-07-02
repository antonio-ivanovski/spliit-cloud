import type { DifferenceableExpense } from './types'

// ---------------------------------------------------------------------------
// Participant ID collector — notification scope, not a diff
// ---------------------------------------------------------------------------

/**
 * Union of every `ledgerParticipantId` referenced by old and new expense
 * payer / split / item / remainder data. Used to determine who must be
 * notified of an update: anyone whose presence in the expense changed,
 * including someone who used to be referenced but no longer is, as long
 * as they are still an active group member.
 *
 * Tolerates undefined for both sides so the helper supports create (old
 * undefined) and delete (new undefined) without explicit branching.
 */
export function getAffectedParticipantIds({
  oldExpense,
  newExpense,
}: {
  oldExpense?: DifferenceableExpense
  newExpense?: DifferenceableExpense
}): Set<string> {
  const ids = new Set<string>()
  const collect = (e: DifferenceableExpense | undefined) => {
    if (!e) return
    for (const row of e.paidByList) ids.add(row.participant)
    for (const row of e.paidFor) ids.add(row.participant)
    for (const item of e.items ?? []) {
      for (const row of item.paidFor) ids.add(row.participant)
    }
    if (e.itemizedRemainder) {
      for (const row of e.itemizedRemainder.paidFor) ids.add(row.participant)
    }
  }
  collect(oldExpense)
  collect(newExpense)
  return ids
}
