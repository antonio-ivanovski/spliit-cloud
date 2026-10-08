import { Context, Deferred, Effect, Exit, Layer, Option, Ref } from 'effect'

import { AppStatusService } from './app-status'
import { HealthProbe, nextProbeDelayMs, type ProbeOutcome } from './health'
import { SessionService } from './session'
import type { SessionVerification } from './session'

/**
 * Probe orchestration (Task 3): one single-flight driver for liveness.
 *
 * - ProbeNow coalesces concurrent triggers (online/foreground/Retry) into ONE
 *   underlying probeOnce: the first trigger runs it, joiners await the same
 *   Deferred. Hidden recovery, no stacked probes.
 * - The runner reports its outcome exactly once; a failed/interrupted run wakes
 *   joiners with the same exit and publishes nothing — caller interruption
 *   propagates as interruption, never as an outcome.
 * - ProbeThenVerify chains session verification after a reachable probe (8s bound
 *   inside SessionService); successful null revokes, failures preserve — see
 *   session.ts.
 * - ProbeWithRecovery runs a caller-invoked bounded retry chain with the visible
 *   5/15/30/60s + jitter delays (Effect.delay, TestClock-friendly). The
 *   orchestrator never polls on its own: no autonomous loop is added beside the
 *   legacy store scheduler (Task 5 removes that scheduler).
 * - Probes and verification bypass the mutation admission guard by construction:
 *   this module never imports it and sends no idempotency headers.
 */

export const PROBE_RECOVERY_ATTEMPTS = 4

export interface ProbeOrchestratorDeps {
  readonly probe: HealthProbe
  readonly reportProbe: (outcome: ProbeOutcome) => Effect.Effect<void>
  readonly verifySession?: (options?: {
    readonly signal?: AbortSignal
  }) => Effect.Effect<SessionVerification>
  readonly reportSession?: (
    verification: SessionVerification,
  ) => Effect.Effect<void>
  readonly random01?: () => number
}

export const ProbeOrchestrator =
  Context.Service<ProbeOrchestrator>('ProbeOrchestrator')

export interface ProbeOrchestrator {
  readonly probeNow: (options?: {
    readonly signal?: AbortSignal
  }) => Effect.Effect<ProbeOutcome>
  readonly probeThenVerify: (options?: {
    readonly signal?: AbortSignal
  }) => Effect.Effect<ProbeOutcome>
  readonly probeWithRecovery: (options?: {
    readonly signal?: AbortSignal
    readonly maxAttempts?: number
  }) => Effect.Effect<ProbeOutcome>
}

export function recoveryDelayMs(attempt: number, random01: number): number {
  return nextProbeDelayMs(attempt, random01)
}

export function makeProbeOrchestrator(
  deps: ProbeOrchestratorDeps,
): ProbeOrchestrator {
  const random01 = deps.random01 ?? Math.random
  const inflight = Effect.runSync(
    Ref.make(Option.none<Deferred.Deferred<ProbeOutcome>>()),
  )

  const probeNow: ProbeOrchestrator['probeNow'] = (options) =>
    Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        const existing = yield* Ref.get(inflight)
        if (Option.isSome(existing)) {
          return yield* restore(Deferred.await(existing.value))
        }
        const deferred = yield* Deferred.make<ProbeOutcome>()
        yield* Ref.set(inflight, Option.some(deferred))
        const outcome = yield* restore(
          Effect.exit(deps.probe.probeOnce(options)),
        )
        yield* Ref.set(inflight, Option.none())
        yield* Deferred.done(deferred, outcome)
        if (Exit.isSuccess(outcome)) {
          yield* deps.reportProbe(outcome.value)
          return outcome.value
        }
        return yield* outcome
      }),
    )

  const probeThenVerify: ProbeOrchestrator['probeThenVerify'] = (options) =>
    Effect.gen(function* () {
      const outcome = yield* probeNow(options)
      if (outcome.outcome !== 'reachable') return outcome
      if (!deps.verifySession) return outcome
      const verification = yield* deps.verifySession(options)
      if (deps.reportSession) yield* deps.reportSession(verification)
      return outcome
    })

  const probeWithRecovery: ProbeOrchestrator['probeWithRecovery'] = (options) =>
    Effect.gen(function* () {
      const maxAttempts = options?.maxAttempts ?? PROBE_RECOVERY_ATTEMPTS
      let attempt = 0
      let outcome = yield* probeNow(options)
      while (outcome.outcome === 'unreachable' && attempt + 1 < maxAttempts) {
        yield* Effect.sleep(recoveryDelayMs(attempt, random01()))
        attempt += 1
        outcome = yield* probeNow(options)
      }
      return outcome
    })

  return { probeNow, probeThenVerify, probeWithRecovery }
}

/** Page-graph orchestrator: probe + status + session composed as a Layer. */
export const ProbeOrchestratorLive: Layer.Layer<
  ProbeOrchestrator,
  never,
  HealthProbe | AppStatusService | SessionService
> = Layer.effect(
  ProbeOrchestrator,
  Effect.gen(function* () {
    const probe = yield* HealthProbe
    const status = yield* AppStatusService
    const session = yield* SessionService
    return makeProbeOrchestrator({
      probe,
      reportProbe: (outcome) => status.reportProbe(outcome),
      verifySession: (options) => session.verify(options),
      reportSession: (verification) => status.reportSession(verification),
    })
  }),
)
