import { describe, expect, it } from 'vitest'
import {
  recoverSpliitOriginalAmount,
  shouldRecoverSpliitOriginal,
} from './spliit-original-amount'

describe('recoverSpliitOriginalAmount', () => {
  it('recovers from ledger ÷ rate', () => {
    expect(recoverSpliitOriginalAmount(11000, 1.1)).toBe(10000)
    expect(recoverSpliitOriginalAmount(9200, 0.92)).toBe(10000)
  })

  it('restores cents when upstream originalAmount dropped them (#513)', () => {
    // amount=123 ledger, rate=1, broken originalAmount=1 → recover 123
    expect(recoverSpliitOriginalAmount(123, 1)).toBe(123)
    expect(recoverSpliitOriginalAmount(123, 0.456)).toBe(270)
  })
})

describe('shouldRecoverSpliitOriginal', () => {
  it('requires original currency and a positive rate', () => {
    expect(
      shouldRecoverSpliitOriginal({
        originalCurrency: 'EUR',
        conversionRate: 1.1,
      }),
    ).toBe(true)
    expect(
      shouldRecoverSpliitOriginal({
        originalCurrency: null,
        conversionRate: 1.1,
      }),
    ).toBe(false)
    expect(
      shouldRecoverSpliitOriginal({
        originalCurrency: 'EUR',
        conversionRate: 0,
      }),
    ).toBe(false)
    expect(
      shouldRecoverSpliitOriginal({
        originalCurrency: 'EUR',
        conversionRate: null,
      }),
    ).toBe(false)
  })
})
