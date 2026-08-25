import {
  amountAsDecimal,
  sharesAsDecimal,
  type Currency,
  type SplitMode,
} from '@spliit/domain'

/**
 * Display-unit row shape used by the form. Shares carry the same units as the
 * live form state — decimal major units for BY_AMOUNT, display percentages for
 * BY_PERCENTAGE, display shares for BY_SHARES (1 = 1 share), inclusion markers
 * for EVENLY.
 */
export type SplitRowDisplay = {
  participant: string
  shares: number
}

/**
 * Legacy storage-unit row shape used by compatibility tests for old account
 * exports. Shared presets use the group-owned split-preset API instead. Shares
 * are integer minor units (BY_AMOUNT), basis points (BY_PERCENTAGE), or fixed
 * share units (BY_SHARES, 100 = 1 displayed share). EVENLY rows are inclusion
 * markers.
 */
export type SplitRowStored = {
  participant: string
  shares: number
}

export type SavedSplit = {
  // The API contract is `Exclude<SplitMode, 'ITEMIZED'>` but the type
  // is widened to the full union so the AppRouterOutput type (which
  // declares `splitMode: SplitMode` from the enum definition) flows
  // through unchanged. ITEMIZED is treated as "always differs" by
  // `splitEqual`, so consumers behave correctly even if it slips
  // through.
  splitMode: SplitMode
  paidFor: SplitRowStored[]
}

/**
 * Tolerance for comparing numeric shares across the two shapes. The form keeps
 * display percentages to 2 decimals and BY_AMOUNT shares to the currency's
 * decimal_digits, so 0.005 is comfortably wider than the smallest round trip in
 * either unit space.
 */
const NUMERIC_TOLERANCE = 0.005

/**
 * Convert a stored `paidFor` row into display units so it can be compared to
 * live form state.
 */
function storedRowToDisplay(
  row: SplitRowStored,
  splitMode: SplitMode,
  groupCurrency: Currency,
): SplitRowDisplay {
  if (splitMode === 'BY_PERCENTAGE') {
    return { participant: row.participant, shares: row.shares / 100 }
  }
  if (splitMode === 'BY_AMOUNT') {
    return {
      participant: row.participant,
      shares: amountAsDecimal(row.shares, groupCurrency),
    }
  }
  if (splitMode === 'BY_SHARES') {
    return {
      participant: row.participant,
      shares: sharesAsDecimal(row.shares),
    }
  }
  return { participant: row.participant, shares: row.shares }
}

/**
 * Order-independent equality for an EVENLY split: the same set of participants
 * is included in both. The actual share values are ignored because EVENLY does
 * not encode them in user-meaningful numbers — what matters is "who is in".
 */
function evenlyRowsEqual(
  currentRows: SplitRowDisplay[],
  savedRows: SplitRowDisplay[],
): boolean {
  const current = new Set(
    currentRows.flatMap((r) => (r.shares > 0 ? [r.participant] : [])),
  )
  const saved = new Set(
    savedRows.flatMap((r) => (r.shares > 0 ? [r.participant] : [])),
  )
  if (current.size !== saved.size) return false
  for (const id of current) if (!saved.has(id)) return false
  return true
}

/**
 * Order-independent equality for numeric splits (BY_SHARES / BY_PERCENTAGE /
 * BY_AMOUNT). Each participant's share must match within `NUMERIC_TOLERANCE`,
 * and the union of participants must be the same — so a row in one side with
 * `shares = 0` is treated as "not included" and a missing row on the other side
 * is "not included" as well.
 */
function numericRowsEqual(
  currentRows: SplitRowDisplay[],
  savedRows: SplitRowDisplay[],
): boolean {
  const currentByParticipant = new Map(
    currentRows.map((r) => [r.participant, r.shares]),
  )
  const savedByParticipant = new Map(
    savedRows.map((r) => [r.participant, r.shares]),
  )

  // Compare every participant that appears on either side.
  const all = new Set([
    ...currentByParticipant.keys(),
    ...savedByParticipant.keys(),
  ])
  for (const id of all) {
    const currentValue = currentByParticipant.get(id) ?? 0
    const savedValue = savedByParticipant.get(id) ?? 0
    if (Math.abs(currentValue - savedValue) > NUMERIC_TOLERANCE) {
      return false
    }
  }
  return true
}

/**
 * Returns `true` when the current form split matches `saved`.
 *
 * `null` `saved` always returns `false` (any non-ITEMIZED form state diverges
 * from "no default"). ITEMIZED is excluded at the type level — saving an
 * itemized default is not allowed by the API.
 */
export function splitEqual(
  currentMode: SplitMode,
  currentRows: SplitRowDisplay[],
  saved: SavedSplit | null,
  groupCurrency: Currency,
): boolean {
  if (saved === null) return false
  if (currentMode === 'ITEMIZED') return false

  if (currentMode !== saved.splitMode) return false

  const savedRowsDisplay = saved.paidFor.map((row) =>
    storedRowToDisplay(row, saved.splitMode, groupCurrency),
  )

  if (currentMode === 'EVENLY') {
    return evenlyRowsEqual(currentRows, savedRowsDisplay)
  }
  return numericRowsEqual(currentRows, savedRowsDisplay)
}
