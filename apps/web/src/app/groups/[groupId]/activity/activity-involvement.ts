/**
 * Viewer involvement for activity rows. Mirrors `isExpenseInvolvingUser` (see
 * `../expenses/expense-involvement`) but prefers the stored point-in-time
 * participant snapshot when the activity carries one.
 *
 * Resolution order per row:
 *
 * 1. No identity (logged-out `viewKey`/invite viewers with no participant yet) —
 *    involvement can't be determined, everything counts as involving.
 * 2. Stored `affectedParticipants` snapshot — exact participants as of the event,
 *    including item-level splits the live expense projection doesn't carry.
 *    Applies to every activity kind that persists the snapshot (`expense`,
 *    `import_summary`, `recurring_expense_summary`, `recurring_expense_stopped`
 *    — the same set the list endpoint strips for read-only viewers). Requires a
 *    ledger-participant id; account-only viewers can't match it, so they see
 *    everything.
 * 3. Live expense splits — covers pre-backfill rows whose expense still exists
 *    (same payer-or-beneficiary rule as the expenses list).
 * 4. Anything else (non-expense rows, deleted expenses without a snapshot,
 *    malformed rows) — unknown means visible, never silently hidden.
 */

export type ActivityInvolvementSide = {
  ledgerParticipant: {
    id: string
    account?: { id: string } | null
  }
}

export type ActivityInvolvementExpense = {
  paidByList: ActivityInvolvementSide[]
  paidFor: ActivityInvolvementSide[]
} | null

export type ActivityInvolvementData = {
  kind: string
  affectedParticipants?: string[]
} | null

export function isActivityInvolvingUser(
  activity: {
    data: ActivityInvolvementData
    expense: ActivityInvolvementExpense | null | undefined
  },
  participantId: string | null | undefined,
  accountId: string | null | undefined,
): boolean {
  if (!participantId && !accountId) return true
  const data = activity.data
  // An empty snapshot means "no split rows found", not "involves nobody" —
  // fall through to the live-split/visible fallbacks below.
  if (
    (data?.kind === 'expense' ||
      data?.kind === 'import_summary' ||
      data?.kind === 'recurring_expense_summary' ||
      data?.kind === 'recurring_expense_stopped') &&
    Array.isArray(data.affectedParticipants) &&
    data.affectedParticipants.length > 0
  ) {
    if (!participantId) return true
    return data.affectedParticipants.includes(participantId)
  }
  const expense = activity.expense
  if (expense) {
    const sides = [...expense.paidByList, ...expense.paidFor]
    return sides.some(
      (side) =>
        (participantId != null &&
          side.ledgerParticipant.id === participantId) ||
        (accountId != null && side.ledgerParticipant.account?.id === accountId),
    )
  }
  return true
}
