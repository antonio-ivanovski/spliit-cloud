import { Cause, Deferred, Effect, Exit, Fiber } from 'effect'
import { TestClock } from 'effect/testing'
import { describe, expect, it } from 'vitest'

import type { ProbeOutcome } from './health'
import {
  makeProbeOrchestrator,
  type ProbeOrchestratorDeps,
} from './probe-orchestrator'

// Authoring gate (test-audit): this file owns the orchestration contract —
// concurrent triggers coalesce into one probe, interruptions publish
// nothing, recovery follows the visible backoff, and verification chains
// only after reachability. Regression: stacked probes would multiply
// liveness traffic on every reconnect; an interrupted probe reported as
// unreachable would paint offline UI on navigation; verification after an
// unreachable probe would waste the 8s bound. Outcome validation and
// backoff values are owned by health.test.ts; this file owns the driver
// around them. TestClock (effect/testing) is the sanctioned time seam.

const REACHABLE: ProbeOutcome = { outcome: 'reachable' }
const UNREACHABLE: ProbeOutcome = { outcome: 'unreachable' }

function harness(
  overrides?: Partial<ProbeOrchestratorDeps> & { outcomes?: ProbeOutcome[] },
) {
  const calls: unknown[] = []
  const reports: ProbeOutcome[] = []
  const outcomes = [...(overrides?.outcomes ?? [REACHABLE])]
  const probe = {
    probeOnce: () => {
      calls.push(true)
      const next = outcomes.shift() ?? REACHABLE
      return Effect.succeed(next)
    },
  }
  const orchestrator = makeProbeOrchestrator({
    probe,
    reportProbe: (outcome) =>
      Effect.sync(() => {
        reports.push(outcome)
      }),
    ...overrides,
  })
  return { orchestrator, calls, reports }
}

describe('single-flight probing', () => {
  it('coalesces concurrent triggers into one underlying probe', async () => {
    const gate = await Effect.runPromise(Deferred.make<ProbeOutcome>())
    let calls = 0
    const reports: ProbeOutcome[] = []
    const orchestrator = makeProbeOrchestrator({
      probe: {
        probeOnce: () => {
          calls += 1
          return Effect.as(Deferred.await(gate), REACHABLE)
        },
      },
      reportProbe: (outcome) =>
        Effect.sync(() => {
          reports.push(outcome)
        }),
    })
    const program = Effect.gen(function* () {
      const first = yield* Effect.forkChild(orchestrator.probeNow())
      const second = yield* Effect.forkChild(orchestrator.probeNow())
      yield* Effect.sleep(10)
      yield* Deferred.succeed(gate, REACHABLE)
      const a = yield* Fiber.join(first)
      const b = yield* Fiber.join(second)
      return [a, b] as const
    })
    const [a, b] = await Effect.runPromise(program)
    expect(a).toEqual(REACHABLE)
    expect(b).toEqual(REACHABLE)
    expect(calls).toBe(1)
    // One runner reported once; both triggers shared it.
    expect(reports).toEqual([REACHABLE])
  })

  it('propagates caller interruption without publishing an outcome', async () => {
    const { orchestrator, reports } = harness({
      probe: {
        probeOnce: () => Effect.interrupt,
      },
    })
    const exit = await Effect.runPromiseExit(orchestrator.probeNow())
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      expect(Cause.hasInterrupts(exit.cause)).toBe(true)
    }
    expect(reports).toEqual([])
  })
})

describe('bounded recovery', () => {
  it('retries unreachable probes on the visible backoff via TestClock', async () => {
    const { orchestrator, calls } = harness({
      outcomes: [UNREACHABLE, REACHABLE],
      random01: () => 0,
    })
    const program = Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(
        orchestrator.probeWithRecovery({ maxAttempts: 2 }),
      )
      // First attempt fails fast; the 5s backoff needs the clock advanced.
      yield* TestClock.adjust('6 seconds')
      return yield* Fiber.join(fiber)
    }).pipe(Effect.provide(TestClock.layer()))
    const outcome = await Effect.runPromise(program)
    expect(outcome).toEqual(REACHABLE)
    expect(calls.length).toBe(2)
  })
})

describe('verify chaining', () => {
  it('verifies only after a reachable probe and reports the verdict', async () => {
    const verifications: unknown[] = []
    const sessions: unknown[] = []
    const reachable = makeProbeOrchestrator({
      probe: { probeOnce: () => Effect.succeed(REACHABLE) },
      reportProbe: () => Effect.void,
      verifySession: () =>
        Effect.succeed({ verdict: 'verified', account: { id: 'a' } } as const),
      reportSession: (verification) =>
        Effect.sync(() => {
          sessions.push(verification)
        }),
    })
    const outcome = await Effect.runPromise(reachable.probeThenVerify())
    expect(outcome).toEqual(REACHABLE)
    expect(sessions.length).toBe(1)

    let verified = 0
    const unreachable = makeProbeOrchestrator({
      probe: { probeOnce: () => Effect.succeed(UNREACHABLE) },
      reportProbe: () => Effect.void,
      verifySession: () => {
        verified += 1
        return Effect.succeed({
          verdict: 'preserved-unavailable',
          account: null,
        } as const)
      },
    })
    const missed = await Effect.runPromise(unreachable.probeThenVerify())
    expect(missed).toEqual(UNREACHABLE)
    expect(verified).toBe(0)
    expect(verifications.length).toBe(0)
  })
})
