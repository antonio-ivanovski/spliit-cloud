import { distributeRemainder } from './remainder-distribution'
import { calculateExactShares } from './totals'

const sumValues = (map: Record<string, number>) =>
  Object.values(map).reduce((s, n) => s + n, 0)

describe('distributeRemainder', () => {
  it('exact division produces no remainder', () => {
    const exact = calculateExactShares({
      amount: 100,
      splitMode: 'EVENLY',
      participants: [
        { id: 'a', shares: 1 },
        { id: 'b', shares: 1 },
      ],
    })
    const result = distributeRemainder(exact, 100)
    expect(result).toEqual({ a: 50, b: 50 })
  })

  it('positive remainder: 100/3 → 33/33/34', () => {
    const exact = calculateExactShares({
      amount: 100,
      splitMode: 'EVENLY',
      participants: [
        { id: 'a', shares: 1 },
        { id: 'b', shares: 1 },
        { id: 'c', shares: 1 },
      ],
    })
    const result = distributeRemainder(exact, 100, { seed: 0 })
    expect(sumValues(result)).toBe(100)
    expect(Object.values(result).sort((x, y) => x - y)).toEqual([33, 33, 34])
  })

  it('negative amount (refund) truncates toward zero', () => {
    const exact = calculateExactShares({
      amount: -101,
      splitMode: 'EVENLY',
      participants: [
        { id: 'a', shares: 1 },
        { id: 'b', shares: 1 },
        { id: 'c', shares: 1 },
      ],
    })
    const result = distributeRemainder(exact, -101, { seed: 0 })
    expect(sumValues(result)).toBe(-101)
    expect(Object.values(result).every((n) => n <= 0)).toBe(true)
  })

  it('tie-break with seed is deterministic and seed-dependent', () => {
    const exact = calculateExactShares({
      amount: 100,
      splitMode: 'EVENLY',
      participants: [
        { id: 'a', shares: 1 },
        { id: 'b', shares: 1 },
        { id: 'c', shares: 1 },
      ],
    })
    const r0 = distributeRemainder(exact, 100, { seed: 0 })
    const r1 = distributeRemainder(exact, 100, { seed: 1 })
    const r0b = distributeRemainder(exact, 100, { seed: 0 })

    expect(r0).toEqual(r0b)
    expect(sumValues(r0)).toBe(100)
    expect(sumValues(r1)).toBe(100)
    // Same frac for all → seed rotates who gets the extra cent
    expect(r0).not.toEqual(r1)
  })

  it('BY_AMOUNT payer fallback gives entire diff to payerId', () => {
    const exact = calculateExactShares({
      amount: 100,
      splitMode: 'BY_AMOUNT',
      participants: [
        { id: 'a', shares: 30 },
        { id: 'b', shares: 30 },
      ],
    })
    const result = distributeRemainder(exact, 100, { payerId: 'payer' })
    expect(result.a).toBe(30)
    expect(result.b).toBe(30)
    expect(result.payer).toBe(40)
    expect(sumValues(result)).toBe(100)
  })

  it('empty participants with payerId assigns full amount to payer', () => {
    expect(distributeRemainder({}, 50, { payerId: 'payer' })).toEqual({
      payer: 50,
    })
  })

  it('empty participants without payerId returns empty', () => {
    expect(distributeRemainder({}, 50)).toEqual({})
  })
})
