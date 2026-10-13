import { describe, expect, it } from 'vitest'

import {
  classifyPairResults,
  rateResultUsesFallback,
  type PairRateSummary,
} from '@/components/currency-pair-conversion-card'
import type { CurrencyRatesResponse } from '@/lib/hooks'

const pair = { base: 'BGN', target: 'EUR', dates: ['2026-06-01', '2026-06-02'] }

function okResult(
  date: string,
  extra?: Partial<CurrencyRatesResponse[number] & { ok: true }>,
): CurrencyRatesResponse[number] {
  return {
    ok: true,
    rate: {
      rate: 0.51129,
      requestedDate: date,
      asOfDate: date,
      base: 'BGN',
      target: 'EUR',
      sources: [{ provider: 'frankfurter', base: 'BGN', target: 'EUR' }],
      ...extra?.rate,
    },
  }
}

function fixedResult(date: string): CurrencyRatesResponse[number] {
  return {
    ok: true,
    rate: {
      rate: 1 / 1.95583,
      requestedDate: date,
      asOfDate: date,
      base: 'BGN',
      target: 'EUR',
      sources: [{ provider: 'fixed', base: 'BGN', target: 'EUR' }],
    },
  }
}

const failedResult: CurrencyRatesResponse[number] = {
  ok: false,
  error: { code: 'RATE_NOT_FOUND', target: 'EUR' },
}

describe('rateResultUsesFallback', () => {
  it('flags fixed legs as fallback', () => {
    expect(rateResultUsesFallback(fixedResult('2026-06-01'))).toBe(true)
  })

  it('flags frozen EOL quotes as fallback', () => {
    expect(
      rateResultUsesFallback(
        okResult('2026-06-01', {
          rate: {
            rate: 0.5,
            requestedDate: '2026-06-01',
            asOfDate: '2025-12-31',
            base: 'BGN',
            target: 'JPY',
            sources: [{ provider: 'frankfurter', base: 'BGN', target: 'JPY' }],
          },
        }),
      ),
    ).toBe(true)
  })

  it('treats genuine market quotes as market', () => {
    expect(rateResultUsesFallback(okResult('2026-06-01'))).toBe(false)
  })

  it('treats failures as non-fallback', () => {
    expect(rateResultUsesFallback(failedResult)).toBe(false)
    expect(rateResultUsesFallback(undefined)).toBe(false)
  })
})

describe('classifyPairResults', () => {
  const items = [
    { date: '2026-06-01', base: 'BGN', target: 'EUR' },
    { date: '2026-06-02', base: 'BGN', target: 'EUR' },
  ]

  it('counts market, fallback, and failed outcomes', () => {
    const results: CurrencyRatesResponse = [
      okResult('2026-06-01'),
      fixedResult('2026-06-02'),
    ]
    const { values, failedKeys, summary } = classifyPairResults(
      pair,
      items,
      results,
      true,
    )
    expect(summary).toEqual({
      market: 1,
      fallback: 1,
      failed: 0,
      total: 2,
    } satisfies PairRateSummary)
    expect(Object.keys(values)).toHaveLength(2)
    expect(failedKeys.size).toBe(0)
  })

  it('treats fallback entries as missing for strict pairs', () => {
    const results: CurrencyRatesResponse = [
      okResult('2026-06-01'),
      fixedResult('2026-06-02'),
    ]
    const { values, failedKeys, summary } = classifyPairResults(
      pair,
      items,
      results,
      false,
    )
    expect(summary).toEqual({
      market: 1,
      fallback: 0,
      failed: 1,
      total: 2,
    } satisfies PairRateSummary)
    expect(values['2026-06-02|BGN|EUR']).toBeUndefined()
    expect(failedKeys.has('2026-06-02|BGN|EUR')).toBe(true)
  })

  it('returns a null summary while the batch is stale', () => {
    const { summary } = classifyPairResults(
      pair,
      items,
      [okResult('2026-06-01')],
      true,
    )
    expect(summary).toBeNull()
  })

  it('ignores other pairs in a shared batch', () => {
    const mixed = [...items, { date: '2026-06-01', base: 'USD', target: 'EUR' }]
    const results: CurrencyRatesResponse = [
      okResult('2026-06-01'),
      failedResult,
      okResult('2026-06-01'),
    ]
    const { summary } = classifyPairResults(pair, mixed, results, true)
    expect(summary?.total).toBe(2)
  })
})
