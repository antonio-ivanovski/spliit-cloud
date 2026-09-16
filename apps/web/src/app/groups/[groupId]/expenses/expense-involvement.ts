/**
 * Minimal wire shape needed to decide whether an expense involves the viewer.
 * Matches the `paidByList` / `paidFor` projection of the group expense-list
 * endpoint (`ledgerParticipant.id` plus the backing `account.id` fallback).
 */
export type InvolvementSide = {
  ledgerParticipant: {
    id: string
    account?: { id: string } | null
  }
}

export type InvolvementExpense = {
  paidByList: InvolvementSide[]
  paidFor: InvolvementSide[]
}

/**
 * An expense involves the viewer when they paid for it or owe a share of it
 * (list-level `paidByList` / `paidFor`). Item-level splits are out of scope —
 * the list endpoint doesn't return them.
 *
 * When neither identity is known (logged-out `viewKey`/invite viewers with no
 * participant yet), involvement can't be determined, so every expense counts as
 * involving and the timeline shows everything.
 */
export function isExpenseInvolvingUser(
  expense: InvolvementExpense,
  participantId: string | null | undefined,
  accountId: string | null | undefined,
): boolean {
  if (!participantId && !accountId) return true
  const sides = [...expense.paidByList, ...expense.paidFor]
  return sides.some(
    (side) =>
      (participantId != null && side.ledgerParticipant.id === participantId) ||
      (accountId != null && side.ledgerParticipant.account?.id === accountId),
  )
}
