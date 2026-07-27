import { describe, expect, it } from 'vitest'
import { percentageToBasisPoints } from './totals'

describe('percentageToBasisPoints', () => {
  it('rounds display percentages to integer basis points', () => {
    expect(percentageToBasisPoints(33.33)).toBe(3333)
    expect(percentageToBasisPoints(33.34)).toBe(3334)
  })

  it('handles raw input values and incomplete numeric input safely', () => {
    expect(percentageToBasisPoints('12.5')).toBe(1250)
    expect(percentageToBasisPoints('')).toBe(0)
    expect(percentageToBasisPoints('not-a-number')).toBe(0)
  })
})
