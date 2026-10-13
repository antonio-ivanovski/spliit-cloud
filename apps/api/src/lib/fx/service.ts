import { Context, Effect, Layer } from 'effect'

import {
  getCurrencyRates,
  type BatchRateRequest,
  type BatchRateResult,
} from '../currency-rates'
import {
  fxProviderErrorFromThrow,
  isRetryableFxError,
  type FxProviderError,
} from './errors'
import { FX_MAX_ATTEMPTS, fxRetrySchedule } from './policy'

export type FxRatesResult = {
  /** `date|BASE|TARGET` -> major-unit rate, successes only. */
  rates: Record<string, number>
  /** Keys with no rate (per-key failure, never throws the batch). */
  missing: string[]
}

const keyOf = (request: BatchRateRequest) =>
  `${request.date}|${request.base.toUpperCase()}|${request.target.toUpperCase()}`

/**
 * Partition a batch result into successes and missing keys. Per-key failures
 * (unsupported currency, unknown target, provider miss) resolve as missing
 * entries so callers can mark rows instead of failing the whole batch.
 */
export function partitionBatch(
  requests: BatchRateRequest[],
  results: BatchRateResult[],
): FxRatesResult {
  const rates: Record<string, number> = {}
  const missing: string[] = []
  for (let i = 0; i < requests.length; i++) {
    const key = keyOf(requests[i]!)
    const result = results[i]
    if (result?.ok) {
      rates[key] = result.rate.rate
    } else {
      missing.push(key)
    }
  }
  return { rates, missing }
}

export type FxFetchImpl = (
  requests: BatchRateRequest[],
) => Promise<BatchRateResult[]>

export class FxRateService extends Context.Service<
  FxRateService,
  {
    readonly getRates: (
      requests: BatchRateRequest[],
    ) => Effect.Effect<FxRatesResult, FxProviderError>
  }
>()('FxRateService') {}

function makeService(fetchImpl: FxFetchImpl) {
  return FxRateService.of({
    getRates: (requests) => {
      if (requests.length === 0) {
        return Effect.succeed({ rates: {}, missing: [] })
      }
      return Effect.tryPromise({
        try: () => fetchImpl(requests),
        catch: fxProviderErrorFromThrow,
      }).pipe(
        Effect.retry({
          while: isRetryableFxError,
          times: FX_MAX_ATTEMPTS - 1,
          schedule: fxRetrySchedule,
        }),
        Effect.map((results) => partitionBatch(requests, results)),
        Effect.withSpan('fx.getRates', {
          attributes: { 'fx.requestCount': requests.length },
        }),
      )
    },
  })
}

/** Live layer: the real batched rate engine behind the service boundary. */
export const FxLive = makeFxLayer()

/** Build the service over any batch fetch (live engine by default). */
export function makeFxLayer(
  fetchImpl: FxFetchImpl = (requests) => getCurrencyRates(requests),
) {
  return Layer.succeed(FxRateService, makeService(fetchImpl))
}

/** Test layer: scripted rates, no provider calls. */
export const FxTestRates = (rates: Record<string, number>) =>
  Layer.succeed(
    FxRateService,
    FxRateService.of({
      getRates: (requests) =>
        Effect.succeed({
          rates: Object.fromEntries(
            requests
              .map((r) => [keyOf(r), rates[keyOf(r)]] as const)
              .filter(([, rate]) => rate !== undefined),
          ) as Record<string, number>,
          missing: requests
            .map(keyOf)
            .filter((key) => rates[key] === undefined),
        }),
    }),
  )
