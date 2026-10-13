import { Context, Effect, Layer } from 'effect'

import type { CurrencyRate } from '../currency-rates'
import { readRateCache, writeRateCache } from '../rate-cache'

/**
 * In-process TTL rate cache behind an Effect service so the FX engine composes
 * it via `yield*` instead of calling module functions directly. The default
 * layer delegates to the same store as `rate-cache.ts`, so the existing test
 * utilities (`clearCurrencyRateCache`, `currencyRateCacheSize`) keep observing
 * the same entries.
 */
export class RateCache extends Context.Service<
  RateCache,
  {
    readonly get: (key: string) => Effect.Effect<CurrencyRate | null>
    readonly set: (
      key: string,
      value: CurrencyRate,
      ttlMs: number,
    ) => Effect.Effect<void>
  }
>()('spliit/fx/RateCache') {
  static readonly Live = Layer.succeed(
    RateCache,
    RateCache.of({
      get: (key) => Effect.sync(() => readRateCache<CurrencyRate>(key)),
      set: (key, value, ttlMs) =>
        Effect.sync(() => {
          writeRateCache(key, value, ttlMs)
        }),
    }),
  )
}
