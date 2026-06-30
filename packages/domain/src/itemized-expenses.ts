import type { SplitMode } from './enums'
import type { ExpenseApiItem } from './schemas'

/**
 * Distribute `amount` (minor units) across `count` buckets evenly.
 * Each of the first `count - 1` buckets gets `Math.floor(amount / count)`;
 * the last bucket gets the remainder (cents-remainder absorption).
 */
function distributeEvenly(amount: number, count: number): number[] {
  if (count === 0) return []
  const base = Math.floor(amount / count)
  const result = new Array(count).fill(base)
  const remainder = amount - base * count
  if (remainder > 0) {
    result[count - 1] += remainder
  }
  return result
}

/**
 * Distribute `amount` (minor units) across participants according to their
 * share weights. Last participant absorbs cents remainder.
 */
function distributeWeighted(
  amount: number,
  shares: number[],
  totalShares: number,
): number[] {
  if (shares.length === 0) return []
  const result: number[] = []
  let remaining = amount
  for (let i = 0; i < shares.length; i++) {
    const isLast = i === shares.length - 1
    const share = isLast
      ? remaining
      : Math.floor((amount * shares[i]) / totalShares)
    result.push(share)
    remaining -= share
  }
  return result
}

/**
 * Compute per-participant amounts for a single item given its split mode and
 * paidFor participants. Returns amounts keyed by participant id, in minor units.
 */
function distributeItem(
  item: ExpenseApiItem,
): Array<{ participant: string; amount: number }> {
  const { paidFor, splitMode, amount } = item
  const participantIds = paidFor.map((p) => p.participant)

  if (participantIds.length === 0) return []

  let distributed: number[]

  switch (splitMode) {
    case 'EVENLY':
      distributed = distributeEvenly(amount, paidFor.length)
      break
    case 'BY_SHARES': {
      const totalShares = paidFor.reduce((s, p) => s + p.shares, 0)
      distributed = distributeWeighted(
        amount,
        paidFor.map((p) => p.shares),
        totalShares,
      )
      break
    }
    case 'BY_PERCENTAGE': {
      const totalBasis = paidFor.reduce((s, p) => s + p.shares, 0)
      // Basis points: shares are out of 10000
      distributed = distributeWeighted(
        amount,
        paidFor.map((p) => p.shares),
        totalBasis,
      )
      break
    }
    case 'BY_AMOUNT':
      distributed = paidFor.map((p) => p.shares)
      break
    default:
      distributed = []
  }

  return participantIds.map((id, i) => ({
    participant: id,
    amount: distributed[i] ?? 0,
  }))
}

/**
 * Pure: given items + group members + expense amount, derive paidFor rows.
 *
 * Walks items in order. Each item is distributed independently according to
 * its own splitMode (EVENLY / BY_SHARES / BY_PERCENTAGE / BY_AMOUNT).
 * Cents-remainder is absorbed by the last participant in each item's paidFor
 * list (standard minor-unit rounding strategy).
 *
 * If sum(item.amount) < expenseAmount, a synthetic "Other (unaccounted)"
 * filler is distributed EVENLY across all groupMemberIds. This filler is
 * NOT persisted as an item — it exists only to make `paidFor` sum to the
 * expense total so that balances remain consistent. The "Other" label is a
 * UI concern and lives in i18n.
 *
 * If sum(item.amount) > expenseAmount, throws Error('ITEMS_EXCEED_AMOUNT').
 *
 * Each row's shares are in ledger base-currency minor units (cents for USD/EUR).
 * Sum of all `paidFor.shares` equals `expenseAmount` (within integer math).
 * The returned shape is intended to feed straight into the BY_AMOUNT arms of
 * `getBalances` and `calculateShare`.
 *
 * @returns paidFor rows (shares = cents per participant, summing to expenseAmount)
 *   and effectiveAmount (always equals expenseAmount).
 */
export function computePaidForFromItems(
  items: ExpenseApiItem[],
  groupMemberIds: string[],
  expenseAmount: number,
  itemizedRemainder?: {
    paidFor: ExpenseApiItem['paidFor']
    splitMode: ExpenseApiItem['splitMode']
  },
): {
  paidFor: Array<{ participant: string; shares: number }>
  effectiveAmount: number
} {
  const itemsSum = items.reduce((s, i) => s + i.amount, 0)

  if (itemsSum > expenseAmount) {
    throw new Error('ITEMS_EXCEED_AMOUNT')
  }

  // Aggregate per-participant amounts across all items
  const perParticipant: Record<string, number> = {}

  for (const item of items) {
    const distributions = distributeItem(item)
    for (const { participant, amount } of distributions) {
      perParticipant[participant] = (perParticipant[participant] ?? 0) + amount
    }
  }

  // Filler: if items sum < amount, distribute the remainder using the
  // configured synthetic row split. The fallback preserves the legacy behavior.
  const filler = expenseAmount - itemsSum
  if (filler > 0) {
    const fillerItem: ExpenseApiItem = {
      title: 'Other',
      unitPrice: filler,
      quantity: 1,
      amount: filler,
      paidFor: itemizedRemainder?.paidFor.length
        ? itemizedRemainder.paidFor
        : groupMemberIds.map((participant) => ({ participant, shares: 1 })),
      splitMode: itemizedRemainder?.splitMode ?? 'EVENLY',
    }
    const fillerDistributions = distributeItem(fillerItem)
    for (const { participant, amount } of fillerDistributions) {
      perParticipant[participant] = (perParticipant[participant] ?? 0) + amount
    }
  }

  // Return one row per participant with shares = exact cents (BY_AMOUNT semantic)
  const paidFor = Object.entries(perParticipant).map(
    ([participant, amount]) => ({
      participant,
      shares: amount,
    }),
  )

  return { paidFor, effectiveAmount: expenseAmount }
}

/**
 * Pure: when leaving ITEMIZED mode, produce default paidFor for the given
 * non-Itemized splitMode and group members.
 *
 * - EVENLY: one row per member, shares = 1
 * - BY_SHARES: one row per member, shares = 1
 * - BY_PERCENTAGE: distribute 10000 basis points evenly (last absorbs remainder)
 * - BY_AMOUNT: distribute expenseAmount evenly in minor units (last absorbs remainder)
 *
 * Cents-remainder absorption follows standard minor-unit rounding: the last
 * participant in the list gets any remainder to ensure the sum exactly equals
 * the target.
 */
export function buildDefaultPaidForForSplitMode(
  splitMode: Exclude<SplitMode, 'ITEMIZED'>,
  groupMemberIds: string[],
  expenseAmount: number,
): Array<{ participant: string; shares: number }> {
  const n = groupMemberIds.length
  if (n === 0) return []

  switch (splitMode) {
    case 'EVENLY':
      return groupMemberIds.map((id) => ({ participant: id, shares: 1 }))
    case 'BY_SHARES':
      return groupMemberIds.map((id) => ({ participant: id, shares: 1 }))
    case 'BY_PERCENTAGE': {
      const even = distributeEvenly(10000, n)
      return groupMemberIds.map((id, i) => ({
        participant: id,
        shares: even[i],
      }))
    }
    case 'BY_AMOUNT': {
      const even = distributeEvenly(expenseAmount, n)
      return groupMemberIds.map((id, i) => ({
        participant: id,
        shares: even[i],
      }))
    }
    default:
      return groupMemberIds.map((id) => ({ participant: id, shares: 1 }))
  }
}
