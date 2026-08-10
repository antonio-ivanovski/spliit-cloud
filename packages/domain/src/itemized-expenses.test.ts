import { describe, expect, it } from 'vitest'

import {
  buildDefaultPaidForForSplitMode,
  computeExactSharesFromItems,
  computePaidForFromItems,
  itemsExceedExpenseAmount,
} from './itemized-expenses'
import type { ExpenseApiItem } from './schemas'

const makeItem = (overrides: Partial<ExpenseApiItem> = {}): ExpenseApiItem => ({
  title: 'Item',
  unitPrice: 100,
  quantity: 1,
  amount: 100,
  paidFor: [],
  splitMode: 'EVENLY',
  ...overrides,
})

describe('computePaidForFromItems', () => {
  it('allocates a negative item and preserves the negative expense total', () => {
    const items = [
      makeItem({
        unitPrice: -800,
        amount: -800,
        paidFor: [
          { participant: 'p1', shares: 1 },
          { participant: 'p2', shares: 1 },
        ],
        splitMode: 'EVENLY',
      }),
    ]

    const result = computePaidForFromItems(items, ['p1', 'p2'], -800)

    expect(result.paidFor).toEqual([
      { participant: 'p1', shares: -400 },
      { participant: 'p2', shares: -400 },
    ])
  })

  it('uses a signed filler for an incomplete negative expense', () => {
    const items = [
      makeItem({
        unitPrice: -800,
        amount: -800,
        paidFor: [{ participant: 'p1', shares: 1 }],
        splitMode: 'EVENLY',
      }),
    ]

    const result = computePaidForFromItems(items, ['p1', 'p2'], -1000)
    const byId = Object.fromEntries(
      result.paidFor.map((row) => [row.participant, row.shares]),
    )

    expect(byId).toEqual({ p1: -900, p2: -100 })
    expect(Object.values(byId).reduce((sum, value) => sum + value, 0)).toBe(
      -1000,
    )
  })

  it('rejects negative items that overshoot a negative expense', () => {
    const items = [makeItem({ unitPrice: -1200, amount: -1200 })]

    expect(() => computePaidForFromItems(items, ['p1'], -1000)).toThrow(
      'ITEMS_EXCEED_AMOUNT',
    )
  })

  it('mirrors the item overshoot rule for negative totals', () => {
    expect(itemsExceedExpenseAmount(-1200, -1000)).toBe(true)
    expect(itemsExceedExpenseAmount(-800, -1000)).toBe(false)
    expect(itemsExceedExpenseAmount(1200, 1000)).toBe(true)
    expect(itemsExceedExpenseAmount(800, 1000)).toBe(false)
  })

  it('single item, single participant, EVENLY', () => {
    const items = [
      makeItem({
        amount: 1000,
        paidFor: [{ participant: 'p1', shares: 1 }],
        splitMode: 'EVENLY',
      }),
    ]
    const result = computePaidForFromItems(items, ['p1'], 1000)
    expect(result.paidFor).toEqual([{ participant: 'p1', shares: 1000 }])
    expect(result.effectiveAmount).toBe(1000)
  })

  it('single item, multiple participants, EVENLY with remainder distribution', () => {
    const items = [
      makeItem({
        amount: 100,
        paidFor: [
          { participant: 'p1', shares: 1 },
          { participant: 'p2', shares: 1 },
          { participant: 'p3', shares: 1 },
        ],
        splitMode: 'EVENLY',
      }),
    ]
    const result = computePaidForFromItems(items, ['p1', 'p2', 'p3'], 100)
    // 100/3 → seed 0: p1 gets extra cent
    const byId = Object.fromEntries(
      result.paidFor.map((p) => [p.participant, p.shares]),
    )
    expect(byId.p1 + byId.p2 + byId.p3).toBe(100)
    expect([byId.p1, byId.p2, byId.p3].sort((a, b) => a - b)).toEqual([
      33, 33, 34,
    ])
    expect(result.effectiveAmount).toBe(100)
  })

  it('single item, multiple participants, BY_SHARES weighted distribution', () => {
    const items = [
      makeItem({
        amount: 200,
        paidFor: [
          { participant: 'p1', shares: 1 },
          { participant: 'p2', shares: 3 },
        ],
        splitMode: 'BY_SHARES',
      }),
    ]
    const result = computePaidForFromItems(items, ['p1', 'p2'], 200)
    // Weighted: p1 = 200*1/4 = 50, p2 = 200*3/4 = 150
    expect(
      result.paidFor.sort((a, b) => a.participant.localeCompare(b.participant)),
    ).toEqual([
      { participant: 'p1', shares: 50 },
      { participant: 'p2', shares: 150 },
    ])
    expect(result.effectiveAmount).toBe(200)
  })

  it('single item, multiple participants, BY_PERCENTAGE basis-point distribution', () => {
    const items = [
      makeItem({
        amount: 1000,
        paidFor: [
          { participant: 'p1', shares: 2500 },
          { participant: 'p2', shares: 7500 },
        ],
        splitMode: 'BY_PERCENTAGE',
      }),
    ]
    const result = computePaidForFromItems(items, ['p1', 'p2'], 1000)
    // p1 = 1000*2500/10000 = 250, p2 = 1000*7500/10000 = 750
    expect(
      result.paidFor.sort((a, b) => a.participant.localeCompare(b.participant)),
    ).toEqual([
      { participant: 'p1', shares: 250 },
      { participant: 'p2', shares: 750 },
    ])
    expect(result.effectiveAmount).toBe(1000)
  })

  it('single item, BY_AMOUNT exact amounts', () => {
    const items = [
      makeItem({
        amount: 1000,
        paidFor: [
          { participant: 'p1', shares: 300 },
          { participant: 'p2', shares: 700 },
        ],
        splitMode: 'BY_AMOUNT',
      }),
    ]
    const result = computePaidForFromItems(items, ['p1', 'p2'], 1000)
    expect(
      result.paidFor.sort((a, b) => a.participant.localeCompare(b.participant)),
    ).toEqual([
      { participant: 'p1', shares: 300 },
      { participant: 'p2', shares: 700 },
    ])
    expect(result.effectiveAmount).toBe(1000)
  })

  it('items sum < amount: filler appears and is split evenly across all members', () => {
    const items = [
      makeItem({
        amount: 600,
        paidFor: [{ participant: 'p1', shares: 1 }],
        splitMode: 'EVENLY',
      }),
    ]
    const result = computePaidForFromItems(items, ['p1', 'p2', 'p3'], 1000)
    // Global: p1=733.33…, p2=p3=133.33… → seed 0: 734/133/133
    expect(result.paidFor).toHaveLength(3)
    expect(
      result.paidFor
        .map((p) => p.participant)
        .sort((a, b) => a.localeCompare(b)),
    ).toEqual(['p1', 'p2', 'p3'])
    const sum = result.paidFor.reduce((s, p) => s + p.shares, 0)
    expect(sum).toBe(1000)
    expect(result.effectiveAmount).toBe(1000)
    const byId = Object.fromEntries(
      result.paidFor.map((p) => [p.participant, p.shares]),
    )
    expect(byId).toEqual({ p1: 734, p2: 133, p3: 133 })
  })

  it('items sum < amount: filler can use a custom participant split', () => {
    const items = [
      makeItem({
        amount: 600,
        paidFor: [{ participant: 'p1', shares: 1 }],
        splitMode: 'EVENLY',
      }),
    ]
    const result = computePaidForFromItems(items, ['p1', 'p2', 'p3'], 1000, {
      splitMode: 'BY_SHARES',
      paidFor: [
        { participant: 'p2', shares: 3 },
        { participant: 'p3', shares: 1 },
      ],
    })

    expect(
      result.paidFor.sort((a, b) => a.participant.localeCompare(b.participant)),
    ).toEqual([
      { participant: 'p1', shares: 600 },
      { participant: 'p2', shares: 300 },
      { participant: 'p3', shares: 100 },
    ])
    expect(result.effectiveAmount).toBe(1000)
  })

  it('items sum > amount: throws ITEMS_EXCEED_AMOUNT', () => {
    const items = [
      makeItem({
        amount: 1500,
        paidFor: [{ participant: 'p1', shares: 1 }],
        splitMode: 'EVENLY',
      }),
    ]
    expect(() => computePaidForFromItems(items, ['p1'], 1000)).toThrow(
      'ITEMS_EXCEED_AMOUNT',
    )
  })

  it('item with empty paidFor is treated as nothing-contributing (non-ITEMIZED context)', () => {
    const items = [
      makeItem({
        amount: 500,
        paidFor: [],
        splitMode: 'EVENLY',
      }),
    ]
    const result = computePaidForFromItems(items, ['p1', 'p2'], 1000)
    // Empty paidFor contributes no shares; its amount is absorbed into filler
    // so Σ paidFor === expenseAmount (1000 EVENLY → 500 each)
    expect(result.paidFor).toHaveLength(2)
    expect(
      result.paidFor
        .map((p) => p.participant)
        .sort((a, b) => a.localeCompare(b)),
    ).toEqual(['p1', 'p2'])
    expect(
      result.paidFor.sort((a, b) => a.participant.localeCompare(b.participant)),
    ).toEqual([
      { participant: 'p1', shares: 500 },
      { participant: 'p2', shares: 500 },
    ])
    expect(result.effectiveAmount).toBe(1000)
  })

  it('multiple items, multiple members: paidFor totals match expense amount exactly', () => {
    const items = [
      makeItem({
        amount: 250,
        paidFor: [
          { participant: 'p1', shares: 1 },
          { participant: 'p2', shares: 1 },
        ],
        splitMode: 'EVENLY',
      }),
      makeItem({
        amount: 300,
        paidFor: [
          { participant: 'p2', shares: 2 },
          { participant: 'p3', shares: 1 },
        ],
        splitMode: 'BY_SHARES',
      }),
      makeItem({
        amount: 150,
        paidFor: [{ participant: 'p1', shares: 1 }],
        splitMode: 'EVENLY',
      }),
    ]
    const result = computePaidForFromItems(items, ['p1', 'p2', 'p3'], 1000)
    // Items sum = 250 + 300 + 150 = 700. Filler = 300 across 3 = 100 each
    // Item 1: 250 EVENLY [p1,p2] → distributeEvenly(250,2) = [125,125]
    // Item 2: 300 BY_SHARES [p2:2,p3:1] → distributeWeighted(300,[2,1],3) = [200,100]
    // Item 3: 150 EVENLY [p1] → 150
    // Filler: 300 evenly across [p1,p2,p3] → [100,100,100]
    // p1: 125+150+100 = 375, p2: 125+200+100 = 425, p3: 100+100 = 200
    expect(result.paidFor).toHaveLength(3)
    expect(
      result.paidFor
        .map((p) => p.participant)
        .sort((a, b) => a.localeCompare(b)),
    ).toEqual(['p1', 'p2', 'p3'])
    const sum = result.paidFor.reduce((s, p) => s + p.shares, 0)
    expect(sum).toBe(1000)
    expect(
      result.paidFor.sort((a, b) => a.participant.localeCompare(b.participant)),
    ).toEqual([
      { participant: 'p1', shares: 375 },
      { participant: 'p2', shares: 425 },
      { participant: 'p3', shares: 200 },
    ])
    expect(result.effectiveAmount).toBe(1000)
  })

  it('multiple items with mixed split modes: each participant gets the right cent amount summing to expenseAmount', () => {
    const items = [
      makeItem({
        amount: 600,
        paidFor: [
          { participant: 'p1', shares: 1 },
          { participant: 'p2', shares: 1 },
        ],
        splitMode: 'EVENLY',
      }),
      makeItem({
        amount: 400,
        paidFor: [
          { participant: 'p2', shares: 3 },
          { participant: 'p3', shares: 1 },
        ],
        splitMode: 'BY_SHARES',
      }),
    ]
    const result = computePaidForFromItems(items, ['p1', 'p2', 'p3'], 1000)
    // Item 1: 600 EVENLY [p1,p2] → 300/300
    // Item 2: 400 BY_SHARES [p2:3,p3:1] → 300/100
    // p1: 300, p2: 600, p3: 100
    const sum = result.paidFor.reduce((s, p) => s + p.shares, 0)
    expect(sum).toBe(1000)
    expect(
      result.paidFor.sort((a, b) => a.participant.localeCompare(b.participant)),
    ).toEqual([
      { participant: 'p1', shares: 300 },
      { participant: 'p2', shares: 600 },
      { participant: 'p3', shares: 100 },
    ])
  })

  it('two $50 EVENLY/3 items → aggregated 3333/3333/3334 (global-across-items)', () => {
    const items = [
      makeItem({
        amount: 5000,
        paidFor: [
          { participant: 'p1', shares: 1 },
          { participant: 'p2', shares: 1 },
          { participant: 'p3', shares: 1 },
        ],
        splitMode: 'EVENLY',
      }),
      makeItem({
        amount: 5000,
        paidFor: [
          { participant: 'p1', shares: 1 },
          { participant: 'p2', shares: 1 },
          { participant: 'p3', shares: 1 },
        ],
        splitMode: 'EVENLY',
      }),
    ]
    const result = computePaidForFromItems(items, ['p1', 'p2', 'p3'], 10000)
    // Global: 10000/3 each → not 3332/3334/3334 from per-item last-absorbs
    const byId = Object.fromEntries(
      result.paidFor.map((p) => [p.participant, p.shares]),
    )
    expect(byId.p1 + byId.p2 + byId.p3).toBe(10000)
    expect([byId.p1, byId.p2, byId.p3].sort((a, b) => a - b)).toEqual([
      3333, 3333, 3334,
    ])
  })

  it('filler participates in global accumulation (items sum < amount)', () => {
    const items = [
      makeItem({
        amount: 100,
        paidFor: [
          { participant: 'p1', shares: 1 },
          { participant: 'p2', shares: 1 },
          { participant: 'p3', shares: 1 },
        ],
        splitMode: 'EVENLY',
      }),
    ]
    // expense 200 → filler 100 EVENLY across 3; total exact 200/3 each
    const result = computePaidForFromItems(items, ['p1', 'p2', 'p3'], 200)
    const byId = Object.fromEntries(
      result.paidFor.map((p) => [p.participant, p.shares]),
    )
    expect(byId.p1 + byId.p2 + byId.p3).toBe(200)
    expect([byId.p1, byId.p2, byId.p3].sort((a, b) => a - b)).toEqual([
      66, 67, 67,
    ])
  })

  it('computeExactSharesFromItems returns non-truncated rationals', () => {
    const items = [
      makeItem({
        amount: 5000,
        paidFor: [
          { participant: 'p1', shares: 1 },
          { participant: 'p2', shares: 1 },
          { participant: 'p3', shares: 1 },
        ],
        splitMode: 'EVENLY',
      }),
      makeItem({
        amount: 5000,
        paidFor: [
          { participant: 'p1', shares: 1 },
          { participant: 'p2', shares: 1 },
          { participant: 'p3', shares: 1 },
        ],
        splitMode: 'EVENLY',
      }),
    ]
    const exact = computeExactSharesFromItems(items, ['p1', 'p2', 'p3'], 10000)
    // Two × (5000/3) each — fractional, not yet distributed
    expect(exact.p1).toEqual({ numerator: 10000n, denominator: 3n })
    expect(exact.p2).toEqual({ numerator: 10000n, denominator: 3n })
    expect(exact.p3).toEqual({ numerator: 10000n, denominator: 3n })
    // Sum equals expense amount exactly (no truncation yet)
    expect(exact.p1.numerator + exact.p2.numerator + exact.p3.numerator).toBe(
      30000n,
    )
    expect(exact.p1.denominator).toBe(3n)
  })
})

describe('buildDefaultPaidForForSplitMode', () => {
  it('EVENLY: one row per member, shares = 1', () => {
    const result = buildDefaultPaidForForSplitMode('EVENLY', ['a', 'b', 'c'], 0)
    expect(result).toEqual([
      { participant: 'a', shares: 1 },
      { participant: 'b', shares: 1 },
      { participant: 'c', shares: 1 },
    ])
  })

  it('BY_SHARES: one row per member, shares = 1', () => {
    const result = buildDefaultPaidForForSplitMode('BY_SHARES', ['x', 'y'], 0)
    expect(result).toEqual([
      { participant: 'x', shares: 1 },
      { participant: 'y', shares: 1 },
    ])
  })

  it('BY_PERCENTAGE: canonical floor BPS (no last-absorbs)', () => {
    const result = buildDefaultPaidForForSplitMode(
      'BY_PERCENTAGE',
      ['a', 'b', 'c'],
      0,
    )
    expect(result).toHaveLength(3)
    // Math.floor(10000 / 3) = 3333 each (sum may be < 10000; read-side distributes)
    expect(result[0].shares).toBe(3333)
    expect(result[1].shares).toBe(3333)
    expect(result[2].shares).toBe(3333)
  })

  it('BY_AMOUNT: canonical floor minor units (no last-absorbs)', () => {
    const result = buildDefaultPaidForForSplitMode(
      'BY_AMOUNT',
      ['a', 'b', 'c'],
      100,
    )
    expect(result).toHaveLength(3)
    // Math.floor(100 / 3) = 33 each
    expect(result[0].shares).toBe(33)
    expect(result[1].shares).toBe(33)
    expect(result[2].shares).toBe(33)
  })

  it('BY_AMOUNT works with odd amounts and single member', () => {
    const result = buildDefaultPaidForForSplitMode('BY_AMOUNT', ['a'], 999)
    expect(result).toEqual([{ participant: 'a', shares: 999 }])
  })

  it('returns empty array for empty members', () => {
    const result = buildDefaultPaidForForSplitMode('EVENLY', [], 100)
    expect(result).toEqual([])
  })
})
