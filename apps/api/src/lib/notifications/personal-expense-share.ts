import type { Balances } from '@spliit/domain'

/**
 * Per-recipient share of a single expense, captured at notification plan time.
 * Amounts are integer minor units in `currencyCode` (the expense's ledger
 * currency). `paid` is what the recipient fronted, `owed` is their share of the
 * split.
 */
export type PersonalExpenseShare = {
  paid: number
  owed: number
  currencyCode: string | null
  isSettlement: boolean
}

/**
 * Look up one ledger participant's share in single-expense balances (as
 * returned by `getBalances([expense])`, keyed by ledger participant id).
 * Returns null when the participant has no computed share or when both sides
 * are zero, so callers fall back to the generic notification copy.
 */
export function personalShareForRecipient(args: {
  balances: Balances
  ledgerParticipantId: string | undefined
  currencyCode: string | null
  isSettlement: boolean
}): PersonalExpenseShare | null {
  if (!args.ledgerParticipantId) return null
  const entry = args.balances[args.ledgerParticipantId]
  if (!entry) return null
  if (entry.paid === 0 && entry.paidFor === 0) return null
  // Income and refund expenses carry negative shares, which have no sensible
  // "You owe X" rendering. Fall back to the generic copy instead of
  // producing a snapshot the delivery schema rejects (which would abort the
  // whole fan-out at parse time).
  if (
    !Number.isInteger(entry.paid) ||
    !Number.isInteger(entry.paidFor) ||
    entry.paid < 0 ||
    entry.paidFor < 0
  ) {
    return null
  }
  return {
    paid: entry.paid,
    owed: entry.paidFor,
    currencyCode: args.currencyCode,
    isSettlement: args.isSettlement,
  }
}

/**
 * Render the one-line personal callout for an expense notification.
 * `formatAmount` converts integer minor units to display text so the planner
 * (push body, recipient locale at plan time) and the email sender (render time
 * locale) share one wording. Returns null when there is nothing worth saying,
 * so callers keep the generic copy.
 */
export function formatPersonalShareLine(
  share: PersonalExpenseShare,
  formatAmount: (cents: number) => string | null,
): string | null {
  if (share.isSettlement) {
    const net = share.paid - share.owed
    if (net === 0) return null
    const amount = formatAmount(Math.abs(net))
    if (amount == null) return null
    return net > 0 ? `You lent ${amount}` : `You borrowed ${amount}`
  }
  const parts: string[] = []
  if (share.owed > 0) {
    const owed = formatAmount(share.owed)
    if (owed == null) return null
    parts.push(`You owe ${owed}`)
  }
  if (share.paid > 0) {
    const paid = formatAmount(share.paid)
    if (paid == null) return null
    parts.push(`You paid ${paid}`)
  }
  if (parts.length === 0) return null
  return parts.join(' · ')
}
