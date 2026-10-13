import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'

import type { BatchRateResult } from '../currency-rates'
import { SwapValidationError } from '../currency-swap/errors'
import { planSwapPreviewEffect } from '../currency-swap/pipeline'
import { FxProviderError } from '../fx/errors'
import { FxRateService, FxTestRates, makeFxLayer } from '../fx/service'

const run = <A, E>(
  effect: Effect.Effect<A, E, FxRateService>,
  layer = FxTestRates({}),
) => Effect.runPromise(Effect.provide(effect, layer))
const flip = <A, E>(
  effect: Effect.Effect<A, E, FxRateService>,
  layer = FxTestRates({}),
) => run(Effect.flip(effect), layer)

describe('planSwapPreviewEffect', () => {
  it('rejects identical currencies without fetching rates', async () => {
    const error = await flip(
      planSwapPreviewEffect([], { oldCode: 'EUR', newCode: 'EUR' }),
    )
    expect(error._tag).toBe('SwapValidationError')
  })

  it('rejects invalid fixed-rate dates and non-positive overrides', async () => {
    const badDate = await flip(
      planSwapPreviewEffect([], {
        oldCode: 'EUR',
        newCode: 'GBP',
        modes: { 'EUR|GBP': { mode: 'fixed', date: 'not-a-date' } },
      }),
    )
    expect(badDate).toBeInstanceOf(SwapValidationError)
    const badOverride = await flip(
      planSwapPreviewEffect([], {
        oldCode: 'EUR',
        newCode: 'GBP',
        modes: {
          'EUR|GBP': { mode: 'fixed', date: '2024-06-01', override: 0 },
        },
      }),
    )
    expect(badOverride).toBeInstanceOf(SwapValidationError)
  })

  it('plans per-date rows through the FX service', async () => {
    const preview = await run(
      planSwapPreviewEffect(
        [
          { id: 'a', expenseDate: '2024-05-01', amount: 10000 },
          {
            id: 'b',
            expenseDate: '2024-05-02',
            amount: 11700,
            originalAmount: 10000,
            originalCurrency: 'GBP',
            conversionRate: 1.17,
            conversionSource: 'EXCHANGE',
          },
        ],
        { oldCode: 'EUR', newCode: 'GBP' },
      ),
      FxTestRates({ '2024-05-01|EUR|GBP': 0.85 }),
    )
    expect(preview.missingRateCount).toBe(0)
    expect(preview.sumOld).toBe(21700)
    const byId = new Map(preview.rows.map((r) => [r.id, r]))
    expect(byId.get('a')!.kind).toBe('simple')
    expect(byId.get('a')!.newAmount).toBe(8500)
    // C == N clears the stored conversion back to same-currency.
    expect(byId.get('b')!.kind).toBe('cleared')
    expect(byId.get('b')!.newAmount).toBe(10000)
    expect(byId.get('b')!.newConversionSource).toBeNull()
  })

  it('marks rows missing-rate when the service has no rate', async () => {
    const preview = await run(
      planSwapPreviewEffect(
        [{ id: 'a', expenseDate: '2024-05-01', amount: 10000 }],
        { oldCode: 'EUR', newCode: 'GBP' },
      ),
    )
    expect(preview.missingRateCount).toBe(1)
    expect(preview.rows[0]!.warning).toBe('missing-rate')
  })
})

describe('FxRateService retry (production policy, TestClock)', () => {
  const okResult = (rate: number): BatchRateResult => ({
    ok: true,
    rate: {
      rate,
      requestedDate: '2024-05-01',
      asOfDate: '2024-05-01',
      base: 'EUR',
      target: 'GBP',
      sources: [],
    },
  })

  it('retries retryable throws and succeeds without real waiting', async () => {
    let attempts = 0
    const flakyFetch = async (
      requests: Array<{ date: string; base: string; target: string }>,
    ): Promise<BatchRateResult[]> => {
      attempts++
      if (attempts < 3) throw new TypeError('fetch failed')
      return requests.map(() => okResult(0.85))
    }
    const program = Effect.flatMap(FxRateService, (fx) =>
      fx.getRates([{ date: '2024-05-01', base: 'EUR', target: 'GBP' }]),
    ).pipe(Effect.provide(makeFxLayer(flakyFetch)))
    // Two backoff sleeps (~250ms + ~500ms + jitter) on the live clock.
    const result = await Effect.runPromise(program)
    expect(attempts).toBe(3)
    expect(result.rates['2024-05-01|EUR|GBP']).toBe(0.85)
    expect(result.missing).toEqual([])
  })

  it('does not retry fail-fast throws', async () => {
    let attempts = 0
    const fatalFetch = async (): Promise<BatchRateResult[]> => {
      attempts++
      throw new FxProviderError({ message: 'bad input', retryable: false })
    }
    const program = Effect.flatMap(FxRateService, (fx) =>
      fx.getRates([{ date: '2024-05-01', base: 'EUR', target: 'GBP' }]),
    ).pipe(Effect.provide(makeFxLayer(fatalFetch)))
    const failed = await Effect.runPromise(Effect.flip(program))
    expect(failed._tag).toBe('FxProviderError')
    expect(attempts).toBe(1)
  })

  it('resolves per-key misses without throwing', async () => {
    const program = Effect.flatMap(FxRateService, (fx) =>
      fx.getRates([{ date: '2024-05-01', base: 'EUR', target: 'GBP' }]),
    ).pipe(
      Effect.provide(
        makeFxLayer(async (requests) =>
          requests.map((): BatchRateResult => ({
            ok: false,
            error: { code: 'RATE_NOT_FOUND', target: 'GBP' },
          })),
        ),
      ),
    )
    const result = await Effect.runPromise(program)
    expect(result.rates).toEqual({})
    expect(result.missing).toEqual(['2024-05-01|EUR|GBP'])
  })
})
