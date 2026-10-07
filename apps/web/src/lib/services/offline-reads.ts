import { Context, Effect } from 'effect'

import { isAbortError } from '@/lib/offline/connectivity'
import {
  OFFLINE_WORKER_REQUEST_TIMEOUT_MS,
  OfflineWorkerUnavailableError,
  createOfflineQueryClient,
  type OfflineQueryClient,
  type OfflineWorkerRequest,
} from '@/lib/offline/query-worker'

import {
  CapabilityError,
  StaleGenerationError,
  TimeoutError,
  WorkerError,
} from './errors'

/**
 * Typed local read service (Task 4).
 *
 * The dedicated query worker opens Dexie itself; requests carry a request ID +
 * namespace/generation (+ publication revision where the engine reports one)
 * plus query args — never histories. The worker entry strips any snapshot
 * working set before posting, and the engine answers from its own Dexie
 * connection, so no whole-history transfer crosses into the main thread.
 *
 * Effect ownership at this boundary:
 *
 * - 30s bounded execution: Effect.timeoutOption wins over the caller's wait;
 *   expiry fails TimeoutError (offline proof for the UI boundary) while the
 *   client's own timer settles the loser. No doubled retry loops: background
 *   bridges built on this service use TanStack retry:0 (see
 *   EFFECT_BRIDGE_QUERY_DEFAULTS, wired in read-hooks.ts).
 * - Cancellation between batches: the caller's AbortSignal reaches the worker as
 *   a cancel message AND settles the pending registration; caller aborts
 *   propagate as Effect interruption, never as offline state.
 * - Stale-result fencing: completions are accepted only when the account
 *   generation is still current; late outcomes from non-cancellable worker
 *   responses fail StaleGenerationError instead of publishing.
 * - Bounded pages: results pass through untouched (the engine already bounds
 *   pages + pins pagination to the publication revision); this service never
 *   merges pages or synthesizes ready-empty results.
 * - Chunked main-thread fallback stays explicit (queryFallback, tests and
 *   benchmarks only): production read paths reject with CapabilityError when no
 *   worker exists instead of silently running heavy filtering on the main
 *   thread.
 *
 * Pure filtering/financial projections stay pure functions in read-model.ts;
 * only async batching/delivery becomes interruptible Effect execution here.
 */

export type ReadServiceError =
  | TimeoutError
  | WorkerError
  | CapabilityError
  | StaleGenerationError

export interface OfflineReadsDeps {
  /**
   * Worker client factory. Production default builds the real client (which
   * spawns the dedicated worker module); tests inject a stub worker. This is
   * the production client seam, not a test-only hook — the provider uses the
   * default, account scopes may substitute per-scope clients.
   */
  readonly createClient?: () => OfflineQueryClient
  /** Whole-query bound. Defaults to OFFLINE_WORKER_REQUEST_TIMEOUT_MS (30s). */
  readonly timeoutMs?: number
  /**
   * Current account generation reader. fenceToGeneration updates the owned
   * cell; pass an external reader (supervisor snapshot) when the service is
   * bound to an account scope in Task 8.
   */
  readonly readGeneration?: () => number
}

export interface OfflineReadQueryOptions {
  readonly timeoutMs?: number
  readonly signal?: AbortSignal
}

export interface OfflineReads {
  /**
   * Run one worker query with timeout + fencing. Fails StaleGenerationError
   * when the generation moved before the result could publish — callers must
   * not render it.
   */
  readonly query: (
    request: Omit<OfflineWorkerRequest, 'requestId'> & { requestId?: string },
    options?: OfflineReadQueryOptions,
  ) => Effect.Effect<unknown, ReadServiceError>
  /**
   * Explicit chunked main-thread fallback. Tests and benchmarks only;
   * production hooks never call this implicitly (missing worker rejects via
   * query with CapabilityError).
   */
  readonly queryFallback: (
    request: Omit<OfflineWorkerRequest, 'requestId'> & { requestId?: string },
    options?: OfflineReadQueryOptions,
  ) => Effect.Effect<unknown, ReadServiceError>
  /**
   * Account-switch fence: settle every pending from another generation and move
   * the owned generation forward. Survivor completions for older generations
   * fail stale instead of publishing.
   */
  readonly fenceToGeneration: (generation: number) => Effect.Effect<void>
  /** One controlled recreation after failure (foreground/explicit Retry). */
  readonly recreateAfterFailure: Effect.Effect<void>
  /** Terminate the worker and settle every pending registration. */
  readonly dispose: Effect.Effect<void>
}

export const OfflineReads = Context.Service<OfflineReads>('OfflineReads')

/**
 * Combine the caller's AbortSignal with the fiber interruption signal. Plain
 * promise-executor wiring (no Effect scheduling): aborts the shared controller
 * when either source fires and detaches listeners on settle.
 */
function combineSignals(
  caller: AbortSignal | undefined,
  fiberSignal: AbortSignal,
): AbortSignal {
  if (!caller) return fiberSignal
  if (caller.aborted || fiberSignal.aborted) {
    const aborted = new AbortController()
    aborted.abort()
    return aborted.signal
  }
  const controller = new AbortController()
  const onAbort = () => {
    caller.removeEventListener('abort', onAbort)
    fiberSignal.removeEventListener('abort', onAbort)
    controller.abort()
  }
  caller.addEventListener('abort', onAbort, { once: true })
  fiberSignal.addEventListener('abort', onAbort, { once: true })
  return controller.signal
}

function isAbortLike(error: unknown): boolean {
  if (isAbortError(error)) return true
  return error instanceof DOMException && error.name === 'AbortError'
}

function isTimeoutLike(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'TimeoutError'
}

/**
 * Exactly-once normalization for worker client rejections. Abort-like
 * rejections return null so the caller propagates interruption; everything else
 * becomes a typed tag with safe fixed payloads (never worker messages, which
 * could carry query args).
 *
 * The timeout check comes FIRST: TimeoutError DOMExceptions are also
 * abort-shaped (isAbortError matches both by connectivity convention), but an
 * expired bound is offline proof for the UI boundary, never silent
 * interruption. The bound is the caller's whole-query timeout so the payload
 * stays honest for custom bounds.
 */
export function mapReadError(
  error: unknown,
  timeoutMs: number = OFFLINE_WORKER_REQUEST_TIMEOUT_MS,
): ReadServiceError | null {
  if (isTimeoutLike(error)) {
    return new TimeoutError({
      operation: 'offline-query',
      timeoutMs,
    })
  }
  if (isAbortLike(error)) return null
  if (error instanceof OfflineWorkerUnavailableError) {
    return new CapabilityError({ capability: 'offline-query-worker' })
  }
  return new WorkerError({ worker: 'query', reason: 'query-failed' })
}

export function makeOfflineReads(deps?: OfflineReadsDeps): OfflineReads {
  const client = (deps?.createClient ?? (() => createOfflineQueryClient()))()
  const defaultTimeoutMs = deps?.timeoutMs ?? OFFLINE_WORKER_REQUEST_TIMEOUT_MS
  let ownedGeneration = deps?.readGeneration?.() ?? 0
  const readGeneration = (): number =>
    deps?.readGeneration?.() ?? ownedGeneration

  const runWithPolicy = (
    request: Omit<OfflineWorkerRequest, 'requestId'> & {
      requestId?: string
    },
    options: OfflineReadQueryOptions | undefined,
    run: (
      full: OfflineWorkerRequest,
      signal: AbortSignal | undefined,
    ) => Promise<unknown>,
  ): Effect.Effect<unknown, ReadServiceError> =>
    Effect.gen(function* () {
      if (options?.signal?.aborted) return yield* Effect.interrupt
      const timeoutMs = options?.timeoutMs ?? defaultTimeoutMs
      // tryPromise (not promise): a client rejection is an expected typed
      // outcome, never a defect — Effect.promise would let rejections bypass
      // mapping as defects.
      const raw = Effect.matchEffect(
        Effect.tryPromise({
          try: (fiberSignal) =>
            run(
              {
                ...request,
                requestId:
                  request.requestId ??
                  'q-' +
                    Date.now().toString(36) +
                    '-' +
                    Math.random().toString(36).slice(2),
              },
              // The caller's signal composes with fiber interruption: an
              // account-switch fence interrupts the fiber (signal aborts), a
              // React unmount aborts the caller signal. Either path settles
              // the pending registration.
              combineSignals(options?.signal, fiberSignal),
            ),
          catch: (error: unknown) => error,
        }),
        {
          onFailure: (error: unknown) => {
            const mapped = mapReadError(error, timeoutMs)
            return mapped === null ? Effect.interrupt : Effect.fail(mapped)
          },
          onSuccess: (value: unknown) => Effect.succeed(value),
        },
      )
      const bounded =
        timeoutMs === undefined
          ? raw
          : Effect.timeoutOption(raw, timeoutMs).pipe(
              Effect.flatMap((option) =>
                option._tag === 'Some'
                  ? Effect.succeed(option.value)
                  : Effect.fail(
                      new TimeoutError({
                        operation: 'offline-query',
                        timeoutMs,
                      }),
                    ),
              ),
            )
      const result = yield* bounded
      // Fence late completions: the worker cannot cancel a finished post, so
      // a generation move between send and delivery must not publish.
      if (readGeneration() !== request.generation) {
        return yield* Effect.fail(
          new StaleGenerationError({ namespace: request.namespace }),
        )
      }
      return result
    })

  return {
    query: (request, options) =>
      runWithPolicy(request, options, (full, signal) =>
        client.query(full, {
          signal,
          timeoutMs: options?.timeoutMs ?? defaultTimeoutMs,
        }),
      ),
    queryFallback: (request, options) =>
      runWithPolicy(request, options, (full) => client.fallback(full)),
    fenceToGeneration: (generation: number) =>
      Effect.sync(() => {
        ownedGeneration = generation
        client.discardGeneration(generation)
      }),
    recreateAfterFailure: Effect.sync(() => {
      client.recreateIfFailed()
    }),
    dispose: Effect.sync(() => {
      client.dispose()
    }),
  }
}
