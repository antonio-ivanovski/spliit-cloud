import { Deferred, Effect, Fiber } from 'effect'
import { TestClock } from 'effect/testing'
import { describe, expect, it, vi } from 'vitest'

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
    checkForUpdate: async () => {},
    updateNow: () => {},
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
    expect(snapshot.check.lastCheckAt).not.toBeNull()
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

describe('periodic visible checks', () => {
  it('checks on startup and each visible interval, skipping hidden ticks', async () => {
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
    expect(total).toBe(4)
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
    expect(total).toBe(2)
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

it('checks on startup and browser resume, then removes browser listeners on disposal', async () => {
  const doc = new EventTarget()
  Object.assign(doc, { visibilityState: 'visible' })
  const win = new EventTarget()
  vi.stubGlobal('document', doc)
  vi.stubGlobal('window', win)
  const probe = vi.fn(async () => undefined)
  const service = makePwaUpdateService({
    createManager: stubManager,
    checkForUpdate: probe,
    now: () => Date.now(),
  })
  try {
    await Effect.runPromise(service.start)
    await vi.waitFor(() => expect(probe).toHaveBeenCalledOnce())
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 31_000)
    doc.dispatchEvent(new Event('visibilitychange'))
    win.dispatchEvent(new Event('focus'))
    win.dispatchEvent(new Event('pageshow'))
    await vi.waitFor(() => expect(probe).toHaveBeenCalledTimes(2))
    await Effect.runPromise(service.dispose)
    win.dispatchEvent(new Event('online'))
    await Promise.resolve()
    expect(probe).toHaveBeenCalledTimes(2)
  } finally {
    await Effect.runPromise(service.dispose)
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  }
})

it('uses build hints to bypass cooldown and falls back to native checks when hints fail', async () => {
  let time = 0
  const probe = vi.fn(async () => undefined)
  const hint = vi.fn(
    async () => null as { buildId: string; version: string } | null,
  )
  const { service } = harness({
    now: () => time,
    checkForUpdate: probe,
    fetchBuildInfo: hint,
  })
  try {
    await Effect.runPromise(service.checkNow('startup'))
    await Effect.runPromise(service.checkNow('foreground'))
    expect(probe).toHaveBeenCalledOnce()
    hint.mockResolvedValue({ buildId: 'new-deployment', version: 'v2.11.0' })
    await Effect.runPromise(service.checkNow('foreground'))
    expect(probe).toHaveBeenCalledTimes(2)
    hint.mockRejectedValue(new Error('version endpoint unavailable'))
    time = 31_000
    await Effect.runPromise(service.checkNow('foreground'))
    expect(probe).toHaveBeenCalledTimes(3)
    await Effect.runPromise(service.checkNow('manual'))
    expect(probe).toHaveBeenCalledTimes(4)
  } finally {
    await Effect.runPromise(service.dispose)
  }
})
