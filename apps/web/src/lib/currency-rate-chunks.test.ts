import { describe, expect, it } from 'vitest'

import { CURRENCY_RATES_BATCH_LIMIT, chunkCurrencyRateItems } from './hooks'

describe('chunkCurrencyRateItems', () => {
  it('returns no chunks for empty input', () => {
    expect(chunkCurrencyRateItems([])).toEqual([])
  })

  it('keeps small batches in a single chunk', () => {
    const items = [1, 2, 3]
    expect(chunkCurrencyRateItems(items)).toEqual([[1, 2, 3]])
  })

  it('splits exactly at the server item cap', () => {
    const items = Array.from(
      { length: CURRENCY_RATES_BATCH_LIMIT + 1 },
      (_, i) => i,
    )
    const chunks = chunkCurrencyRateItems(items)
    expect(chunks).toHaveLength(2)
    expect(chunks[0]).toHaveLength(CURRENCY_RATES_BATCH_LIMIT)
    expect(chunks[1]).toHaveLength(1)
  })

  it('preserves input order across chunks', () => {
    const items = Array.from({ length: 1201 }, (_, i) => `item-${i}`)
    const chunks = chunkCurrencyRateItems(items)
    expect(chunks).toHaveLength(3)
    expect(chunks.flat()).toEqual(items)
  })
})
