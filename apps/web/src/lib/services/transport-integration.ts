import { Cause, Effect, Exit } from 'effect'

import {
  getDefaultConnectivityStore,
  type TransportState,
} from '@/lib/offline/connectivity'

import { AppStatusService } from './app-status'
import type { ProbeOutcome } from './health'
import { classifyFetchRejection } from './platform'
import { getPageRuntime } from './runtime'

/**
 * Effect-backed fetch boundary (Task 3).
 *
 * Integrates trackedFetch parity, better-auth custom fetch, tRPC clients, and
 * TanStack query signals through one Effect-composed request path:
 *
 * - The caller's AbortSignal (TanStack query cancellation, navigation,
 *   account-switch fence) is propagated into the underlying fetch AND recorded
 *   for classification. User aborts never mark offline.
 * - Rejections are classified once with classifyFetchRejection (the same
 *   normalizer the transport service uses): genuine network failure marks
 *   unreachable, aborts stay silent, HTTP statuses are server answers.
 * - HTTP statuses resolve as Responses (SDK shape preserved: tRPC and better-auth
 *   read error bodies themselves). Only genuine failures throw, and they throw
 *   the ORIGINAL error — no typed service error crosses an SDK boundary.
 * - Outcomes fan out from a single classification through the canonical reporter
 *   (reportFetchOutcomeToServices): the legacy connectivity store (trackedFetch
 *   parity — the store is now a projection fed from here, see
 *   lib/offline/connectivity.ts) and the AppStatus bridge. One owner, two
 *   projections, no doubled reporting, no inline copies at call sites.
 * - No timeout bound by default (tRPC parity: previously unbounded). Explicit
 *   bounds report unreachable on expiry, like the probe bound.
 * - Never consults mutation admission and sends no idempotency headers: probes,
 *   verification, and queries bypass the guard by construction.
 */

export type FetchReportEvent =
  | { readonly kind: 'response'; readonly status: number }
  | { readonly kind: 'network-failure'; readonly error: unknown }
  | { readonly kind: 'aborted' }

/**
 * Canonical fetch-outcome reporter (Task 8 unification).
 *
 * Every SDK fetch outcome is classified EXACTLY ONCE
 * (probeOutcomeForFetchEvent) and projected to both consumers: the legacy
 * connectivity store (trackedFetch parity; the store keeps no independent
 * classification) and the AppStatus bridge (the forward read path). Call sites
 * pass this function — never an inline closure reimplementing the fan-out. The
 * AppStatus leg runs synchronously through the page runtime (the report Effect
 * is sync-only), so both projections settle before the fetch caller continues.
 */
export function reportFetchOutcomeToServices(event: FetchReportEvent): void {
  reportFetchOutcomeToLegacyStore(event)
  const outcome = probeOutcomeForFetchEvent(event)
  if (!outcome) return
  try {
    // runSync (not runFork): reportProbe is sync-only (snapshot publish +
    // listener notify), so the bridge settles deterministically on this
    // stack and tests can assert both projections without flushing fibers.
    getPageRuntime().runSync(
      Effect.gen(function* () {
        const service = yield* AppStatusService
        return yield* service.reportProbe(outcome)
      }),
    )
  } catch {
    // Reporting must never break the fetch path (runtime torn down in tests).
  }
}

/** TrackedFetch parity for the legacy store (single reporter, same calls). */
export function reportFetchOutcomeToLegacyStore(event: FetchReportEvent): void {
  const store = getDefaultConnectivityStore()
  switch (event.kind) {
    case 'response':
      if (event.status >= 500) {
        store.reportServerResponse(event.status)
      } else {
        store.reportNetworkSuccess()
        store.clearServerFailure()
      }
      return
    case 'network-failure':
      store.reportNetworkFailure(event.error)
      return
    case 'aborted':
      return
  }
}

/** AppStatus projection of one fetch outcome; null = no signal (abort). */
export function probeOutcomeForFetchEvent(
  event: FetchReportEvent,
): ProbeOutcome | null {
  switch (event.kind) {
    case 'response':
      return event.status >= 500 && event.status <= 599
        ? { outcome: 'server-failure', status: event.status }
        : { outcome: 'reachable' }
    case 'network-failure':
      return { outcome: 'unreachable' }
    case 'aborted':
      return null
  }
}

export function transportForFetchEvent(
  event: FetchReportEvent,
): TransportState | null {
  const outcome = probeOutcomeForFetchEvent(event)
  if (!outcome) return null
  return outcome.outcome === 'unreachable' ? 'unreachable' : 'reachable'
}

interface EdgeFailure {
  readonly original: unknown
  readonly timedOut: boolean
  readonly aborted: boolean
}

function abortError(): DOMException {
  return new DOMException('Aborted', 'AbortError')
}

export interface EffectFetchDeps {
  readonly fetchFn?: typeof fetch
  /** Whole-request bound; undefined preserves the unbounded SDK behavior. */
  readonly timeoutMs?: number
  readonly report?: (event: FetchReportEvent) => void
}

/**
 * A typeof-fetch implementation for SDK injection points (better-auth
 * customFetchImpl, tRPC httpBatchLink fetch). Query cancellation signals reach
 * the underlying fetch; interruptions never publish offline state.
 */
export function createEffectFetch(deps?: EffectFetchDeps): typeof fetch {
  const fetchFn: typeof fetch =
    deps?.fetchFn ?? ((input, init) => fetch(input, init))
  const timeoutMs = deps?.timeoutMs
  const report = deps?.report ?? reportFetchOutcomeToServices

  return ((input: RequestInfo | URL, init?: RequestInit) => {
    const externalSignal = init?.signal as AbortSignal | null | undefined
    const program: Effect.Effect<Response, EdgeFailure> =
      externalSignal?.aborted
        ? Effect.interrupt
        : Effect.scoped(
            Effect.gen(function* () {
              const state = yield* Effect.acquireRelease(
                Effect.sync(() => {
                  const controller = new AbortController()
                  let timedOut = false
                  const onExternalAbort = () => controller.abort()
                  externalSignal?.addEventListener('abort', onExternalAbort, {
                    once: true,
                  })
                  const timer =
                    timeoutMs === undefined
                      ? undefined
                      : setTimeout(() => {
                          timedOut = true
                          controller.abort()
                        }, timeoutMs)
                  return {
                    controller,
                    readTimedOut: () => timedOut,
                    cleanup: () => {
                      if (timer !== undefined) clearTimeout(timer)
                      externalSignal?.removeEventListener(
                        'abort',
                        onExternalAbort,
                      )
                    },
                  }
                }),
                (acquired) => Effect.sync(() => acquired.cleanup()),
              )
              return yield* Effect.tryPromise({
                try: () =>
                  fetchFn(input, {
                    ...init,
                    signal: state.controller.signal,
                  }),
                catch: (error: unknown): EdgeFailure => ({
                  original: error,
                  timedOut: state.readTimedOut(),
                  aborted: externalSignal?.aborted ?? false,
                }),
              })
            }),
          )
    return Effect.runPromiseExit(program).then((exit) => {
      if (Exit.isSuccess(exit)) {
        report({ kind: 'response', status: exit.value.status })
        return exit.value
      }
      const cause = exit.cause
      if (
        Cause.hasInterrupts(cause) &&
        !Cause.hasFails(cause) &&
        !Cause.hasDies(cause)
      ) {
        report({ kind: 'aborted' })
        throw abortError()
      }
      const found = Cause.findErrorOption<EdgeFailure>(cause)
      const edge =
        found._tag === 'Some'
          ? found.value
          : { original: Cause.squash(cause), timedOut: false, aborted: false }
      const classified = classifyFetchRejection(edge.original, {
        timedOut: edge.timedOut,
        aborted: edge.aborted,
      })
      if (classified === null) {
        report({ kind: 'aborted' })
        throw edge.original instanceof DOMException
          ? edge.original
          : abortError()
      }
      report({ kind: 'network-failure', error: edge.original })
      throw edge.original
    })
  }) as typeof fetch
}

/**
 * TanStack defaults for Effect-owned background bridges (probe-driven
 * refreshes, service retries): TanStack retry stays OFF so service retries
 * never double with query retries. Ordinary server queries keep TanStack
 * ownership (cache/dedup/ordinary retries). Task 4 wires the read hooks; the
 * contract lands here so both layers share one owner.
 */
export const EFFECT_BRIDGE_QUERY_DEFAULTS = {
  retry: 0,
  networkMode: 'always',
} as const
