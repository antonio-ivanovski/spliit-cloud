import Decimal from 'decimal.js'
import type { SplitMode } from './enums'
import type { ExpenseApiItem } from './schemas'
import { calculateExactShares, distributeRemainder } from './totals'

type ItemPaidFor = Array<{ participant: string; shares: number }>

type ItemLike = {
  amount: number
  splitMode: SplitMode
  paidFor: ItemPaidFor
}

type ItemizedRemainderLike = {
  paidFor: ItemPaidFor
  splitMode: SplitMode
}

/**
 * Exact (non-truncated) paidFor shares from items + filler.
 * Used by getBalances so multi-expense totals don't inherit per-expense
 * remainder tie-breaks sealed into stored paidFor cents.
 */
export function computeExactSharesFromItems(
  items: ItemLike[],
  groupMemberIds: string[],
  expenseAmount: number,
  itemizedRemainder?: ItemizedRemainderLike,
): Record<string, Decimal> {
  const itemsSum = items.reduce((s, i) => s + i.amount, 0)

  if (itemsSum > expenseAmount) {
    throw new Error('ITEMS_EXCEED_AMOUNT')
  }

  const exact: Record<string, Decimal> = {}

  const accumulate = (
    amount: number,
    splitMode: SplitMode,
    paidFor: ItemPaidFor,
  ) => {
    if (paidFor.length === 0 || amount === 0) return
    const shares = calculateExactShares({
      amount,
      splitMode,
      participants: paidFor.map((p) => ({
        id: p.participant,
        shares: Number(p.shares),
      })),
    })
    for (const [id, value] of Object.entries(shares)) {
      exact[id] = (exact[id] ?? new Decimal(0)).plus(value)
    }
  }

  // Only items with participants contribute; empty-paidFor holes go to filler.
  let distributedItemsSum = 0
  for (const item of items) {
    if (item.paidFor.length === 0) continue
    distributedItemsSum += item.amount
    accumulate(item.amount, item.splitMode, item.paidFor)
  }

  const filler = expenseAmount - distributedItemsSum
  if (filler > 0) {
    const fillerPaidFor = itemizedRemainder?.paidFor.length
      ? itemizedRemainder.paidFor
      : groupMemberIds.map((participant) => ({ participant, shares: 1 }))
    const fillerSplitMode = itemizedRemainder?.splitMode ?? 'EVENLY'
    accumulate(filler, fillerSplitMode, fillerPaidFor)
  }

  return exact
}

/**
 * Pure: given items + group members + expense amount, derive paidFor rows.
 *
 * Accumulates exact Decimal shares across all items (and optional filler),
 * then truncates once via distributeRemainder so cross-item drift is zero.
 *
 * If sum(item.amount) < expenseAmount, a synthetic "Other (unaccounted)"
 * filler is distributed using itemizedRemainder (or EVENLY across members).
 * If sum(item.amount) > expenseAmount, throws Error('ITEMS_EXCEED_AMOUNT').
 */
export function computePaidForFromItems(
  items: ExpenseApiItem[],
  groupMemberIds: string[],
  expenseAmount: number,
  itemizedRemainder?: {
    paidFor: ExpenseApiItem['paidFor']
    splitMode: ExpenseApiItem['splitMode']
  },
  expenseDate?: Date | string | number | null,
): {
  paidFor: Array<{ participant: string; shares: number }>
  effectiveAmount: number
} {
  const exact = computeExactSharesFromItems(
    items,
    groupMemberIds,
    expenseAmount,
    itemizedRemainder,
  )

  const seed =
    expenseDate == null
      ? 0
      : expenseDate instanceof Date
        ? expenseDate.getTime()
        : typeof expenseDate === 'number'
          ? expenseDate
          : (() => {
              const t = new Date(expenseDate).getTime()
              return Number.isFinite(t) ? t : 0
            })()

  const distributed = distributeRemainder(exact, expenseAmount, { seed })

  const paidFor = Object.entries(distributed).map(([participant, shares]) => ({
    participant,
    shares,
  }))

  return { paidFor, effectiveAmount: expenseAmount }
}

/**
 * Pure: when leaving ITEMIZED mode, produce default paidFor for the given
 * non-Itemized splitMode and group members.
 *
 * Canonical weights/BPS (no last-absorbs remainder):
 * - EVENLY / BY_SHARES → shares: 1
 * - BY_PERCENTAGE → Math.floor(10000 / n)
 * - BY_AMOUNT → Math.floor(amount / n)
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
    case 'BY_SHARES':
      return groupMemberIds.map((id) => ({ participant: id, shares: 1 }))
    case 'BY_PERCENTAGE': {
      const base = Math.floor(10000 / n)
      return groupMemberIds.map((id) => ({ participant: id, shares: base }))
    }
    case 'BY_AMOUNT': {
      const base = Math.floor(expenseAmount / n)
      return groupMemberIds.map((id) => ({ participant: id, shares: base }))
    }
    default:
      return groupMemberIds.map((id) => ({ participant: id, shares: 1 }))
  }
}
