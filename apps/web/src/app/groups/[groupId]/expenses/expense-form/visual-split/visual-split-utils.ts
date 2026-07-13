import { amountAsMinorUnits, formatCurrency } from '@/lib/utils'
import type { Currency, SplitMode } from '@spliit/domain'
import { createAllocation, type AllocationState } from '../allocation-engine'
import type { VisualSplitRow } from './types'

export type AllocationUpdateOptions = {
  shouldDirty: boolean
  shouldTouch: boolean
  shouldValidate: boolean
}

export const updateOptions: AllocationUpdateOptions = {
  shouldDirty: true,
  shouldTouch: true,
  shouldValidate: true,
} as const

export const previewOptions: AllocationUpdateOptions = {
  shouldDirty: false,
  shouldTouch: false,
  shouldValidate: false,
} as const

export function amountFromMinorUnits(value: number, currency: Currency) {
  return value / 10 ** currency.decimal_digits
}

export function unitValue(mode: SplitMode, value: number, currency: Currency) {
  if (mode === 'BY_PERCENTAGE') return Math.round(value * 100)
  if (mode === 'BY_AMOUNT') return amountAsMinorUnits(Math.abs(value), currency)
  return Math.max(1, Math.round(value || 1))
}

export function formValue(mode: SplitMode, value: number, currency: Currency) {
  if (mode === 'BY_PERCENTAGE') return value / 100
  if (mode === 'BY_AMOUNT') return amountFromMinorUnits(value, currency)
  return value
}

export function buildAllocation(
  mode: SplitMode,
  rows: VisualSplitRow[],
  target: number,
  currency: Currency,
) {
  const allocationTarget =
    mode === 'BY_PERCENTAGE'
      ? 10_000
      : mode === 'BY_AMOUNT'
        ? amountAsMinorUnits(Math.abs(target), currency)
        : rows.reduce(
            (sum, row) => sum + Math.max(1, Math.round(row.shares)),
            0,
          )

  if (allocationTarget < rows.length || rows.length === 0) return null
  const result = createAllocation(
    allocationTarget,
    rows.map((row) => ({
      id: row.participant,
      value: unitValue(mode, row.shares, currency),
    })),
  )
  return result.ok ? result.state : null
}

export function allocationRows(
  mode: SplitMode,
  state: AllocationState,
  currency: Currency,
  amountSign: 1 | -1,
): VisualSplitRow[] {
  return state.entries.map((entry) => ({
    participant: entry.id,
    shares:
      formValue(mode, entry.value, currency) *
      (mode === 'BY_AMOUNT' ? amountSign : 1),
  }))
}

export function rowsSignature(rows: VisualSplitRow[]) {
  return rows.map((row) => `${row.participant}:${Number(row.shares)}`).join('|')
}

export function formatUnit(
  mode: SplitMode,
  value: number,
  currency: Currency,
  locale: string,
  sharesLabel: string,
) {
  if (mode === 'BY_PERCENTAGE') {
    return `${(value / 100).toFixed(value % 100 === 0 ? 0 : 2)}%`
  }
  if (mode === 'BY_AMOUNT') return formatCurrency(currency, value, locale)
  return `${value} ${sharesLabel}`
}
