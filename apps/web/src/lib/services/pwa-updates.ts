import {
  Clock,
  Context,
  Deferred,
  Effect,
  Exit,
  Fiber,
  Layer,
  Option,
  Ref,
} from 'effect'

import { PWA_BUILD, pwaBuildSchema, type PwaBuild } from '@/lib/pwa-build'
import {
  createPwaUpdateManager,
  type PwaUpdateManager,
  type PwaUpdateSnapshot,
} from '@/lib/pwa-update-manager'

import { createSnapshotBridge, type SnapshotBridge } from './snapshot'

/**
 * Owns page-lifetime update discovery; the manager owns activation and
 * recovery.
 */
export const PWA_UPDATE_CHECK_INTERVAL_MS = 5 * 60 * 1000
export const PWA_UPDATE_CHECK_COOLDOWN_MS = 30_000

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

export type PwaUpdateTrigger =
  | 'startup'
  | 'foreground'
  | 'reconnect'
  | 'periodic'
  | 'manual'

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
  readonly fetchBuildInfo?: (signal: AbortSignal) => Promise<PwaBuild | null>
  readonly checkIntervalMs?: number
  readonly isOnline?: () => boolean
  readonly now?: () => number
  /** Visible-document gate for the periodic loop. No DOM default on purpose. */
  readonly isVisible?: () => boolean
}

export interface PwaUpdateService {
  readonly bridge: SnapshotBridge<PwaUpdateServiceSnapshot>
  readonly snapshot: Effect.Effect<PwaUpdateServiceSnapshot>
  /** Coalesced check trigger. Concurrent callers share one underlying check. */
  readonly checkNow: (trigger: PwaUpdateTrigger) => Effect.Effect<void>
  /** Start manager + periodic loop. Idempotent. */
  readonly start: Effect.Effect<void>
  /** Stop periodic loop. Idempotent; the manager stays until dispose. */
  readonly stop: Effect.Effect<void>
  /** Release manager listeners/timers. The layer scope calls this on exit. */
  readonly dispose: Effect.Effect<void>
  readonly retry: Effect.Effect<void>
  readonly dismissFailure: Effect.Effect<void>
  readonly updateNow: Effect.Effect<void>
}

export const PwaUpdateService =
  Context.Service<PwaUpdateService>('PwaUpdateService')

async function fetchBuildInfo(signal: AbortSignal): Promise<PwaBuild | null> {
  if (!import.meta.env.PROD) return null
  const response = await fetch('/version.json', { cache: 'no-store', signal })
  if (!response.ok) return null
  const parsed = pwaBuildSchema.safeParse(await response.json())
  return parsed.success ? parsed.data : null
}

export function makePwaUpdateService(
  deps?: PwaUpdateServiceDeps,
): PwaUpdateService {
  const createManager = deps?.createManager ?? createPwaUpdateManager
  const checkIntervalMs = deps?.checkIntervalMs ?? PWA_UPDATE_CHECK_INTERVAL_MS
  const isVisible =
    deps?.isVisible ??
    (() =>
      typeof document === 'undefined' || document.visibilityState === 'visible')
  const isOnline =
    deps?.isOnline ??
    (() => typeof navigator === 'undefined' || navigator.onLine !== false)
  const readBuild = deps?.fetchBuildInfo ?? fetchBuildInfo
  let lastAttemptAt = -Infinity
  let stopped = false
  let disposed = false
  const browserCleanup = new Set<() => void>()

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
    if (next !== current.update)
      bridge.publish({ update: next, check: current.check })
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

  const checkNow: PwaUpdateService['checkNow'] = (trigger) =>
    Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        if (disposed) return
        const handle = ensureManager()
        if (!isOnline() || (trigger !== 'manual' && !isVisible())) return
        const existing = yield* Ref.get(inflight)
        if (Option.isSome(existing)) {
          return yield* restore(Deferred.await(existing.value))
        }
        const gate = yield* Deferred.make<void>()
        yield* Ref.set(inflight, Option.some(gate))
        patchCheck({ inFlight: true })
        const checkTime = deps?.now
          ? deps.now()
          : yield* Clock.currentTimeMillis
        // tryPromise (not promise): a probe rejection is an expected outcome
        // that settles the gate — never a defect, never a snapshot failure.
        const outcome = yield* restore(
          Effect.exit(
            Effect.tryPromise({
              try: async (signal) => {
                const build = await readBuild(
                  AbortSignal.any([signal, AbortSignal.timeout(3000)]),
                ).catch(() => null)
                if (signal.aborted || stopped) return
                const hinted = build && build.buildId !== PWA_BUILD.buildId
                if (
                  !hinted &&
                  trigger !== 'startup' &&
                  trigger !== 'manual' &&
                  checkTime - lastAttemptAt < PWA_UPDATE_CHECK_COOLDOWN_MS
                )
                  return
                lastAttemptAt = checkTime
                await (deps?.checkForUpdate?.(signal) ??
                  handle.checkForUpdate())
                return true
              },
              catch: (error: unknown) => error,
            }).pipe(Effect.timeoutOption(15_000)),
          ),
        )
        yield* Ref.set(inflight, Option.none())
        if (stopped || disposed) {
          yield* Deferred.succeed(gate, undefined)
          return
        }
        if (
          Exit.isSuccess(outcome) &&
          Option.isSome(outcome.value) &&
          outcome.value.value
        ) {
          patchCheck({
            inFlight: false,
            lastCheckAt: checkTime,
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

  const periodicLoop: Effect.Effect<void> = Effect.gen(function* () {
    while (true) {
      yield* Effect.sleep(checkIntervalMs)
      // Periodic ticks only fire while visible; hidden ticks are skipped,
      // never queued — the next interval re-evaluates.
      if (isVisible()) {
        yield* checkNow('periodic')
      }
    }
  })

  const start: PwaUpdateService['start'] = Effect.gen(function* () {
    const started = yield* Ref.get(startedRef)
    if (started || disposed) return
    stopped = false
    ensureManager()
    const listen = (
      target: EventTarget,
      type: string,
      trigger: PwaUpdateTrigger,
    ) => {
      const listener = () => {
        void Effect.runPromise(checkNow(trigger)).catch(() => {})
      }
      target.addEventListener(type, listener)
      browserCleanup.add(() => target.removeEventListener(type, listener))
    }
    if (typeof document !== 'undefined')
      listen(document, 'visibilitychange', 'foreground')
    if (typeof window !== 'undefined') {
      listen(window, 'focus', 'foreground')
      listen(window, 'pageshow', 'foreground')
      listen(window, 'online', 'reconnect')
    }
    yield* Ref.set(startedRef, true)
    yield* checkNow('startup')
    if (!(yield* Ref.get(startedRef))) return
    // Detached (not auto-supervised): the periodic loop must survive start's
    // completion and die only via stop/dispose interrupting the tracked fiber.
    const fiber = yield* Effect.forkDetach(periodicLoop)
    yield* Ref.set(fiberRef, Option.some(fiber))
    yield* Ref.set(startedRef, true)
  })

  const stopLoop: Effect.Effect<void> = Effect.gen(function* () {
    stopped = true
    browserCleanup.forEach((release) => release())
    browserCleanup.clear()
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
    disposed = true
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
    retry: Effect.gen(function* () {
      yield* checkNow('manual')
      ensureManager().retry()
      syncManagerSnapshot()
    }),
    updateNow: Effect.sync(() => ensureManager().updateNow()),
    dismissFailure: Effect.sync(() => {
      ensureManager().dismissFailure()
      syncManagerSnapshot()
    }),
  }
}

/**
 * Page-scoped update layer: the periodic loop is interrupted and the manager
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
