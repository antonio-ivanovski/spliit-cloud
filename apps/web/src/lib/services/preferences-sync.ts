import { Context, Deferred, Effect, Exit, Layer, Ref } from 'effect'

import { createSnapshotBridge, type SnapshotBridge } from './snapshot'

/**
 * Account-preferences sync service (Task 7).
 *
 * Serialized remote patch pipeline extracted from the account-preferences sync
 * component. The component keeps presentation, route/form interaction, and
 * command dispatch; this service owns Effect composition:
 *
 * - Serialized patches: remote writes join a Deferred tail chain in call order
 *   (replacing the hand-rolled promise chain). A predecessor's outcome never
 *   fails the chain, and an interrupted waiter still releases its successor via
 *   the ensuring finalizer — the queue cannot wedge.
 * - Optimistic state publishes immediately; confirmation replaces the confirmed
 *   snapshot; failure rolls back to confirmed plus still-pending patches and
 *   stamps lastErrorAt for the existing save-error UI.
 * - Stale-account fencing: every operation captures the account generation at
 *   dispatch and re-checks before remote work and before publishing. A
 *   generation move (switch, sign-out) discards the late outcome instead of
 *   rendering another account's preferences.
 * - Init/bootstrap fills server-null fields once, serialized with patches, and
 *   never while offline. Offline theme/locale choices stay local: applyLocal
 *   runs, the result reports savedRemotely:false, and no durable remote patch
 *   queue is built (read-only offline constraint).
 *
 * TRPC mutations stay behind the injected pushPatch/initializeRemote boundaries
 * (the component passes its hooks until Task 8 migrates callers); Zod
 * validation of server payloads stays at those boundaries. No new user-facing
 * copy: failures surface through the existing save-error path.
 */

export type PreferencePatch = Record<string, unknown>

export interface PreferencesSnapshot {
  readonly confirmed: PreferencePatch | null
  readonly optimistic: PreferencePatch | null
  readonly pending: number
  readonly isUpdating: boolean
  readonly lastErrorAt: number | null
}

export const INITIAL_PREFERENCES: PreferencesSnapshot = {
  confirmed: null,
  optimistic: null,
  pending: 0,
  isUpdating: false,
  lastErrorAt: null,
}

export type PatchResult =
  | { readonly saved: true }
  | {
      readonly saved: false
      readonly reason: 'offline' | 'stale-account' | 'not-ready'
    }
  | { readonly saved: false; readonly reason: 'remote-error' }

export interface PatchOptions {
  readonly optimistic?: boolean
  readonly signal?: AbortSignal
}

export interface PreferencesSyncDeps {
  /** Remote write (tRPC updatePreferences.mutateAsync). Serialized here. */
  readonly pushPatch: (
    patch: PreferencePatch,
    signal: AbortSignal,
  ) => Promise<PreferencePatch>
  /** One-shot bootstrap fill (tRPC initializePreferences.mutateAsync). */
  readonly initializeRemote?: (
    init: PreferencePatch,
    signal: AbortSignal,
  ) => Promise<PreferencePatch>
  /** Local presentation apply (theme/locale setters + cache). Never throws. */
  readonly applyLocal?: (patch: PreferencePatch) => void
  /** Confirmed-state side effects (cache + presentation persist). */
  readonly onConfirmed?: (preferences: PreferencePatch) => void
  /** Transport gate for remote pushes. Offline fails open nowhere here. */
  readonly canPush?: () => boolean
  /** Current account generation (supervisor snapshot). */
  readonly readGeneration?: () => number
  readonly now?: () => number
}

export interface PreferencesSyncService {
  readonly bridge: SnapshotBridge<PreferencesSnapshot>
  readonly snapshot: Effect.Effect<PreferencesSnapshot>
  /** Seed confirmed state (server data / cache) for an account generation. */
  readonly seedConfirmed: (
    preferences: PreferencePatch,
    generation: number,
  ) => Effect.Effect<void>
  /** Serialized optimistic patch with confirmation/rollback + fencing. */
  readonly patch: (
    patch: PreferencePatch,
    options?: PatchOptions,
  ) => Effect.Effect<PatchResult>
  /** Bootstrap fill when server fields are null. Serialized, online only. */
  readonly initialize: (
    init: PreferencePatch,
    options?: Pick<PatchOptions, 'signal'>,
  ) => Effect.Effect<PatchResult>
  /** Account-switch fence: later completions for older generations drop. */
  readonly fenceToGeneration: (generation: number) => Effect.Effect<void>
}

export const PreferencesSyncService = Context.Service<PreferencesSyncService>(
  'PreferencesSyncService',
)

type PendingPatch = { readonly id: number; readonly patch: PreferencePatch }

/**
 * Combine the caller's AbortSignal with the fiber interruption signal. Plain
 * promise-executor wiring (no Effect scheduling): aborts when either source
 * fires and detaches listeners on settle.
 */
function linkSignals(
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

export function makePreferencesSync(
  deps: PreferencesSyncDeps,
): PreferencesSyncService {
  const pushPatch = deps.pushPatch
  const initializeRemote = deps.initializeRemote ?? pushPatch
  const canPush = deps.canPush ?? (() => true)
  const now = deps.now ?? (() => Date.now())
  let ownedGeneration = deps.readGeneration?.() ?? 0
  const readGeneration = (): number =>
    deps.readGeneration?.() ?? ownedGeneration

  const bridge = createSnapshotBridge(INITIAL_PREFERENCES)
  const tailRef = Effect.runSync(Ref.make<Effect.Effect<void>>(Effect.void))
  let nextPatchId = 0

  const applyLocal = (patch: PreferencePatch): void => {
    try {
      deps.applyLocal?.(patch)
    } catch {
      // Local presentation must never fail a patch outcome.
    }
  }

  const notifyConfirmed = (preferences: PreferencePatch): void => {
    try {
      deps.onConfirmed?.(preferences)
    } catch {
      // Confirmation side effects must never fail the patch outcome.
    }
  }

  const mergePending = (
    confirmed: PreferencePatch | null,
    pendings: PendingPatch[],
  ): PreferencePatch | null => {
    if (!confirmed) return confirmed
    return pendings.reduce(
      (merged, pending) => ({ ...merged, ...pending.patch }),
      confirmed,
    )
  }

  // Pending list lives in a plain cell: every mutation runs inside an
  // Effect.sync section, which is atomic w.r.t. other fibers.
  let pendingList: PendingPatch[] = []
  const currentPendingSnapshot = (): PendingPatch[] => pendingList
  const setPending = (next: PendingPatch[]): void => {
    pendingList = next
  }

  /** Publish confirmed + remaining pendings; no-op when fenced. */
  const republish = (
    captured: number,
    confirmed: PreferencePatch | null,
    extra?: { readonly lastErrorAt?: number },
  ): void => {
    if (readGeneration() !== captured) return
    const current = bridge.getSnapshot()
    const pendings = currentPendingSnapshot()
    bridge.publish({
      confirmed,
      optimistic: mergePending(confirmed, pendings),
      pending: pendings.length,
      isUpdating: pendings.length > 0,
      lastErrorAt: extra?.lastErrorAt ?? current.lastErrorAt,
    })
  }

  /**
   * Join the serialized tail. The join itself is uninterruptible (intent is
   * never stranded); waiting and execution are interruptible, and the done gate
   * always settles so successors never wedge.
   */
  const runSerialized = <A, E>(
    task: Effect.Effect<A, E>,
  ): Effect.Effect<A, E> =>
    Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        const done = yield* Deferred.make<void>()
        const previous = yield* Ref.getAndSet(tailRef, Deferred.await(done))
        // A predecessor's outcome never fails us.
        yield* restore(Effect.ignore(previous))
        return yield* Effect.ensuring(
          restore(task),
          // succeed is idempotent-safe (false when already completed).
          Deferred.succeed(done, undefined),
        )
      }),
    )

  const finishPending = (
    captured: number,
    id: number,
    confirmed: PreferencePatch | null,
    extra?: { readonly lastErrorAt?: number },
  ): void => {
    setPending(pendingList.filter((pending) => pending.id !== id))
    if (readGeneration() !== captured) {
      // Fenced: publish bookkeeping only. Confirmed/optimistic (and the
      // error stamp, which belongs to the old account) stay untouched —
      // the scope switch re-seeds them.
      const current = bridge.getSnapshot()
      const remaining = pendingList.length
      bridge.publish({
        ...current,
        pending: remaining,
        isUpdating: remaining > 0,
      })
      return
    }
    republish(captured, confirmed, extra)
  }

  const seedConfirmed: PreferencesSyncService['seedConfirmed'] = (
    preferences,
    generation,
  ) =>
    Effect.sync(() => {
      ownedGeneration = generation
      setPending([])
      bridge.publish({
        confirmed: preferences,
        optimistic: preferences,
        pending: 0,
        isUpdating: false,
        lastErrorAt: bridge.getSnapshot().lastErrorAt,
      })
    })

  const patch: PreferencesSyncService['patch'] = (patch, options) =>
    Effect.gen(function* () {
      const captured = readGeneration()
      const current = bridge.getSnapshot()
      if (!current.confirmed) {
        return { saved: false, reason: 'not-ready' as const }
      }
      if (!canPush()) {
        // Offline: local presentation + in-memory value only. No pending
        // entry, no remote queue — reconnect uses existing precedence.
        if (options?.optimistic !== false) {
          const optimistic = { ...current.confirmed, ...patch }
          bridge.publish({ ...current, optimistic })
        }
        applyLocal(patch)
        return { saved: false, reason: 'offline' as const }
      }
      const id = (nextPatchId += 1)
      setPending([...pendingList, { id, patch }])
      if (options?.optimistic !== false) {
        const snapshot = bridge.getSnapshot()
        bridge.publish({
          ...snapshot,
          optimistic: mergePending(snapshot.confirmed, pendingList),
          pending: pendingList.length,
          isUpdating: true,
        })
      }
      return yield* runSerialized<PatchResult, never>(
        Effect.gen(function* () {
          if (readGeneration() !== captured) {
            finishPending(captured, id, bridge.getSnapshot().confirmed)
            return { saved: false, reason: 'stale-account' as const }
          }
          const callerSignal = options?.signal
          if (callerSignal?.aborted) {
            finishPending(captured, id, bridge.getSnapshot().confirmed)
            return yield* Effect.interrupt
          }
          // tryPromise (not promise): a remote rejection is an expected
          // outcome mapped below — never a defect.
          const remote = yield* Effect.exit(
            Effect.tryPromise({
              try: (fiberSignal) =>
                pushPatch(patch, linkSignals(callerSignal, fiberSignal)),
              catch: (error: unknown) => error,
            }),
          )
          if (Exit.isSuccess(remote)) {
            const confirmed = remote.value
            notifyConfirmed(confirmed)
            applyLocal(confirmed)
            finishPending(captured, id, confirmed)
            if (readGeneration() !== captured) {
              return { saved: false, reason: 'stale-account' as const }
            }
            return { saved: true as const }
          }
          finishPending(captured, id, bridge.getSnapshot().confirmed, {
            lastErrorAt: now(),
          })
          if (readGeneration() !== captured) {
            return { saved: false, reason: 'stale-account' as const }
          }
          return { saved: false, reason: 'remote-error' as const }
        }),
      )
    })

  const initialize: PreferencesSyncService['initialize'] = (init, options) =>
    Effect.gen(function* () {
      const captured = readGeneration()
      if (!canPush()) return { saved: false, reason: 'offline' as const }
      return yield* runSerialized<PatchResult, never>(
        Effect.gen(function* () {
          if (readGeneration() !== captured) {
            return { saved: false, reason: 'stale-account' as const }
          }
          if (options?.signal?.aborted) {
            return yield* Effect.interrupt
          }
          const remote = yield* Effect.exit(
            Effect.tryPromise({
              try: (fiberSignal) =>
                initializeRemote(
                  init,
                  linkSignals(options?.signal, fiberSignal),
                ),
              catch: (error: unknown) => error,
            }),
          )
          if (Exit.isFailure(remote)) {
            const snapshot = bridge.getSnapshot()
            if (readGeneration() === captured) {
              bridge.publish({ ...snapshot, lastErrorAt: now() })
            } else {
              return { saved: false, reason: 'stale-account' as const }
            }
            return { saved: false, reason: 'remote-error' as const }
          }
          const confirmed = remote.value
          notifyConfirmed(confirmed)
          applyLocal(confirmed)
          if (readGeneration() !== captured) {
            return { saved: false, reason: 'stale-account' as const }
          }
          setPending([])
          bridge.publish({
            confirmed,
            optimistic: confirmed,
            pending: 0,
            isUpdating: false,
            lastErrorAt: bridge.getSnapshot().lastErrorAt,
          })
          return { saved: true as const }
        }),
      )
    })

  const fenceToGeneration: PreferencesSyncService['fenceToGeneration'] = (
    generation,
  ) =>
    Effect.sync(() => {
      ownedGeneration = generation
      setPending([])
      const current = bridge.getSnapshot()
      bridge.publish({ ...current, pending: 0, isUpdating: false })
    })

  return {
    bridge,
    snapshot: bridge.readEffect,
    seedConfirmed,
    patch,
    initialize,
    fenceToGeneration,
  }
}

export function makePreferencesSyncLive(
  deps: PreferencesSyncDeps,
): Layer.Layer<PreferencesSyncService> {
  return Layer.succeed(PreferencesSyncService, makePreferencesSync(deps))
}
