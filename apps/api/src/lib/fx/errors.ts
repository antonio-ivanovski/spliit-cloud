import { Schema } from 'effect'

import { CurrencyRateProviderError } from '../currency-errors'
import type { BatchRateResult } from '../currency-rates'

/**
 * Typed FX failures. Only `FxProviderError` with `retryable: true` is retried;
 * bad input (unsupported currency, unknown target, invalid date) fails fast.
 * This replaces the `instanceof`-chain predicate in `currency-rates.ts` with a
 * tag the retry policy can match on.
 */
export class FxUnsupportedCurrency extends Schema.TaggedError<FxUnsupportedCurrency>()(
  'FxUnsupportedCurrency',
  { currency: Schema.String },
) {}

export class FxRateNotFound extends Schema.TaggedError<FxRateNotFound>()(
  'FxRateNotFound',
  { target: Schema.String },
) {}

export class FxInvalidDate extends Schema.TaggedError<FxInvalidDate>()(
  'FxInvalidDate',
  { date: Schema.String },
) {}

export class FxProviderError extends Schema.TaggedError<FxProviderError>()(
  'FxProviderError',
  {
    message: Schema.String,
    retryable: Schema.Boolean,
  },
) {}

export type FxError =
  | FxUnsupportedCurrency
  | FxRateNotFound
  | FxInvalidDate
  | FxProviderError

export function isRetryableFxError(error: unknown): boolean {
  return error instanceof FxProviderError && error.retryable
}

function isNetworkLikeMessage(message: string): boolean {
  if (
    /timeout|abort|network|fetch failed|ECONN|ENOTFOUND|EAI_AGAIN|EPIPE|ETIMEDOUT/i.test(
      message,
    )
  ) {
    return true
  }
  return false
}

/** Classify a whole-batch throw as retryable or not (fail fast otherwise). */
export function fxProviderErrorFromThrow(cause: unknown): FxProviderError {
  if (cause instanceof FxProviderError) return cause
  if (cause instanceof CurrencyRateProviderError) {
    const retryable =
      cause.status === undefined ||
      cause.status === 429 ||
      (cause.status >= 500 && cause.status <= 599)
    return new FxProviderError({ message: cause.message, retryable })
  }
  if (cause instanceof TypeError) {
    return new FxProviderError({ message: cause.message, retryable: true })
  }
  if (cause instanceof Error) {
    return new FxProviderError({
      message: cause.message,
      retryable: isNetworkLikeMessage(cause.message),
    })
  }
  return new FxProviderError({ message: String(cause), retryable: false })
}

export function fxErrorFromItemError(
  error: Extract<BatchRateResult, { ok: false }>['error'],
): FxError {
  switch (error.code) {
    case 'UNSUPPORTED_CURRENCY':
      return new FxUnsupportedCurrency({ currency: error.currency })
    case 'RATE_NOT_FOUND':
      return new FxRateNotFound({ target: error.target })
    case 'INVALID_DATE':
      return new FxInvalidDate({ date: error.date })
    case 'PROVIDER_ERROR':
      // Surfaced per-key after the engine's own attempts; the batch resolves
      // partial success instead of retrying individual keys here.
      return new FxProviderError({ message: error.message, retryable: false })
  }
}
