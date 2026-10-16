import { describe, expect, it } from 'vitest'

import { getCurrency } from '../currency'
import {
  buildNetExpense,
  buildOwedExpense,
  buildSettlement,
  buildWeightedExpense,
} from './expense-builder'

const EUR = getCurrency('EUR')!

function cents(
  built: Pick<
    ReturnType<typeof buildOwedExpense>,
    'paidBy' | 'paidFor' | 'splitMode' | 'paidBySourceId'
  >,
): { paidBy: number; paidFor: number } {
  return {
    paidBy: built.paidBy.reduce((s, p) => s + p.shares, 0),
    paidFor: built.paidFor.reduce((s, p) => s + p.shares, 0),
  }
}

describe('buildOwedExpense', () => {
  it('pins the rounding remainder to the payer so Σ paidFor is exact', () => {
    const built = buildOwedExpense({
      amountCents: 10000,
      currency: EUR,
      owedMajors: new Map([
        ['a', 33.33],
        ['b', 33.33],
        ['c', 33.33],
      ]),
      payerId: 'a',
    })
    expect(cents(built).paidFor).toBe(10000)
    const payer = built.paidFor.find((p) => p.sourceId === 'a')!
    // 3333 + 3333 + 3333 = 9999; the missing cent lands on the payer.
    expect(payer.shares).toBe(3334)
    expect(cents(built).paidBy).toBe(10000)
  })

  it('returns an explicit empty shape for a zero total', () => {
    const built = buildOwedExpense({
      amountCents: 0,
      currency: EUR,
      owedMajors: new Map(),
      payerId: 'a',
    })
    expect(built.paidFor).toEqual([])
    expect(built.paidBy).toEqual([{ sourceId: 'a', shares: 0 }])
    expect(built.splitMode).toBe('BY_AMOUNT')
  })

  it('lets the payer absorb the full amount when nothing is owed', () => {
    const built = buildOwedExpense({
      amountCents: 5000,
      currency: EUR,
      owedMajors: new Map([
        ['a', 0],
        ['b', -10],
      ]),
      payerId: 'a',
    })
    expect(built.paidFor).toEqual([{ sourceId: 'a', shares: 5000 }])
  })
})

describe('buildNetExpense', () => {
  it('absorbs the positive residual into the payer', () => {
    const built = buildNetExpense({
      amountCents: 4000,
      currency: EUR,
      netMajors: new Map([
        ['a', 20],
        ['b', -20],
      ]),
      payerId: 'a',
    })
    expect(cents(built).paidFor).toBe(4000)
    expect(cents(built).paidBy).toBe(4000)
    expect(built.paidBySourceId).toBe('a')
  })

  it('even-splits the remainder across positives (multi-payer parity)', () => {
    // Mirrors the `multi players` splitwise fixture row
    // (200.00 MKD; nets 33.33 / 33.33 / -66.66): the debtor serializes to
    // 6666, the 13334 remainder splits evenly over the two positives —
    // never pinned to the payer.
    const built = buildNetExpense({
      amountCents: 20000,
      currency: getCurrency('MKD')!,
      netMajors: new Map([
        ['a', 33.33],
        ['b', 33.33],
        ['c', -66.66],
      ]),
      payerId: 'a',
    })
    expect(built.paidFor).toEqual([
      { sourceId: 'c', shares: 6666 },
      { sourceId: 'a', shares: 6667 },
      { sourceId: 'b', shares: 6667 },
    ])
    expect(built.paidBy).toEqual([
      { sourceId: 'a', shares: 10000 },
      { sourceId: 'b', shares: 10000 },
    ])
    expect(built.splitMode).toBe('BY_AMOUNT')
  })

  it('keeps a zero total truthful with an empty shape', () => {
    const built = buildNetExpense({
      amountCents: 0,
      currency: EUR,
      netMajors: new Map(),
      payerId: 'a',
    })
    expect(built.paidFor).toEqual([])
    expect(built.paidBy).toEqual([{ sourceId: 'a', shares: 0 }])
  })
})

describe('buildWeightedExpense', () => {
  it('splits equal weights evenly and pins residue to the payer', () => {
    const built = buildWeightedExpense({
      amountCents: 10000,
      weights: new Map([
        ['a', 1],
        ['b', 1],
        ['c', 1],
      ]),
      payerId: 'a',
    })
    expect(built.splitMode).toBe('EVENLY')
    expect(cents(built).paidFor).toBe(10000)
  })

  it('turns unequal weights into a BY_SHARES ratio', () => {
    const built = buildWeightedExpense({
      amountCents: 40000,
      weights: new Map([
        ['a', 1],
        ['b', 3],
      ]),
      payerId: 'a',
    })
    expect(built.splitMode).toBe('BY_SHARES')
    expect(built.paidFor).toEqual([
      { sourceId: 'a', shares: 100 },
      { sourceId: 'b', shares: 300 },
    ])
  })

  it('falls back to exact cents when the ratio exceeds the share cap', () => {
    const built = buildWeightedExpense({
      amountCents: 10000,
      weights: new Map([
        ['a', 1],
        ['b', 30],
      ]),
      payerId: 'a',
    })
    expect(built.splitMode).toBe('BY_AMOUNT')
    expect(cents(built).paidFor).toBe(10000)
  })

  it('treats zero weights as 1 like upstream balances do', () => {
    const built = buildWeightedExpense({
      amountCents: 10000,
      weights: new Map([
        ['a', 0],
        ['b', 0],
      ]),
      payerId: 'a',
    })
    expect(built.splitMode).toBe('EVENLY')
    expect(cents(built).paidFor).toBe(10000)
  })
})

describe('buildSettlement', () => {
  it('routes the full amount payer → receiver', () => {
    expect(
      buildSettlement({ payerId: 'a', receiverId: 'b', amountCents: 2500 }),
    ).toEqual({
      paidBySourceId: 'a',
      paidBy: [{ sourceId: 'a', shares: 2500 }],
      paidFor: [{ sourceId: 'b', shares: 2500 }],
      splitMode: 'EVENLY',
    })
  })
})
