import { describe, expect, it } from 'vitest'

import type { Currency, ExpenseFormItemValues } from '@spliit/domain'

import {
  applySplitToAll,
  getCommonItemSplit,
  scaleRowsToAmount,
} from './default-item-split'
import type { ParticipantRow } from './split-mode-conversions'

const USD: Pick<Currency, 'decimal_digits'> = { decimal_digits: 2 }
const JPY: Pick<Currency, 'decimal_digits'> = { decimal_digits: 0 }

function row(participant: string, shares: number): ParticipantRow {
  return { participant, shares }
}

function item(
  overrides: Partial<ExpenseFormItemValues> & {
    unitPrice?: number
    quantity?: number
    splitMode?: ExpenseFormItemValues['splitMode']
    paidFor?: ExpenseFormItemValues['paidFor']
  },
): ExpenseFormItemValues {
  return {
    id: overrides.id ?? `i-${Math.random().toString(36).slice(2)}`,
    title: overrides.title ?? 'item',
    unitPrice: overrides.unitPrice ?? 0,
    quantity: overrides.quantity ?? 1,
    splitMode: overrides.splitMode ?? 'EVENLY',
    paidFor: overrides.paidFor ?? [],
  }
}

// ── getCommonItemSplit ──────────────────────────────────────────────────

describe('getCommonItemSplit', () => {
  it('returns null for an empty list', () => {
    expect(getCommonItemSplit([])).toBeNull()
  })

  it('returns the shared split when all items match', () => {
    const items = [
      item({
        splitMode: 'BY_PERCENTAGE',
        paidFor: [row('a', 50), row('b', 50)],
      }),
      item({
        splitMode: 'BY_PERCENTAGE',
        paidFor: [row('b', 50), row('a', 50)],
      }),
    ]
    const common = getCommonItemSplit(items)
    expect(common?.splitMode).toBe('BY_PERCENTAGE')
    expect(common?.paidFor).toEqual([row('a', 50), row('b', 50)])
  })

  it('compares paidFor order-insensitively (modal reorders rows)', () => {
    const items = [
      item({ splitMode: 'EVENLY', paidFor: [row('a', 1), row('b', 1)] }),
      item({ splitMode: 'EVENLY', paidFor: [row('b', 1), row('a', 1)] }),
    ]
    expect(getCommonItemSplit(items)?.splitMode).toBe('EVENLY')
  })

  it('returns null when split modes differ', () => {
    const items = [
      item({ splitMode: 'EVENLY', paidFor: [row('a', 1)] }),
      item({ splitMode: 'BY_SHARES', paidFor: [row('a', 1)] }),
    ]
    expect(getCommonItemSplit(items)).toBeNull()
  })

  it('returns null when paidFor contents differ', () => {
    const items = [
      item({
        splitMode: 'BY_PERCENTAGE',
        paidFor: [row('a', 50), row('b', 50)],
      }),
      item({
        splitMode: 'BY_PERCENTAGE',
        paidFor: [row('a', 60), row('b', 40)],
      }),
    ]
    expect(getCommonItemSplit(items)).toBeNull()
  })

  it('returns null when participant sets differ', () => {
    const items = [
      item({ splitMode: 'EVENLY', paidFor: [row('a', 1), row('b', 1)] }),
      item({ splitMode: 'EVENLY', paidFor: [row('a', 1)] }),
    ]
    expect(getCommonItemSplit(items)).toBeNull()
  })

  it('returns a clone (mutating the result does not affect inputs)', () => {
    const items = [item({ splitMode: 'EVENLY', paidFor: [row('a', 1)] })]
    const common = getCommonItemSplit(items)!
    common.paidFor[0]!.shares = 999
    expect(items[0]!.paidFor[0]!.shares).toBe(1)
  })
})

// ── scaleRowsToAmount ───────────────────────────────────────────────────

describe('scaleRowsToAmount', () => {
  it('passes through non-BY_AMOUNT modes verbatim', () => {
    const rows = [row('a', 50), row('b', 50)]
    expect(scaleRowsToAmount(rows, 'BY_PERCENTAGE', 200, USD)).toEqual(rows)
    expect(scaleRowsToAmount(rows, 'EVENLY', 200, USD)).toEqual(rows)
    expect(scaleRowsToAmount(rows, 'BY_SHARES', 200, USD)).toEqual(rows)
  })

  it('scales BY_AMOUNT shares proportionally (USD, 2 decimals)', () => {
    const rows = [row('a', 10), row('b', 20), row('c', 30)]
    const result = scaleRowsToAmount(rows, 'BY_AMOUNT', 120, USD)
    // 120 * 10/60 = 20, 120 * 20/60 = 40, 120 * 30/60 = 60
    expect(result.map((r) => r.shares)).toEqual([20, 40, 60])
  })

  it('uses remainder-to-last for BY_AMOUNT rounding drift', () => {
    // 3-way of 10: 3.33 each, sum 9.99, leftover 0.01 → last gets 3.34
    const rows = [row('a', 1), row('b', 1), row('c', 1)]
    const result = scaleRowsToAmount(rows, 'BY_AMOUNT', 10, USD)
    expect(result.map((r) => r.shares)).toEqual([3.33, 3.33, 3.34])
    const sum = result.reduce((s, r) => s + r.shares, 0)
    expect(sum).toBe(10)
  })

  it('honors currency decimal_digits = 0 (JPY)', () => {
    const rows = [row('a', 1), row('b', 1), row('c', 1)]
    const result = scaleRowsToAmount(rows, 'BY_AMOUNT', 100, JPY)
    // 100/3 = 33.33..., with no decimals: 33 each, sum 99, leftover 1 → top gets 34
    expect(result.map((r) => r.shares)).toEqual([33, 33, 34])
  })

  it('drops zero-share rows after rounding', () => {
    // Target 1 JPY across 5 participants — most round to 0
    const rows = [
      row('a', 1),
      row('b', 1),
      row('c', 1),
      row('d', 1),
      row('e', 1),
    ]
    const result = scaleRowsToAmount(rows, 'BY_AMOUNT', 1, JPY)
    expect(result.every((r) => r.shares !== 0)).toBe(true)
    // Guarantee at least one row remains even if the target is unallocatable
    expect(result.length).toBeGreaterThan(0)
  })

  it('returns a single minimum-unit row when the target is 0', () => {
    const rows = [row('a', 10), row('b', 20)]
    const result = scaleRowsToAmount(rows, 'BY_AMOUNT', 0, USD)
    expect(result).toEqual([{ participant: 'a', shares: 0.01 }])
  })

  it('returns a single minimum-unit row when the source sum is 0', () => {
    const rows = [row('a', 0), row('b', 0)]
    const result = scaleRowsToAmount(rows, 'BY_AMOUNT', 100, USD)
    expect(result).toEqual([{ participant: 'a', shares: 0.01 }])
  })

  it('preserves sign for negative targets', () => {
    const rows = [row('a', 1), row('b', 1)]
    const result = scaleRowsToAmount(rows, 'BY_AMOUNT', -10, USD)
    expect(result.map((r) => r.shares)).toEqual([-5, -5])
  })

  it('returns empty array for empty input', () => {
    expect(scaleRowsToAmount([], 'BY_AMOUNT', 100, USD)).toEqual([])
  })
})

// ── applySplitToAll ────────────────────────────────────────────────────

describe('applySplitToAll', () => {
  const items: ExpenseFormItemValues[] = [
    item({
      id: 'i1',
      unitPrice: 10,
      quantity: 2,
      splitMode: 'EVENLY',
      paidFor: [],
    }),
    item({
      id: 'i2',
      unitPrice: 30,
      quantity: 1,
      splitMode: 'EVENLY',
      paidFor: [],
    }),
  ]

  it('applies percentage mode verbatim to every item', () => {
    const split = {
      splitMode: 'BY_PERCENTAGE' as const,
      paidFor: [row('a', 70), row('b', 30)],
    }
    const result = applySplitToAll({
      items,
      split,
      expenseAmount: 60,
      groupCurrency: USD,
    })
    expect(result.items.every((i) => i.splitMode === 'BY_PERCENTAGE')).toBe(
      true,
    )
    expect(result.items[0]!.paidFor).toEqual([row('a', 70), row('b', 30)])
    expect(result.items[1]!.paidFor).toEqual([row('a', 70), row('b', 30)])
  })

  it('scales BY_AMOUNT shares per item total', () => {
    const split = {
      splitMode: 'BY_AMOUNT' as const,
      paidFor: [row('a', 10), row('b', 20)],
    }
    const result = applySplitToAll({
      items,
      split,
      expenseAmount: 60,
      groupCurrency: USD,
    })
    // Item 1 total = 20: 20 * 10/30 = 6.66, 20 * 20/30 = 13.33 + 0.01 leftover → 13.34
    expect(result.items[0]!.paidFor.map((r) => r.shares)).toEqual([6.66, 13.34])
    // Item 2 total = 30: 30 * 10/30 = 10, 30 * 20/30 = 20 (exact, no drift)
    expect(result.items[1]!.paidFor.map((r) => r.shares)).toEqual([10, 20])
  })

  it('seeds the remainder filler with the unaccounted amount', () => {
    // Items total = 50, expense = 60 → remainder = 10
    const split = {
      splitMode: 'BY_AMOUNT' as const,
      paidFor: [row('a', 1), row('b', 1)],
    }
    const result = applySplitToAll({
      items,
      split,
      expenseAmount: 60,
      groupCurrency: USD,
    })
    expect(result.itemizedRemainder.splitMode).toBe('BY_AMOUNT')
    expect(
      result.itemizedRemainder.paidFor.reduce((s, r) => s + r.shares, 0),
    ).toBe(10)
  })

  it('keeps the remainder split in PERCENTAGE mode regardless of amount', () => {
    // Items total = 50, expense = 30 → the signed remainder config remains
    // percentage-based; the per-item preview handles the uncovered amount.
    const split = {
      splitMode: 'BY_PERCENTAGE' as const,
      paidFor: [row('a', 50), row('b', 50)],
    }
    const result = applySplitToAll({
      items,
      split,
      expenseAmount: 30,
      groupCurrency: USD,
    })
    expect(result.itemizedRemainder.splitMode).toBe('BY_PERCENTAGE')
    expect(result.itemizedRemainder.paidFor).toEqual([
      row('a', 50),
      row('b', 50),
    ])
  })

  it('seeds a signed BY_AMOUNT remainder when items overshoot a positive expense', () => {
    const split = {
      splitMode: 'BY_AMOUNT' as const,
      paidFor: [row('a', 1), row('b', 1)],
    }
    const result = applySplitToAll({
      items,
      split,
      expenseAmount: 30,
      groupCurrency: USD,
    })

    expect(result.itemizedRemainder.paidFor.map((r) => r.shares)).toEqual([
      -10, -10,
    ])
  })

  it('preserves unrelated item fields (title, id, unitPrice, quantity)', () => {
    const split = {
      splitMode: 'EVENLY' as const,
      paidFor: [row('a', 1), row('b', 1)],
    }
    const result = applySplitToAll({
      items,
      split,
      expenseAmount: 50,
      groupCurrency: USD,
    })
    expect(result.items.map((i) => i.id)).toEqual(['i1', 'i2'])
    expect(result.items[0]!.unitPrice).toBe(10)
    expect(result.items[0]!.quantity).toBe(2)
  })
})
