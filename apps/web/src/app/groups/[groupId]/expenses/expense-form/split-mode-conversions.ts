import { type SplitMode } from '@spliit/domain'

export type ParticipantRow = {
  participant: string
  shares: number
}

export type CurrencyLike = {
  decimal_digits: number
}

export function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}

export function gcd(a: number, b: number): number {
  a = Math.abs(Math.trunc(a))
  b = Math.abs(Math.trunc(b))
  if (a === 0 || b === 0) return 1
  while (b !== 0) {
    ;[a, b] = [b, a % b]
  }
  return a
}

function isSelected(row: ParticipantRow): boolean {
  return row.shares !== 0
}

function _countSelected(rows: ParticipantRow[]): number {
  return rows.filter(isSelected).length
}

/**
 * Produce a numeric share value appropriate for the target split mode.
 * BY_PERCENTAGE: 2-decimal precision (e.g. 33.33)
 * BY_AMOUNT: precision aligned to the currency's decimal_digits
 * BY_SHARES: integer (rounded)
 * EVENLY: 0 (irrelevant — the consumer distributes evenly regardless)
 */
function formatShare(
  value: number,
  mode: SplitMode,
  precision: number,
): number {
  switch (mode) {
    case 'BY_AMOUNT':
      return Number(value.toFixed(precision))
    case 'BY_PERCENTAGE':
      return Number(value.toFixed(2))
    case 'BY_SHARES':
      return Math.round(value)
    case 'EVENLY':
      return 0
    case 'ITEMIZED':
      return 0
  }
}

function _isAmountMode(mode: SplitMode): boolean {
  return mode === 'BY_AMOUNT'
}

export function convertParticipantShares(args: {
  rows: ParticipantRow[]
  fromMode: SplitMode
  toMode: SplitMode
  targetAmount: number
  currency?: CurrencyLike
}): ParticipantRow[] {
  const { rows, fromMode, toMode, targetAmount } = args
  const precision = args.currency?.decimal_digits ?? 2

  // Same mode: shallow clone
  if (fromMode === toMode) {
    return rows.map((r) => ({ ...r }))
  }

  const selected = rows.filter(isSelected)
  const selectedCount = selected.length

  // No rows selected: return zeros
  if (selectedCount === 0) {
    return rows.map((r) => ({
      participant: r.participant,
      shares: 0,
    }))
  }

  /**
   * Build the output rows from computed numeric values for selected rows.
   * Unselected rows get 0.
   */
  function buildOutput(
    selectedValues: number[],
    mode: SplitMode,
  ): ParticipantRow[] {
    let selIdx = 0
    return rows.map((r) => {
      if (!isSelected(r)) {
        return { participant: r.participant, shares: 0 }
      }
      const sv = selectedValues[selIdx++]
      const shareNum = formatShare(sv, mode, precision)
      return {
        participant: r.participant,
        shares: shareNum,
      }
    })
  }

  // ── EVENLY → * ────────────────────────────────────────────

  if (fromMode === 'EVENLY' && toMode === 'BY_SHARES') {
    return buildOutput(new Array(selectedCount).fill(1), 'BY_SHARES')
  }

  if (fromMode === 'EVENLY' && toMode === 'BY_PERCENTAGE') {
    const raw = 100 / selectedCount
    const values = new Array(selectedCount)
      .fill(null)
      .map(() => roundTo(raw, 2))
    const sum = values.reduce((a, b) => a + b, 0)
    const diff = roundTo(100 - sum, 2)
    if (diff !== 0)
      values[values.length - 1] = roundTo(values[values.length - 1] + diff, 2)
    return buildOutput(values, 'BY_PERCENTAGE')
  }

  if (fromMode === 'EVENLY' && toMode === 'BY_AMOUNT') {
    const raw = targetAmount / selectedCount
    const values = new Array(selectedCount)
      .fill(null)
      .map(() => roundTo(raw, precision))
    const sum = values.reduce((a, b) => a + b, 0)
    const diff = roundTo(targetAmount - sum, precision)
    if (diff !== 0)
      values[values.length - 1] = roundTo(
        values[values.length - 1] + diff,
        precision,
      )
    return buildOutput(values, 'BY_AMOUNT')
  }

  // ── BY_SHARES → * ─────────────────────────────────────────

  if (fromMode === 'BY_SHARES' && toMode === 'BY_PERCENTAGE') {
    const total = selected.reduce((s, r) => s + r.shares, 0)
    if (total === 0) return rows.map((r) => ({ ...r }))
    const values = selected.map((r) => roundTo((r.shares / total) * 100, 2))
    const sum = values.reduce((a, b) => a + b, 0)
    const diff = roundTo(100 - sum, 2)
    if (diff !== 0)
      values[values.length - 1] = roundTo(values[values.length - 1] + diff, 2)
    return buildOutput(values, 'BY_PERCENTAGE')
  }

  if (fromMode === 'BY_SHARES' && toMode === 'BY_AMOUNT') {
    const total = selected.reduce((s, r) => s + r.shares, 0)
    if (total === 0) return rows.map((r) => ({ ...r }))
    const values = selected.map((r) =>
      roundTo((targetAmount * r.shares) / total, precision),
    )
    const sum = values.reduce((a, b) => a + b, 0)
    const diff = roundTo(targetAmount - sum, precision)
    if (diff !== 0)
      values[values.length - 1] = roundTo(
        values[values.length - 1] + diff,
        precision,
      )
    return buildOutput(values, 'BY_AMOUNT')
  }

  // ── BY_PERCENTAGE → * ─────────────────────────────────────

  if (fromMode === 'BY_PERCENTAGE' && toMode === 'BY_SHARES') {
    const weights = selected.map((r) => Math.round(r.shares * 100))
    const g = weights.reduce((acc, w) => gcd(acc, w))
    const reduced = weights.map((w) => Math.max(1, Math.round(w / g)))
    return buildOutput(reduced, 'BY_SHARES')
  }

  if (fromMode === 'BY_PERCENTAGE' && toMode === 'BY_AMOUNT') {
    const values = selected.map((r) =>
      roundTo((targetAmount * r.shares) / 100, precision),
    )
    const sum = values.reduce((a, b) => a + b, 0)
    const diff = roundTo(targetAmount - sum, precision)
    if (diff !== 0)
      values[values.length - 1] = roundTo(
        values[values.length - 1] + diff,
        precision,
      )
    return buildOutput(values, 'BY_AMOUNT')
  }

  // ── BY_AMOUNT → * ─────────────────────────────────────────

  if (fromMode === 'BY_AMOUNT' && toMode === 'BY_PERCENTAGE') {
    const total = selected.reduce((s, r) => s + r.shares, 0)
    if (total === 0) return rows.map((r) => ({ ...r }))
    const values = selected.map((r) => roundTo((r.shares / total) * 100, 2))
    const sum = values.reduce((a, b) => a + b, 0)
    const diff = roundTo(100 - sum, 2)
    if (diff !== 0)
      values[values.length - 1] = roundTo(values[values.length - 1] + diff, 2)
    return buildOutput(values, 'BY_PERCENTAGE')
  }

  if (fromMode === 'BY_AMOUNT' && toMode === 'BY_SHARES') {
    const weights = selected.map((r) => Math.round(r.shares * 10 ** precision))
    const g = weights.reduce((acc, w) => gcd(acc, w))
    const reduced = weights.map((w) => Math.max(1, Math.round(w / g)))
    return buildOutput(reduced, 'BY_SHARES')
  }

  // Fallback safety: shallow clone
  return rows.map((r) => ({ ...r }))
}
