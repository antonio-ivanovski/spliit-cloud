import type { ConversionSource, ExpenseConversionInput } from '@spliit/domain'

import type { ExpenseDiffer } from './types'

const sourceLabels = {
  same: 'None (same currency)',
  EXCHANGE: 'Exchange rate',
  CUSTOM: 'Custom rate',
} as const

type ExpenseWithConversionMeta = {
  conversionSource?: ConversionSource | null
  conversionRate?: number | null
  conversion?: ExpenseConversionInput
}

function sourceOf(
  expense: ExpenseWithConversionMeta,
): ConversionSource | 'same' {
  if (
    expense.conversionSource === 'EXCHANGE' ||
    expense.conversionSource === 'CUSTOM'
  ) {
    return expense.conversionSource
  }
  if (expense.conversion?.type === 'exchange') return 'EXCHANGE'
  if (expense.conversion?.type === 'custom') return 'CUSTOM'
  return 'same'
}

function formatSource(source: ConversionSource | 'same'): string {
  return sourceLabels[source]
}

function formatRate(rate: number | null | undefined): string {
  if (rate == null || !Number.isFinite(rate)) return '—'
  return Number(rate.toPrecision(8)).toString()
}

/** Detects and formats changes to conversion source. */
export const conversionSourceDiffer: ExpenseDiffer = {
  field: 'conversionSource',

  check(oldExpense, newExpense) {
    return (
      sourceOf(oldExpense as ExpenseWithConversionMeta) !==
      sourceOf(newExpense as ExpenseWithConversionMeta)
    )
  },

  diff(oldExpense, newExpense) {
    if (!this.check(oldExpense, newExpense)) return null
    return {
      field: 'conversionSource',
      before: formatSource(sourceOf(oldExpense as ExpenseWithConversionMeta)),
      after: formatSource(sourceOf(newExpense as ExpenseWithConversionMeta)),
    }
  },
}

/**
 * Detects and formats changes to the conversion rate. Rate-only edits show up
 * even when the source stays the same.
 */
export const conversionRateDiffer: ExpenseDiffer = {
  field: 'conversionRate',

  check(oldExpense, newExpense) {
    const oldRate =
      (oldExpense as ExpenseWithConversionMeta).conversionRate ?? null
    const newRate =
      (newExpense as ExpenseWithConversionMeta).conversionRate ?? null
    if (oldRate == null && newRate == null) return false
    if (oldRate == null || newRate == null) return true
    return Math.abs(oldRate - newRate) > 1e-12
  },

  diff(oldExpense, newExpense) {
    if (!this.check(oldExpense, newExpense)) return null
    return {
      field: 'conversionRate',
      before: formatRate(
        (oldExpense as ExpenseWithConversionMeta).conversionRate,
      ),
      after: formatRate(
        (newExpense as ExpenseWithConversionMeta).conversionRate,
      ),
    }
  },
}
