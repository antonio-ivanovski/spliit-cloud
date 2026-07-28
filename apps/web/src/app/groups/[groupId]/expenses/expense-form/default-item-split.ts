import type { Currency, ExpenseFormItemValues } from '@spliit/domain'

import { roundTo, type ParticipantRow } from './split-mode-conversions'

type ItemSplitMode = ExpenseFormItemValues['splitMode']

/**
 * Derive the split that all items currently share, or `null` when items are
 * empty or disagree on either mode or paidFor. Compares paidFor as a
 * participant → shares map (order-independent, because the per-item modal
 * reorders rows on edit).
 */
export function getCommonItemSplit(
  items: ExpenseFormItemValues[],
): { splitMode: ItemSplitMode; paidFor: ParticipantRow[] } | null {
  if (items.length === 0) return null
  const first = items[0]!
  for (const item of items) {
    if (item.splitMode !== first.splitMode) return null
    if (!sameParticipantShares(item.paidFor, first.paidFor)) return null
  }
  return {
    splitMode: first.splitMode,
    paidFor: first.paidFor.map((r) => ({ ...r })),
  }
}

function sameParticipantShares(
  a: ExpenseFormItemValues['paidFor'],
  b: ExpenseFormItemValues['paidFor'],
): boolean {
  if (a.length !== b.length) return false
  const map = new Map<string, number>()
  for (const r of a) map.set(r.participant, r.shares)
  for (const r of b) {
    const value = map.get(r.participant)
    if (value === undefined || value !== r.shares) return false
  }
  return true
}

/**
 * Scale BY_AMOUNT shares proportionally to a new target total, rounding to the
 * currency's precision with remainder-to-last (mirroring the rounding
 * convention used elsewhere in the form). Other split modes are amount-
 * independent and returned verbatim. Zero-share rows are dropped, with a
 * minimum-unit fallback that guarantees at least one row when input is
 * non-empty.
 */
export function scaleRowsToAmount(
  rows: ParticipantRow[],
  mode: ItemSplitMode,
  targetAmount: number,
  currency: Pick<Currency, 'decimal_digits'>,
): ParticipantRow[] {
  if (rows.length === 0) return []
  if (mode !== 'BY_AMOUNT') return rows.map((r) => ({ ...r }))

  const precision = currency.decimal_digits
  const factor = 10 ** precision
  const sign = targetAmount < 0 ? -1 : 1
  const targetAbs = Math.abs(targetAmount)

  // No amount to distribute: drop to a single minimal share so a BY_AMOUNT
  // item with a zero total still has a non-empty paidFor (required by
  // itemized item validation).
  if (targetAbs === 0) {
    return [
      {
        participant: rows[0]!.participant,
        shares: sign * 10 ** -precision,
      },
    ]
  }

  const sourceAmount = rows.reduce((sum, r) => sum + Number(r.shares || 0), 0)
  // Source sum is also zero (e.g. all-zero shares): same fallback.
  if (sourceAmount === 0) {
    return [
      {
        participant: rows[0]!.participant,
        shares: sign * 10 ** -precision,
      },
    ]
  }

  const unitTotal = Math.round(targetAbs * factor)

  const scaled = rows.map((row) => {
    const weight = Math.abs(Number(row.shares || 0))
    const unitShare = Math.floor((weight / sourceAmount) * unitTotal)
    const value = roundTo(sign * (unitShare / factor), precision)
    return { participant: row.participant, shares: value, unitShare }
  })

  // Distribute leftover minor units to the LAST entries (input order) so
  // the scaled sum matches the target within precision. Matches the
  // rounding convention used in buildEqualParticipantRows and
  // convertParticipantShares.
  const unitRemainder = unitTotal - scaled.reduce((s, r) => s + r.unitShare, 0)
  if (unitRemainder !== 0 && scaled.length > 0) {
    const step = scaled.length - 1
    for (let i = 0; i < unitRemainder && step - i >= 0; i++) {
      const target = scaled[step - i]!
      target.shares = roundTo(target.shares + sign * (1 / factor), precision)
      target.unitShare += sign
    }
  }

  return scaled
    .map(({ participant, shares }) => ({ participant, shares }))
    .filter((r) => r.shares !== 0)
}

/**
 * Apply a chosen split to every item (scaled per item total) and to the
 * itemized remainder filler (scaled to the unaccounted amount).
 */
export function applySplitToAll({
  items,
  split,
  expenseAmount,
  groupCurrency,
}: {
  items: ExpenseFormItemValues[]
  split: { splitMode: ItemSplitMode; paidFor: ParticipantRow[] }
  expenseAmount: number
  groupCurrency: Pick<Currency, 'decimal_digits'>
}): {
  items: ExpenseFormItemValues[]
  itemizedRemainder: { splitMode: ItemSplitMode; paidFor: ParticipantRow[] }
} {
  const nextItems = items.map((item) => ({
    ...item,
    splitMode: split.splitMode,
    paidFor: scaleRowsToAmount(
      split.paidFor,
      split.splitMode,
      Number(item.unitPrice) * Number(item.quantity),
      groupCurrency,
    ),
  }))

  const itemsTotal = nextItems.reduce(
    (sum, item) => sum + Number(item.unitPrice) * Number(item.quantity),
    0,
  )
  const remainderAmount = Math.max(0, expenseAmount - itemsTotal)
  return {
    items: nextItems,
    itemizedRemainder: {
      splitMode: split.splitMode,
      paidFor: scaleRowsToAmount(
        split.paidFor,
        split.splitMode,
        remainderAmount,
        groupCurrency,
      ),
    },
  }
}
