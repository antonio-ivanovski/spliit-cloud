import { describe, expect, it } from 'vitest'

import { splitByWeights, splitEvenly } from './split-settle-math'

describe('splitEvenly', () => {
  it('splits exactly with no remainder', () => {
    expect(splitEvenly(9000, 3)).toEqual([3000, 3000, 3000])
  })

  it('deals the remainder one cent at a time to the first participants', () => {
    expect(splitEvenly(1000, 3)).toEqual([334, 333, 333])
  })

  it('handles zero and invalid input without inventing money', () => {
    expect(splitEvenly(0, 3)).toEqual([0, 0, 0])
    expect(splitEvenly(-5, 3)).toEqual([0, 0, 0])
    expect(splitEvenly(100, 0)).toEqual([])
  })
})

describe('splitByWeights', () => {
  it('splits proportionally and sums to the exact amount', () => {
    const shares = splitByWeights(1000, [1, 1, 1])
    expect(shares.reduce((a, b) => a + b, 0)).toBe(1000)
  })

  it('respects weights with largest-remainder rounding', () => {
    expect(splitByWeights(1000, [2, 1, 1])).toEqual([500, 250, 250])
    expect(splitByWeights(1000, [3, 0, 0])).toEqual([1000, 0, 0])
  })

  it('falls back to even split when weights are all zero', () => {
    expect(splitByWeights(1000, [0, 0, 0])).toEqual([334, 333, 333])
  })

  it('never drops a cent on awkward amounts', () => {
    for (const amount of [1, 2, 7, 999, 12345]) {
      const shares = splitByWeights(amount, [1, 2, 3])
      expect(shares.reduce((a, b) => a + b, 0)).toBe(amount)
    }
  })
})
