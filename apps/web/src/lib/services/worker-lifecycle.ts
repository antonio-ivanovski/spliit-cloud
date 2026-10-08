import { Effect, Layer, ManagedRuntime, type Scope } from 'effect'

import { StaleGenerationError } from './errors'
import { FetchTransportLive, PlatformClockLive } from './layers'

/**
 * Worker lifetime ownership (Task 2).
 *
 * Split design: the dedicated query worker runs a SEPARATE runtime with its own
 * service graph and its own Dexie connection (the worker module already opens
 * Dexie itself via getWorkerDatabase; it must use makeWorkerRuntime, never the
 * page runtime). The worker graph is DOM-free — platform clock + fetch
 * transport only — so worker modules stay DOM-free and no browser listener,
 * port, or page DB handle can leak across the boundary.
 *
 * Service-worker handlers (Task 6 converts them) must run per-event scoped
 * Effects: scopeForEvent gives each event a fresh Scope closed when the event
 * settles, wired to waitUntil/respondWith. There is no always-running worker
 * loop assumption — an event that never settles still releases its scope.
 *
 * Shutdown cleanup (scope close, DB handle release) is best-effort: security
 * correctness stays on durable fences (revocation markers, generation,
 * revision/lease checks owned by the lifecycle/repository), never on finalizers
 * running at shutdown.
 */

export function makeWorkerRuntime() {
  return ManagedRuntime.make(
    Layer.mergeAll(PlatformClockLive, FetchTransportLive),
  )
}

export type WorkerRuntime = ReturnType<typeof makeWorkerRuntime>

/**
 * Give one browser/worker event a fresh Scope, closed when the Effect settles.
 * Run the result through waitUntil (background work) or respondWith (fetch
 * handling):
 *
 * Event.waitUntil(workerRuntime.runPromise(scopeForEvent(program)))
 */
export function scopeForEvent<A, E, R>(
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, Exclude<R, Scope.Scope>> {
  return Effect.scoped(effect)
}

export interface FencedPublish {
  /** Generation the completing work belonged to. */
  readonly expectedGeneration: number
  /** Current generation reader (supervisor snapshot, lifecycle, control). */
  readonly readCurrentGeneration: () => number
  readonly namespace: string
  /** Publication that must not run for a retired generation. */
  readonly publish: Effect.Effect<void>
}

/** Fail stale completions with StaleGenerationError (never publish them). */
export function fenceGuard(
  expectedGeneration: number,
  readCurrentGeneration: () => number,
  namespace: string,
): Effect.Effect<void, StaleGenerationError> {
  return readCurrentGeneration() === expectedGeneration
    ? Effect.void
    : Effect.fail(new StaleGenerationError({ namespace }))
}

/**
 * Publish only when the generation is still current; discard late outcomes from
 * non-cancellable APIs (worker responses, SDK callbacks) silently. Returns true
 * when published, false when fenced — the caller never mistakes a discard for a
 * commit.
 */
export function attemptPublish(fenced: FencedPublish): Effect.Effect<boolean> {
  return Effect.matchEffect(
    fenceGuard(
      fenced.expectedGeneration,
      fenced.readCurrentGeneration,
      fenced.namespace,
    ),
    {
      onFailure: () => Effect.succeed(false),
      onSuccess: () => Effect.as(fenced.publish, true),
    },
  )
}
