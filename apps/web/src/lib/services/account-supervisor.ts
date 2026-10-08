import { Cause, Context, Effect, Exit, Fiber, Layer } from 'effect'

import { createSnapshotBridge, type SnapshotBridge } from './snapshot'

/**
 * Account supervisor (Task 2): one child scope per active namespace.
 *
 * Authenticated tasks forked through forkAccountTask are tracked per generation
 * and interrupted on switch, so no detached account fiber can publish after its
 * scope closed. The pure reducer owns the ordering contract; the Effect service
 * owns interruption, fencing, and failure representation:
 *
 * - SwitchRequested synchronously clears the current identity (rendering stops)
 *   and bumps the generation BEFORE any async cleanup runs. The invalidation
 *   callback (legacy fencing + query invalidation) fires in the same
 *   uninterruptible region.
 * - Async closure runs interruptibly; its completion is fenced by generation — a
 *   superseded switch discards late completions instead of publishing.
 * - Failed cleanup is explicit (status failed + failedFor + reason) and the new
 *   scope is never mounted over it; retryCleanup re-runs closure.
 * - Shutdown/interruption during cleanup is captured via Effect.exit and
 *   represented as a fenced failure, never silently dropped.
 *
 * Durable fencing (revocation markers, IDB generation) stays with the lifecycle
 * module until Tasks 4-5 convert it; the supervisor drives it through
 * onInvalidatedSync/closeOldScope and never duplicates it.
 */

export interface AccountIdentity {
  readonly accountId: string
  readonly namespace: string
}

export type SupervisorStatus = 'idle' | 'switching' | 'failed'

export interface SupervisorSnapshot {
  readonly current: AccountIdentity | null
  /** Next identity awaiting activation (never rendered while pending). */
  readonly pending: AccountIdentity | null
  readonly status: SupervisorStatus
  readonly cleanupError: string | null
  readonly failedFor: AccountIdentity | null
  readonly generation: number
}

export const INITIAL_SUPERVISOR: SupervisorSnapshot = {
  current: null,
  pending: null,
  status: 'idle',
  cleanupError: null,
  failedFor: null,
  generation: 0,
}

export type SupervisorEvent =
  | { readonly _tag: 'SwitchRequested'; readonly next: AccountIdentity }
  | { readonly _tag: 'CleanupFailed'; readonly reason: string }
  | {
      readonly _tag: 'NewActivated'
      readonly identity: AccountIdentity
      readonly generation: number
    }
  | { readonly _tag: 'CleanupRetried'; readonly next: AccountIdentity }

/**
 * Pure supervisor transition. SwitchRequested always clears the visible
 * identity and fences the generation first; activation only lands when the
 * completing generation is still current; failures fence instead of mounting.
 */
export function reduceSupervisorEvent(
  state: SupervisorSnapshot,
  event: SupervisorEvent,
): SupervisorSnapshot {
  switch (event._tag) {
    case 'SwitchRequested': {
      if (state.current?.namespace === event.next.namespace) return state
      return {
        current: null,
        pending: event.next,
        status: 'switching',
        cleanupError: null,
        failedFor: null,
        generation: state.generation + 1,
      }
    }
    case 'CleanupFailed':
      return state.status === 'switching'
        ? {
            ...state,
            status: 'failed',
            cleanupError: event.reason,
            failedFor: state.pending,
            pending: null,
          }
        : state
    case 'NewActivated':
      if (state.status !== 'switching') return state
      if (event.generation !== state.generation) return state
      return {
        current: event.identity,
        pending: null,
        status: 'idle',
        cleanupError: null,
        failedFor: null,
        generation: state.generation,
      }
    case 'CleanupRetried':
      if (state.status !== 'failed') return state
      return {
        current: null,
        pending: event.next,
        status: 'switching',
        cleanupError: null,
        failedFor: null,
        generation: state.generation + 1,
      }
  }
}

export interface AccountSupervisorDeps {
  /** Durable async closure of the old scope (IDB delete, resource close). */
  readonly closeOldScope: (
    old: AccountIdentity,
    signal: AbortSignal,
  ) => Promise<void>
  /** Optional async setup before the new scope publishes (default: none). */
  readonly activateNewScope?: (
    next: AccountIdentity,
    signal: AbortSignal,
  ) => Promise<void>
  /**
   * Synchronous legacy invalidation (revocation marker, generation fence, query
   * abort/clear). Runs uninterruptibly with the identity clear.
   */
  readonly onInvalidatedSync?: (snapshot: SupervisorSnapshot) => void
  readonly initial?: SupervisorSnapshot
}

export interface AccountSupervisor {
  readonly bridge: SnapshotBridge<SupervisorSnapshot>
  readonly snapshot: Effect.Effect<SupervisorSnapshot>
  /** Fork a task owned by the current generation; interrupted on switch. */
  readonly forkAccountTask: <A, E, R>(
    effect: Effect.Effect<A, E, R>,
  ) => Effect.Effect<Fiber.Fiber<A, E>, never, R>
  /** Switch identity; old clears synchronously, new mounts after closure. */
  readonly requestSwitch: (next: AccountIdentity) => Effect.Effect<void>
  /** Re-run closure after a fenced failure, then mount when clean. */
  readonly retryCleanup: (next: AccountIdentity) => Effect.Effect<boolean>
}

export const AccountSupervisor =
  Context.Service<AccountSupervisor>('AccountSupervisor')

function reasonOf(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  return 'cleanup-failed'
}

export function makeAccountSupervisor(
  deps: AccountSupervisorDeps,
): AccountSupervisor {
  const bridge = createSnapshotBridge(deps.initial ?? INITIAL_SUPERVISOR)
  const activateNewScope = deps.activateNewScope ?? (() => Promise.resolve())

  // Tracked per-generation interrupters; a switch interrupts every task the
  // old scope forked through this supervisor. No detached account fibers.
  const tracked = new Set<Effect.Effect<void>>()

  const interruptTracked = (): Effect.Effect<void> =>
    Effect.forEach(Array.from(tracked), (interrupt) => interrupt, {
      discard: true,
    })

  const forkAccountTask: AccountSupervisor['forkAccountTask'] = (effect) =>
    Effect.gen(function* () {
      let fiber: Fiber.Fiber<unknown, unknown> | null = null
      const interrupter: Effect.Effect<void> = Effect.suspend(() =>
        fiber ? Fiber.interrupt(fiber) : Effect.void,
      )
      const body = Effect.ensuring(
        effect,
        Effect.sync(() => {
          tracked.delete(interrupter)
        }),
      )
      // Detached (not forkChild): the task is owned by the current
      // generation via `tracked`, not by the caller's scope. A short-lived
      // caller must not take its account task down with it; switch and
      // retry interrupt via `interruptTracked`.
      const forked = yield* Effect.forkDetach(body)
      fiber = forked as Fiber.Fiber<unknown, unknown>
      tracked.add(interrupter)
      return forked
    })

  const publishSync = (snapshot: SupervisorSnapshot): void => {
    bridge.publish(snapshot)
    try {
      deps.onInvalidatedSync?.(snapshot)
    } catch {
      // Legacy invalidation must never break the supervisor transition.
    }
  }

  const runClosure = (
    old: AccountIdentity | null,
    next: AccountIdentity,
    generation: number,
  ): Effect.Effect<void> =>
    Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        if (old) {
          const closed = yield* Effect.exit(
            restore(
              Effect.promise((signal) => deps.closeOldScope(old, signal)),
            ),
          )
          if (Exit.isFailure(closed)) {
            const current = yield* bridge.readEffect
            if (current.generation !== generation) return
            publishSync(
              reduceSupervisorEvent(current, {
                _tag: 'CleanupFailed',
                reason: reasonOf(Cause.squash(closed.cause)),
              }),
            )
            return
          }
        }
        const current = yield* bridge.readEffect
        if (current.generation !== generation) return
        const activated = yield* Effect.exit(
          restore(Effect.promise((signal) => activateNewScope(next, signal))),
        )
        const latest = yield* bridge.readEffect
        if (latest.generation !== generation) return
        if (Exit.isSuccess(activated)) {
          publishSync(
            reduceSupervisorEvent(latest, {
              _tag: 'NewActivated',
              identity: next,
              generation,
            }),
          )
        } else {
          publishSync(
            reduceSupervisorEvent(latest, {
              _tag: 'CleanupFailed',
              reason: 'activation-failed',
            }),
          )
        }
      }),
    )

  const requestSwitch: AccountSupervisor['requestSwitch'] = (next) =>
    Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        const before = yield* bridge.readEffect
        if (before.current?.namespace === next.namespace) return
        const old = before.current
        // Synchronously stop rendering the old identity and fence the
        // generation before any async cleanup runs.
        const invalidated = reduceSupervisorEvent(before, {
          _tag: 'SwitchRequested',
          next,
        })
        publishSync(invalidated)
        yield* interruptTracked()
        // Cleanup runs interruptibly; runClosure fences late completions by
        // generation and always represents the outcome (never silent).
        yield* restore(runClosure(old, next, invalidated.generation))
      }),
    )

  const retryCleanup: AccountSupervisor['retryCleanup'] = (next) =>
    Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        const before = yield* bridge.readEffect
        if (before.status !== 'failed') return false
        const old = before.failedFor ?? before.current
        const retried = reduceSupervisorEvent(before, {
          _tag: 'CleanupRetried',
          next,
        })
        publishSync(retried)
        yield* interruptTracked()
        yield* restore(runClosure(old, next, retried.generation))
        const after = yield* bridge.readEffect
        return after.status === 'idle'
      }),
    )

  return {
    bridge,
    snapshot: bridge.readEffect,
    forkAccountTask,
    requestSwitch,
    retryCleanup,
  }
}

/** App-wired supervisor layer (close/activate callbacks come from the provider). */
export function makeAccountSupervisorLive(
  deps: AccountSupervisorDeps,
): Layer.Layer<AccountSupervisor> {
  return Layer.succeed(AccountSupervisor, makeAccountSupervisor(deps))
}

/** True when the completing generation may still publish. */
export function isCurrentGeneration(
  snapshot: SupervisorSnapshot,
  generation: number,
): boolean {
  return snapshot.generation === generation
}
