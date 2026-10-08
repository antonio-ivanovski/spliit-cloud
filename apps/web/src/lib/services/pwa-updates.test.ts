import { Deferred, Effect, Fiber } from 'effect'
import { TestClock } from 'effect/testing'
import { describe, expect, it } from 'vitest'

import type { PwaUpdateManager } from '@/lib/pwa-update-manager'

import { makePwaUpdateService, type PwaUpdateServiceDeps } from './pwa-updates'

// Authoring gate (test-audit): this file owns the update-check driver —
// concurrent triggers share one underlying registration.update, hourly ticks
// skip hidden documents without queueing, retry/dismiss delegate to the owned
// manager, and disposal releases manager listeners. Regression: uncoalesced
// foreground+reconnect triggers would double registration.update traffic;
// hourly checks while hidden would wake the radio for a deferred reload; a
// leaked manager subscription would keep reconciling after page teardown.
// The 30s-idle / prepare-confirm / reload-bound policies inside the manager
// are owned by pwa-update-manager.test.ts; this file owns the Effect driver
// around it. The stub manager/check probe are the production constructor
// parameters. Time uses effect/testing TestClock, the sanctioned seam.

function stubManager(): PwaUpdateManager & {
  retried: () => boolean
  dismissed: () => boolean
  disposed: () => boolean
} {
  let retried = false
  let dismissed = false
  let disposed = false
  const listeners = new Set<() => void>()
  const manager = {
    getSnapshot: () => ({ status: 'hidden' as const }),
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    retry: () => {
      retried = true
    },
    dismissFailure: () => {
      dismissed = true
    },
    dispose: () => {
      disposed = true
      listeners.clear()
    },
    retried: () => retried,
    dismissed: () => dismissed,
    disposed: () => disposed,
  }
  return manager
}

function harness(overrides?: Partial<PwaUpdateServiceDeps>) {
  const checks: string[] = []
  let visible = true
  const service = makePwaUpdateService({
    createManager: () => stubManager(),
    checkForUpdate: () => {
      checks.push('check')
      return Promise.resolve(null)
    },
    checkIntervalMs: 60 * 60 * 1000,
    now: () => 1_000,
    isVisible: () => visible,
    ...overrides,
  })
  return {
    service,
    checks,
    setVisible: (next: boolean) => {
      visible = next
    },
  }
}

describe('coalesced update checks', () => {
  it('shares one underlying check across concurrent triggers', async () => {
    const gate = await Effect.runPromise(Deferred.make<unknown>())
    let calls = 0
    const { service } = harness({
      checkForUpdate: () => {
        calls += 1
        return Effect.runPromise(Deferred.await(gate)).then(() => null)
      },
    })
    const program = Effect.gen(function* () {
      const first = yield* Effect.forkChild(service.checkNow('foreground'))
      const second = yield* Effect.forkChild(service.checkNow('reconnect'))
      yield* Effect.sleep(10)
      yield* Deferred.succeed(gate, null)
      yield* Fiber.join(first)
      yield* Fiber.join(second)
      return yield* service.snapshot
    })
    // Real clock here: the 10ms rendezvous sleep must elapse without a
    // manual TestClock adjust (both forks must reach the gate first).
    const snapshot = await Effect.runPromise(program)
    expect(calls).toBe(1)
    expect(snapshot.check.checks).toBe(1)
    expect(snapshot.check.inFlight).toBe(false)
    expect(snapshot.check.lastCheckAt).toBe(1_000)
    await Effect.runPromise(service.dispose)
  })

  it('settles the gate silently when the probe rejects', async () => {
    const { service } = harness({
      checkForUpdate: () => Promise.reject(new Error('radio off')),
    })
    await Effect.runPromise(service.checkNow('manual'))
    const snapshot = await Effect.runPromise(service.snapshot)
    // Opportunistic check: no failure in the snapshot, gate released.
    expect(snapshot.check.inFlight).toBe(false)
    expect(snapshot.check.checks).toBe(0)
    expect(snapshot.check.lastCheckAt).toBe(null)
    await Effect.runPromise(service.dispose)
  })
})

describe('hourly visible checks', () => {
  it('checks once per visible hour and skips hidden ticks', async () => {
    const { service, checks, setVisible } = harness()
    const program = Effect.gen(function* () {
      yield* service.start
      yield* TestClock.adjust('1 hour')
      yield* TestClock.adjust('1 hour')
      setVisible(false)
      yield* TestClock.adjust('1 hour')
      setVisible(true)
      yield* TestClock.adjust('1 hour')
      yield* service.stop
      return checks.length
    })
    const total = await Effect.runPromise(
      program.pipe(Effect.provide(TestClock.layer())),
    )
    // Two visible hours checked; the hidden hour skipped without queueing
    // (no catch-up burst when visible again: exactly one more check).
    expect(total).toBe(3)
    await Effect.runPromise(service.dispose)
  })

  it('stops checking after stop', async () => {
    const { service, checks } = harness()
    const program = Effect.gen(function* () {
      yield* service.start
      yield* TestClock.adjust('1 hour')
      yield* service.stop
      yield* TestClock.adjust('5 hours')
      return checks.length
    })
    const total = await Effect.runPromise(
      program.pipe(Effect.provide(TestClock.layer())),
    )
    expect(total).toBe(1)
    await Effect.runPromise(service.dispose)
  })
})

describe('manager commands', () => {
  it('delegates retry and dismiss to the owned manager', async () => {
    const manager = stubManager()
    const service = makePwaUpdateService({
      createManager: () => manager,
      checkForUpdate: () => Promise.resolve(null),
    })
    await Effect.runPromise(service.retry)
    await Effect.runPromise(service.dismissFailure)
    expect(manager.retried()).toBe(true)
    expect(manager.dismissed()).toBe(true)
    await Effect.runPromise(service.dispose)
    expect(manager.disposed()).toBe(true)
  })
})
