import { Context, Effect } from 'effect'

import { isAbortError } from '@/lib/offline/connectivity'

import { HttpError, NetworkError, RateLimitError, TimeoutError } from './errors'

/**
 * Platform primitives: the only services that touch raw browser APIs.
 *
 * Everything above this module works with Effects and injected services; only
 * these constructors wrap fetch / Date.now. Third-party failures are normalized
 * to tagged errors exactly once here — upper layers pattern-match tags and
 * never re-inspect raw failures.
 */

export const FETCH_DEFAULT_TIMEOUT_MS = 10_000
/** Invalid/missing Retry-After defers callers 60s (parity with sync.ts). */
export const RATE_LIMIT_DEFAULT_RETRY_AFTER_MS = 60_000

export interface PlatformClock {
  readonly now: Effect.Effect<number>
}

export const PlatformClock = Context.Service<PlatformClock>('PlatformClock')

export type FetchTransportError =
  | NetworkError
  | TimeoutError
  | HttpError
  | RateLimitError

export interface FetchRequestOptions {
  /** Bound for the whole request. Expired bound -> TimeoutError (offline proof). */
  readonly timeoutMs?: number
  /** Caller abort (navigation, account switch) -> interruption, never offline. */
  readonly signal?: AbortSignal
}

export interface FetchTransport {
  readonly request: (
    input: string,
    init?: RequestInit,
    options?: FetchRequestOptions,
  ) => Effect.Effect<Response, FetchTransportError>
}

export const FetchTransport = Context.Service<FetchTransport>('FetchTransport')

export interface FetchTransportDeps {
  readonly fetchFn?: typeof fetch
  readonly defaultTimeoutMs?: number
}

/**
 * Parse a Retry-After header to milliseconds. Accepts delta-seconds and
 * HTTP-dates; returns null when missing/invalid so callers apply the 60s
 * default (same policy as parseRetryAfterMs in sync.ts).
 */
export function parseRetryAfterMs(value: string | null): number | null {
  if (value === null) return null
  const trimmed = value.trim()
  if (!trimmed) return null
  const seconds = Number(trimmed)
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000
  const dateMs = Date.parse(trimmed)
  if (!Number.isNaN(dateMs)) {
    const delta = dateMs - Date.now()
    return delta > 0 ? delta : 0
  }
  return null
}

function isAbortLike(error: unknown): boolean {
  if (isAbortError(error)) return true
  if (error instanceof DOMException && error.name === 'AbortError') return true
  return false
}

/**
 * The single normalization point for fetch rejections. Returns a tagged error
 * for expected failures, or null when the rejection is caller interruption
 * (external abort) and must propagate as Effect interruption instead.
 */
export function classifyFetchRejection(
  error: unknown,
  outcome: { timedOut: boolean; aborted: boolean; timeoutMs?: number },
): FetchTransportError | null {
  if (error instanceof TimeoutError) return error
  if (outcome.timedOut) {
    return new TimeoutError({
      operation: 'fetch',
      timeoutMs: outcome.timeoutMs ?? FETCH_DEFAULT_TIMEOUT_MS,
    })
  }
  if (outcome.aborted || isAbortLike(error)) return null
  if (error instanceof TypeError) {
    return new NetworkError({ reason: 'fetch-failed' })
  }
  return new NetworkError({ reason: 'unknown-fetch-failure' })
}

export function classifyHttpStatus(
  status: number,
  retryAfterMs: number | null,
): HttpError | RateLimitError | null {
  if (status === 429) {
    return new RateLimitError({
      status: 429,
      retryAfterMs: retryAfterMs ?? RATE_LIMIT_DEFAULT_RETRY_AFTER_MS,
    })
  }
  if (status >= 500 && status <= 599) return new HttpError({ status })
  return null
}

export function makeFetchTransport(deps?: FetchTransportDeps): FetchTransport {
  const fetchFn: typeof fetch =
    deps?.fetchFn ?? ((input, init) => fetch(input, init))
  const defaultTimeoutMs = deps?.defaultTimeoutMs ?? FETCH_DEFAULT_TIMEOUT_MS

  const request: FetchTransport['request'] = (input, init, options) =>
    Effect.gen(function* () {
      const timeoutMs = options?.timeoutMs ?? defaultTimeoutMs
      const externalSignal = options?.signal
      if (externalSignal?.aborted) {
        return yield* Effect.interrupt
      }
      const controller = new AbortController()
      let timedOut = false
      let aborted = false
      const onExternalAbort = () => {
        aborted = true
        controller.abort()
      }
      externalSignal?.addEventListener('abort', onExternalAbort, { once: true })
      const cleanup = Effect.sync(() => {
        externalSignal?.removeEventListener('abort', onExternalAbort)
      })

      const rawFetch = Effect.tryPromise({
        try: () =>
          fetchFn(input, { ...init, signal: controller.signal }).then(
            (response) => {
              if (timedOut) {
                throw new TimeoutError({ operation: 'fetch', timeoutMs })
              }
              return response
            },
          ),
        catch: (error: unknown) => error,
      })
      const attempt: Effect.Effect<Response, FetchTransportError> =
        Effect.matchEffect(rawFetch, {
          onFailure: (error: unknown) => {
            const classified = classifyFetchRejection(error, {
              timedOut,
              aborted,
              timeoutMs,
            })
            return classified === null
              ? Effect.interrupt
              : Effect.fail(classified)
          },
          onSuccess: (response: Response) => Effect.succeed(response),
        })

      const withTimeout =
        timeoutMs === undefined
          ? attempt
          : Effect.timeoutOption(attempt, timeoutMs).pipe(
              Effect.flatMap((option) => {
                if (option._tag === 'Some') return Effect.succeed(option.value)
                timedOut = true
                controller.abort()
                return Effect.fail(
                  new TimeoutError({ operation: 'fetch', timeoutMs }),
                )
              }),
            )

      const response = yield* Effect.ensuring(withTimeout, cleanup)
      const classified = classifyHttpStatus(
        response.status,
        parseRetryAfterMs(response.headers.get('Retry-After')),
      )
      if (classified !== null) return yield* Effect.fail(classified)
      return response
    })

  return { request }
}
