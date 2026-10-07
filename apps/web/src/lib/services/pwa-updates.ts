import {
  Context,
  Deferred,
  Effect,
  Exit,
  Fiber,
  Layer,
  Option,
  Ref,
} from 'effect'

import {
  createPwaUpdateManager,
  type PwaUpdateManager,
  type PwaUpdateSnapshot,
} from '@/lib/pwa-update-manager'

import { createSnapshotBridge, type SnapshotBridge } from './snapshot'

/**
 * PWA update lifecycle service (Task 6).
 *
 * The page-side update state machine (registration, idle-gated coordinated
 * activation, blockers, asset recovery, route/scroll restoration) stays inside
 * `createPwaUpdateManager` — this service owns its lifetime and adds the Effect
 * command surface around it (Task 8 unified):
 *
 * - One manager per service instance, created on start and disposed on stop/scope
 *   exit. No module-singleton sharing: tests and the page each own theirs. The
 *   manager runs with its internal check subscription DISABLED
 *   (enableUpdateChecks:false): check cadence (hourly while visible,
 *   foreground, reconnect, manual Retry) flows only through the checkNow
 *   single-flight gate here. The manager keeps updatefound observation +
 *   coordinated activation. The former module singleton is deleted (Task 8):
 *   the pill binds this service, and page wiring never started the singleton.
 * - Update checks (foreground return, reconnect, hourly-while-visible, manual
 *   Retry) coalesce through ONE single-flight gate: concurrent triggers share
 *   the in-flight registration.update instead of stampeding the network.
 * - The hourly loop only checks while visible; hidden ticks are skipped, never
 *   queued. Interruption (page disposal, account teardown) publishes nothing.
 * - Retry/dismissFailure delegate to the manager synchronously — no async
 *   scheduling around them.
 *
 * Untouched by design: the versioned coordination protocol
 * (pwa-update-protocol), the worker-side coordinator, Workbox shell routing in
 * sw.ts, and the 30s-idle / prepare-confirm / no-max-wait-force / max-2-reload
 * policies inside the manager. Those are covered by their own suites; this
 * service owns the driver around them.
 */

export const PWA_UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000

export interface PwaUpdateCheckSnapshot {
  readonly inFlight: boolean
  readonly lastCheckAt: number | null
  readonly checks: number
}

export interface PwaUpdateServiceSnapshot {
  readonly update: PwaUpdateSnapshot
  readonly check: PwaUpdateCheckSnapshot
}

export const INITIAL_PWA_UPDATE_CHECK: PwaUpdateCheckSnapshot = {
  inFlight: false,
  lastCheckAt: null,
  checks: 0,
}

export type PwaUpdateTrigger = 'foreground' | 'reconnect' | 'hourly' | 'manual'

export interface PwaUpdateServiceDeps {
  /**
   * Manager factory. Production default builds the real page-side state
   * machine; tests inject a stub. This is the production seam (the page owns
   * one manager), not a test-only hook.
   */
  readonly createManager?: () => PwaUpdateManager
  /**
   * Registration update probe. Production default reuses the live registration
   * when available; tests inject a stub. Check rejections settle the gate
   * silently — checks are opportunistic and the failure/Retry UI lives in the
   * manager.
   */
  readonly checkForUpdate?: (signal: AbortSignal) => Promise<unknown>
  readonly checkIntervalMs?: number
  readonly now?: () => number
  /** Visible-document gate for the hourly loop. No DOM default on purpose. */
  readonly isVisible?: () => boolean
}

export interface PwaUpdateService {
  readonly bridge: SnapshotBridge<PwaUpdateServiceSnapshot>
  readonly snapshot: Effect.Effect<PwaUpdateServiceSnapshot>
  /** Coalesced check trigger. Concurrent callers share one underlying check. */
  readonly checkNow: (trigger: PwaUpdateTrigger) => Effect.Effect<void>
  /** Start manager + hourly loop. Idempotent. */
  readonly start: Effect.Effect<void>
  /** Stop hourly loop. Idempotent; the manager stays until dispose. */
  readonly stop: Effect.Effect<void>
  /** Release manager listeners/timers. The layer scope calls this on exit. */
  readonly dispose: Effect.Effect<void>
  readonly retry: Effect.Effect<void>
  readonly dismissFailure: Effect.Effect<void>
}

export const PwaUpdateService =
  Context.Service<PwaUpdateService>('PwaUpdateService')

function defaultCheckForUpdate(signal: AbortSignal): Promise<unknown> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve(null)
      return
    }
    const done = () => resolve(null)
    signal.addEventListener('abort', done, { once: true })
    try {
      if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
        done()
        return
      }
      void navigator.serviceWorker
        .getRegistration()
        .then((registration) => {
          if (signal.aborted || !registration) {
            done()
            return
          }
          registration.update().then(done).catch(done)
        })
        .catch(done)
    } catch {
      done()
    }
  })
}

export function makePwaUpdateService(
  deps?: PwaUpdateServiceDeps,
): PwaUpdateService {
  // Single-owner checks: the service gate drives registration.update(); the
  // manager must not run its own hourly/visibility subscription beside it.
  const createManager =
    deps?.createManager ??
    (() => createPwaUpdateManager({ enableUpdateChecks: false }))
  const checkForUpdate = deps?.checkForUpdate ?? defaultCheckForUpdate
  const checkIntervalMs = deps?.checkIntervalMs ?? PWA_UPDATE_CHECK_INTERVAL_MS
  const now = deps?.now ?? (() => Date.now())
  const isVisible = deps?.isVisible ?? (() => true)

  let manager: PwaUpdateManager | null = null
  let unsubscribe: (() => void) | null = null
  const inflight = Effect.runSync(
    Ref.make(Option.none<Deferred.Deferred<void>>()),
  )
  const startedRef = Effect.runSync(Ref.make(false))
  const fiberRef = Effect.runSync(Ref.make(Option.none<Fiber.Fiber<void>>()))

  const bridge = createSnapshotBridge<PwaUpdateServiceSnapshot>({
    update: { status: 'hidden' },
    check: INITIAL_PWA_UPDATE_CHECK,
  })

  const syncManagerSnapshot = (): void => {
    const current = bridge.getSnapshot()
    const next = manager?.getSnapshot() ?? { status: 'hidden' as const }
    if (
      next.status !== current.update.status ||
      (next.status === 'failed' &&
        current.update.status === 'failed' &&
        next.dismissed !== current.update.dismissed)
    ) {
      bridge.publish({ update: next, check: current.check })
    }
  }

  const patchCheck = (patch: Partial<PwaUpdateCheckSnapshot>): void => {
    const current = bridge.getSnapshot()
    bridge.publish({
      update: current.update,
      check: { ...current.check, ...patch },
    })
  }

  const ensureManager = (): PwaUpdateManager => {
    if (!manager) {
      manager = createManager()
      unsubscribe = manager.subscribe(syncManagerSnapshot)
      syncManagerSnapshot()
    }
    return manager
  }

  const checkNow: PwaUpdateService['checkNow'] = () =>
    Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        ensureManager()
        const existing = yield* Ref.get(inflight)
        if (Option.isSome(existing)) {
          return yield* restore(Deferred.await(existing.value))
        }
        const gate = yield* Deferred.make<void>()
        yield* Ref.set(inflight, Option.some(gate))
        patchCheck({ inFlight: true })
        // tryPromise (not promise): a probe rejection is an expected outcome
        // that settles the gate — never a defect, never a snapshot failure.
        const outcome = yield* restore(
          Effect.exit(
            Effect.tryPromise({
              try: (signal) => checkForUpdate(signal),
              catch: (error: unknown) => error,
            }),
          ),
        )
        yield* Ref.set(inflight, Option.none())
        if (Exit.isSuccess(outcome)) {
          patchCheck({
            inFlight: false,
            lastCheckAt: now(),
            checks: bridge.getSnapshot().check.checks + 1,
          })
        } else {
          patchCheck({ inFlight: false })
        }
        // Joiners share the outcome either way; the failure/Retry UI lives
        // in the manager, so the gate never carries a failure.
        yield* Deferred.succeed(gate, undefined)
      }),
    )

  const hourlyLoop: Effect.Effect<void> = Effect.gen(function* () {
    while (true) {
      yield* Effect.sleep(checkIntervalMs)
      // Hourly ticks only fire while visible; hidden ticks are skipped,
      // never queued — the next interval re-evaluates.
      if (isVisible()) {
        yield* checkNow('hourly')
      }
    }
  })

  const start: PwaUpdateService['start'] = Effect.gen(function* () {
    const started = yield* Ref.get(startedRef)
    if (started) return
    ensureManager()
    // Detached (not auto-supervised): the hourly loop must survive start's
    // completion and die only via stop/dispose interrupting the tracked fiber.
    const fiber = yield* Effect.forkDetach(hourlyLoop)
    yield* Ref.set(fiberRef, Option.some(fiber))
    yield* Ref.set(startedRef, true)
  })

  const stopLoop: Effect.Effect<void> = Effect.gen(function* () {
    const fiber = yield* Ref.get(fiberRef)
    yield* Ref.set(fiberRef, Option.none())
    if (Option.isSome(fiber)) {
      yield* Fiber.interrupt(fiber.value)
    }
  })

  const stop: PwaUpdateService['stop'] = Effect.gen(function* () {
    yield* stopLoop
    yield* Ref.set(startedRef, false)
  })

  const dispose: PwaUpdateService['dispose'] = Effect.gen(function* () {
    yield* stopLoop
    yield* Ref.set(startedRef, false)
    const handle = manager
    const release = unsubscribe
    manager = null
    unsubscribe = null
    if (release) {
      yield* Effect.sync(release)
    }
    if (handle) {
      yield* Effect.sync(() => handle.dispose())
    }
  })

  return {
    bridge,
    snapshot: bridge.readEffect,
    checkNow,
    start,
    stop,
    dispose,
    retry: Effect.sync(() => {
      ensureManager().retry()
      syncManagerSnapshot()
    }),
    dismissFailure: Effect.sync(() => {
      ensureManager().dismissFailure()
      syncManagerSnapshot()
    }),
  }
}

/**
 * Page-scoped update layer: the hourly loop is interrupted and the manager
 * disposed when the scope exits. Checks never outlive the page scope.
 */
export function makePwaUpdateServiceLive(
  deps?: PwaUpdateServiceDeps,
): Layer.Layer<PwaUpdateService> {
  return Layer.effect(
    PwaUpdateService,
    Effect.acquireRelease(
      Effect.sync(() => makePwaUpdateService(deps)),
      (service) => service.dispose,
    ),
  )
}
