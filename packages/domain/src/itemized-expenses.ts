import type { RemainderAllocationMode, SplitMode } from './enums'
import {
  addExactAmount,
  exactFromFraction,
  type ExactAmount,
} from './exact-math'
import { distributeRemainder } from './remainder-distribution'
import type { ExpenseApiItem } from './schemas'
import { calculateExactShares } from './totals'
import { expenseIdSeed } from './utils'

export type ItemPaidFor = Array<{ participant: string; shares: number }>

export type ItemLike = {
  amount: number
  splitMode: SplitMode
  paidFor: ItemPaidFor
}

export type ItemizedRemainderLike = {
  paidFor: ItemPaidFor
  splitMode: SplitMode
  allocationMode?: RemainderAllocationMode
}

export type ProportionalBasisError =
  | 'UNASSIGNED_ITEMS'
  | 'ZERO_BASIS'
  | 'INVALID_RATIOS'
  | null

/**
 * Check whether a nonzero filler can be allocated proportionally.
 *
 * Returns null when allocation is valid (or when filler is zero, which needs no
 * basis). Otherwise returns a stable error discriminator the schemas and UI map
 * to translated messages:
 *
 * - UNASSIGNED_ITEMS: some item has no participants.
 * - ZERO_BASIS: total item subtotal is zero or has the wrong sign.
 * - INVALID_RATIOS: some participant's net subtotal has the opposite sign.
 *
 * Zero-subtotal participants are valid and receive zero filler.
 */
export function getProportionalBasisError(
  items: ItemLike[],
  distributedItemsSum: number,
  exactSubtotals: Record<string, ExactAmount>,
  expenseAmount: number,
  filler: number,
): ProportionalBasisError {
  if (filler === 0) return null
  if (items.some((item) => item.paidFor.length === 0)) {
    return 'UNASSIGNED_ITEMS'
  }
  if (distributedItemsSum === 0) return 'ZERO_BASIS'
  // The basis must point the same way as the expense so ratios stay positive.
  // This still allows net-valid discounts/refunds (e.g. +1000/-100 net +900).
  if (Math.sign(distributedItemsSum) !== Math.sign(expenseAmount)) {
    return 'ZERO_BASIS'
  }
  for (const subtotal of Object.values(exactSubtotals)) {
    if (subtotal.numerator === 0n) continue
    // subtotal / total >= 0  <=>  same sign (total is nonzero here).
    // Exact denominator is always positive (see exactFromFraction), so only
    // the numerator sign matters alongside the total's sign.
    const sameSign = subtotal.numerator > 0n === distributedItemsSum > 0
    if (!sameSign) return 'INVALID_RATIOS'
  }
  return null
}
/**
 * Self-contained proportional-basis check for validation layers (schemas, UI).
 *
 * Uses float sign accumulation instead of exact rationals so form display units
 * (fractional majors, percentages, decimal shares) never hit `BigInt` on
 * non-integers. Sub-cent float dust is treated as zero; the API integer path
 * and the calculation above remain exactly authoritative.
 */
export function getProportionalRemainderError(
  items: ItemLike[],
  expenseAmount: number,
): ProportionalBasisError {
  let distributedItemsSum = 0
  const subtotals = new Map<string, number>()
  for (const item of items) {
    if (item.paidFor.length === 0) continue
    distributedItemsSum += item.amount
    if (item.amount === 0) continue
    for (const row of item.paidFor) {
      const shares = Number(row.shares)
      if (!Number.isFinite(shares) || shares === 0) continue
      // EVENLY rows are inclusion markers; every other mode scales with the
      // row's own sign (BY_AMOUNT rows may be signed discounts).
      const weight = item.splitMode === 'EVENLY' ? 1 : Math.sign(shares)
      if (weight === 0) continue
      const signed = Math.sign(item.amount) * weight
      if (signed === 0) continue
      subtotals.set(
        row.participant,
        (subtotals.get(row.participant) ?? 0) + signed,
      )
    }
  }
  const filler = expenseAmount - distributedItemsSum
  // Sub-cent float dust from display-unit arithmetic counts as zero: a zero
  // remainder retains its mode without basis validation.
  if (Math.abs(filler) < 1e-9) return null
  if (items.some((item) => item.paidFor.length === 0)) {
    return 'UNASSIGNED_ITEMS'
  }
  if (
    Math.abs(distributedItemsSum) < 1e-9 ||
    Math.sign(distributedItemsSum) !== Math.sign(expenseAmount)
  ) {
    return 'ZERO_BASIS'
  }
  const totalPositive = distributedItemsSum > 0
  for (const net of subtotals.values()) {
    if (Math.abs(net) < 1e-9) continue
    if (net > 0 !== totalPositive) return 'INVALID_RATIOS'
  }
  return null
}

/**
 * Normalize a remainder to its canonical stored shape. Proportional rules
 * derive weights from item subtotals at read time, so any caller-supplied rows
 * are junk that would sit in the DB (and exports) without ever affecting math.
 * Custom rules pass through untouched.
 */
export function canonicalizeItemizedRemainder<
  T extends {
    allocationMode?: string
    splitMode: string
    paidFor: Array<{ participant: string; shares: number }>
  },
>(remainder: T): T {
  if (remainder.allocationMode !== 'PROPORTIONAL') return remainder
  return { ...remainder, splitMode: 'EVENLY', paidFor: [] }
}
/**
 * Whether item subtotals overshoot an expense in the expense's direction.
 *
 * Positive expenses retain the original `items > amount` rule. Negative
 * expenses use the mirrored comparison so a signed "Other" remainder can
 * account for the still-unitemized part of a negative expense.
 */
export function itemsExceedExpenseAmount(
  itemsAmount: number,
  expenseAmount: number,
): boolean {
  return expenseAmount < 0
    ? itemsAmount < expenseAmount
    : itemsAmount > expenseAmount
}

/**
 * Exact (non-truncated) paidFor shares from items + filler. Used by getBalances
 * so multi-expense totals don't inherit per-expense remainder tie-breaks sealed
 * into stored paidFor cents.
 */
export function computeExactSharesFromItems(
  items: ItemLike[],
  groupMemberIds: string[],
  expenseAmount: number,
  itemizedRemainder?: ItemizedRemainderLike,
): Record<string, ExactAmount> {
  const itemsSum = items.reduce((s, i) => s + i.amount, 0)

  if (itemsExceedExpenseAmount(itemsSum, expenseAmount)) {
    throw new Error('ITEMS_EXCEED_AMOUNT')
  }

  const exact: Record<string, ExactAmount> = {}

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
      const current = exact[id]
      exact[id] = current ? addExactAmount(current, value) : value
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
  if (filler !== 0) {
    if (itemizedRemainder?.allocationMode === 'PROPORTIONAL') {
      const basisError = getProportionalBasisError(
        items,
        distributedItemsSum,
        exact,
        expenseAmount,
        filler,
      )
      if (basisError) {
        throw new Error(
          basisError === 'UNASSIGNED_ITEMS'
            ? 'PROPORTIONAL_UNASSIGNED_ITEMS'
            : basisError === 'ZERO_BASIS'
              ? 'PROPORTIONAL_ZERO_BASIS'
              : 'PROPORTIONAL_INVALID_RATIOS',
        )
      }
      // Pure pro-rata: filler × participantSubtotal ÷ totalSubtotal in exact
      // rational arithmetic. Zero-subtotal participants get zero filler and
      // stay omitted when their grand total is zero.
      const subtotals = { ...exact }
      for (const [id, subtotal] of Object.entries(subtotals)) {
        if (subtotal.numerator === 0n) continue
        const proportionalShare = exactFromFraction(
          BigInt(filler) * subtotal.numerator,
          subtotal.denominator * BigInt(distributedItemsSum),
        )
        if (proportionalShare.numerator === 0n) continue
        exact[id] = addExactAmount(exact[id], proportionalShare)
      }
    } else {
      const fillerPaidFor = itemizedRemainder?.paidFor.length
        ? itemizedRemainder.paidFor
        : groupMemberIds.map((participant) => ({ participant, shares: 1 }))
      const fillerSplitMode = itemizedRemainder?.splitMode ?? 'EVENLY'
      accumulate(filler, fillerSplitMode, fillerPaidFor)
    }
  }

  return exact
}

/**
 * Pure: given items + group members + expense amount, derive paidFor rows.
 *
 * Accumulates exact rational shares across all items (and optional filler),
 * then truncates once via distributeRemainder so cross-item drift is zero.
 *
 * If the item total does not cover the expense total in its sign direction, a
 * signed synthetic "Other (unaccounted)" filler is distributed using
 * itemizedRemainder (or EVENLY across members). If item subtotals overshoot the
 * expense in that direction, throws Error('ITEMS_EXCEED_AMOUNT').
 */
export function computePaidForFromItems(
  items: ExpenseApiItem[],
  groupMemberIds: string[],
  expenseAmount: number,
  itemizedRemainder?: {
    paidFor: ExpenseApiItem['paidFor']
    splitMode: ExpenseApiItem['splitMode']
    allocationMode?: RemainderAllocationMode
  },
  /** Expense id for remainder tie-break; omit / empty → seed 0 (create preview). */
  expenseId?: string | null,
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

  const seed = expenseIdSeed(expenseId)
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
 *
 * - EVENLY / BY_SHARES → shares: 1 (EVENLY inclusion marker; BY_SHARES is the
 *   display-unit value 1, serialized to fixed units by the form boundary before
 *   it reaches the API)
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
