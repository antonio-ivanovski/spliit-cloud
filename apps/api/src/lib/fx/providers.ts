import { Context, Effect, Layer } from 'effect'

import { fetchCoinbaseSpot, type CryptoFetchImpl } from '../crypto-rates'
import {
  fetchFrankfurterRates,
  type FiatFetchImpl,
  type FrankfurterResponse,
} from '../fiat-rates'
import {
  fxProviderErrorFromThrow,
  isRetryableFxError,
  type FxProviderError,
} from './errors'
import { FX_MAX_ATTEMPTS, fxRetrySchedule } from './policy'

/**
 * Frankfurter fiat quotes behind an Effect service. Transport failures are
 * classified into retryable/non-retryable `FxProviderError`s and retried on the
 * shared jittered backoff — the same budget the engine always had (3 attempts,
 * 250ms base).
 */
export class FiatRates extends Context.Service<
  FiatRates,
  {
    readonly fetch: (
      date: string,
      base: string,
      quotes: string[],
    ) => Effect.Effect<FrankfurterResponse, FxProviderError>
  }
>()('spliit/fx/FiatRates') {
  static readonly Live = (impl: FiatFetchImpl = fetchFrankfurterRates) =>
    Layer.succeed(
      FiatRates,
      FiatRates.of({
        fetch: (date, base, quotes) =>
          Effect.tryPromise({
            try: () => impl(date, base, quotes),
            catch: fxProviderErrorFromThrow,
          }).pipe(
            Effect.retry({
              while: isRetryableFxError,
              times: FX_MAX_ATTEMPTS - 1,
              schedule: fxRetrySchedule,
            }),
          ),
      }),
    )
}

/**
 * Coinbase crypto spot quotes behind an Effect service. Same retry contract as
 * `FiatRates`; a null spot means "no quote", not a failure.
 */
export class CryptoRates extends Context.Service<
  CryptoRates,
  {
    readonly fetchSpot: (
      date: string,
      base: string,
      target: string,
    ) => Effect.Effect<number | null, FxProviderError>
  }
>()('spliit/fx/CryptoRates') {
  static readonly Live = (impl: CryptoFetchImpl = fetchCoinbaseSpot) =>
    Layer.succeed(
      CryptoRates,
      CryptoRates.of({
        fetchSpot: (date, base, target) =>
          Effect.tryPromise({
            try: () => impl(date, base, target),
            catch: fxProviderErrorFromThrow,
          }).pipe(
            Effect.retry({
              while: isRetryableFxError,
              times: FX_MAX_ATTEMPTS - 1,
              schedule: fxRetrySchedule,
            }),
          ),
      }),
    )
}
