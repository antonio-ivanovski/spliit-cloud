import { describe, expect, it } from 'vitest'
import {
  buildDefaultPaidForForSplitMode,
  computePaidForFromItems,
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

  it('single item, multiple participants, EVENLY with cents absorption', () => {
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
    // 100/3 = 33.33 each → floor = 33, last gets 34
    expect(result.paidFor.sort()).toEqual([
      { participant: 'p1', shares: 33 },
      { participant: 'p2', shares: 33 },
      { participant: 'p3', shares: 34 },
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
    expect(result.paidFor.sort()).toEqual([
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
    expect(result.paidFor.sort()).toEqual([
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
    expect(result.paidFor.sort()).toEqual([
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
    // Item: p1 gets 600. Filler: 400 across 3 members = 133/133/134
    // p1 total = 600 + 133 = 733, p2 = 133, p3 = 134
    expect(result.paidFor).toHaveLength(3)
    expect(result.paidFor.map((p) => p.participant).sort()).toEqual([
      'p1',
      'p2',
      'p3',
    ])
    const sum = result.paidFor.reduce((s, p) => s + p.shares, 0)
    expect(sum).toBe(1000)
    expect(result.effectiveAmount).toBe(1000)
    expect(result.paidFor.sort()).toEqual([
      { participant: 'p1', shares: 733 },
      { participant: 'p2', shares: 133 },
      { participant: 'p3', shares: 134 },
    ])
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

    expect(result.paidFor.sort()).toEqual([
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
    // Item contributes nothing because no participants. Items sum = 500.
    // Filler = 500 across 2 = 250 each
    expect(result.paidFor).toHaveLength(2)
    expect(result.paidFor.map((p) => p.participant).sort()).toEqual([
      'p1',
      'p2',
    ])
    expect(result.paidFor.sort()).toEqual([
      { participant: 'p1', shares: 250 },
      { participant: 'p2', shares: 250 },
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
    expect(result.paidFor.map((p) => p.participant).sort()).toEqual([
      'p1',
      'p2',
      'p3',
    ])
    const sum = result.paidFor.reduce((s, p) => s + p.shares, 0)
    expect(sum).toBe(1000)
    expect(result.paidFor.sort()).toEqual([
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
    // Item 1: 600 EVENLY [p1,p2] → [300, 300]
    // Item 2: 400 BY_SHARES [p2:3,p3:1] → distributeWeighted(400,[3,1],4) = [300, 100]
    // p1: 300, p2: 300+300=600, p3: 100
    // Sum = 1000
    const sum = result.paidFor.reduce((s, p) => s + p.shares, 0)
    expect(sum).toBe(1000)
    expect(result.paidFor.sort()).toEqual([
      { participant: 'p1', shares: 300 },
      { participant: 'p2', shares: 600 },
      { participant: 'p3', shares: 100 },
    ])
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

  it('BY_PERCENTAGE: distributes 10000 basis points evenly', () => {
    const result = buildDefaultPaidForForSplitMode(
      'BY_PERCENTAGE',
      ['a', 'b', 'c'],
      0,
    )
    expect(result).toHaveLength(3)
    const sum = result.reduce((s, r) => s + r.shares, 0)
    expect(sum).toBe(10000)
    // 10000 / 3 = 3333 each, last gets 3334
    expect(result[0].shares).toBe(3333)
    expect(result[1].shares).toBe(3333)
    expect(result[2].shares).toBe(3334)
  })

  it('BY_AMOUNT: distributes expenseAmount evenly in minor units', () => {
    const result = buildDefaultPaidForForSplitMode(
      'BY_AMOUNT',
      ['a', 'b', 'c'],
      100,
    )
    expect(result).toHaveLength(3)
    const sum = result.reduce((s, r) => s + r.shares, 0)
    expect(sum).toBe(100)
    // 100 / 3 = 33 each, last gets 34
    expect(result[0].shares).toBe(33)
    expect(result[1].shares).toBe(33)
    expect(result[2].shares).toBe(34)
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
