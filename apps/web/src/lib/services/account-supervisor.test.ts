import { Cause, Effect, Exit, Fiber } from 'effect'
import { describe, expect, it } from 'vitest'

import {
  INITIAL_SUPERVISOR,
  isCurrentGeneration,
  makeAccountSupervisor,
  reduceSupervisorEvent,
  type AccountIdentity,
} from './account-supervisor'

// Authoring gate (test-audit): this file owns the account-lifetime contract —
// old identity clears synchronously before async cleanup, late completions
// are fenced by generation, failed cleanup stays visible and never mounts
// the new scope, and tracked fibers die on switch. Regression: a switch
// that published the old account after verification, or mounted a new scope
// over failed cleanup, would leak cross-account data. The lifecycle module
// tests durable fencing; this file owns the supervisor ordering around it.
// No production seams: deps are the production close/activate callbacks.

const A: AccountIdentity = { accountId: 'a', namespace: 'ns-a' }
const B: AccountIdentity = { accountId: 'b', namespace: 'ns-b' }
const C: AccountIdentity = { accountId: 'c', namespace: 'ns-c' }

describe('supervisor reducer', () => {
  it('clears the old identity and fences the generation on switch', () => {
    const live = { ...INITIAL_SUPERVISOR, current: A }
    const next = reduceSupervisorEvent(live, {
      _tag: 'SwitchRequested',
      next: B,
    })
    expect(next.current).toBeNull()
    expect(next.pending).toEqual(B)
    expect(next.status).toBe('switching')
    expect(next.generation).toBe(live.generation + 1)
  })

  it('ignores a switch to the already-active namespace', () => {
    const live = { ...INITIAL_SUPERVISOR, current: A }
    expect(
      reduceSupervisorEvent(live, { _tag: 'SwitchRequested', next: A }),
    ).toBe(live)
  })

  it('discards activations from a superseded generation', () => {
    const switching = reduceSupervisorEvent(
      { ...INITIAL_SUPERVISOR, current: A },
      { _tag: 'SwitchRequested', next: B },
    )
    const stale = reduceSupervisorEvent(switching, {
      _tag: 'NewActivated',
      identity: B,
      generation: switching.generation - 1,
    })
    expect(stale.current).toBeNull()
    expect(stale.status).toBe('switching')
    const fresh = reduceSupervisorEvent(switching, {
      _tag: 'NewActivated',
      identity: B,
      generation: switching.generation,
    })
    expect(fresh.current).toEqual(B)
    expect(fresh.status).toBe('idle')
  })

  it('represents failed cleanup visibly without mounting the new scope', () => {
    const switching = reduceSupervisorEvent(
      { ...INITIAL_SUPERVISOR, current: A },
      { _tag: 'SwitchRequested', next: B },
    )
    const failed = reduceSupervisorEvent(switching, {
      _tag: 'CleanupFailed',
      reason: 'disk-error',
    })
    expect(failed.status).toBe('failed')
    expect(failed.current).toBeNull()
    expect(failed.cleanupError).toBe('disk-error')
    expect(failed.failedFor).toEqual(B)
    expect(isCurrentGeneration(failed, failed.generation)).toBe(true)
  })
})

describe('supervisor service', () => {
  it('invalidates the old identity before async cleanup resolves', async () => {
    let releaseCleanup!: () => void
    const gate = new Promise<void>((resolve) => {
      releaseCleanup = resolve
    })
    const seen: Array<string | null> = []
    const supervisor = makeAccountSupervisor({
      initial: { ...INITIAL_SUPERVISOR, current: A },
      closeOldScope: () => gate,
      onInvalidatedSync: (snapshot) => {
        seen.push(snapshot.current?.namespace ?? null)
      },
    })
    const fiber = Effect.runFork(supervisor.requestSwitch(B))
    // Let the uninterruptible publish run while cleanup stays gated.
    await Effect.runPromise(Effect.sleep(10))
    const mid = supervisor.bridge.getSnapshot()
    expect(mid.current).toBeNull()
    expect(mid.status).toBe('switching')
    expect(seen).toEqual([null])
    releaseCleanup()
    await Effect.runPromise(Fiber.join(fiber))
    const done = supervisor.bridge.getSnapshot()
    expect(done.current).toEqual(B)
    expect(done.status).toBe('idle')
  })

  it('interrupts tracked account tasks on switch', async () => {
    const supervisor = makeAccountSupervisor({
      initial: { ...INITIAL_SUPERVISOR, current: A },
      closeOldScope: () => Promise.resolve(),
    })
    const taskFiber = await Effect.runPromise(
      supervisor.forkAccountTask(Effect.never),
    )
    await Effect.runPromise(supervisor.requestSwitch(B))
    const exit = await Effect.runPromiseExit(Fiber.join(taskFiber))
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      expect(Cause.hasInterrupts(exit.cause)).toBe(true)
    }
    expect(supervisor.bridge.getSnapshot().current).toEqual(B)
  })

  it('discards a superseded switch instead of publishing its account', async () => {
    let releaseFirst!: () => void
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const published: Array<string | null> = []
    const supervisor = makeAccountSupervisor({
      initial: { ...INITIAL_SUPERVISOR, current: A },
      closeOldScope: (old) =>
        old.namespace === 'ns-a' ? firstGate : Promise.resolve(),
    })
    const unsubscribe = supervisor.bridge.subscribe(() => {
      const current = supervisor.bridge.getSnapshot().current
      published.push(current?.namespace ?? null)
    })
    try {
      const first = Effect.runFork(supervisor.requestSwitch(B))
      await Effect.runPromise(Effect.sleep(10))
      // Supersede while the first cleanup is still gated.
      await Effect.runPromise(supervisor.requestSwitch(C))
      releaseFirst()
      await Effect.runPromise(Fiber.join(first))
      await Effect.runPromise(Effect.sleep(10))
      const done = supervisor.bridge.getSnapshot()
      expect(done.current).toEqual(C)
      // The superseded account B never became visible.
      expect(published.filter((namespace) => namespace === 'ns-b').length).toBe(
        0,
      )
    } finally {
      unsubscribe()
    }
  })

  it('keeps failed cleanup visible and recovers through retry', async () => {
    let attempts = 0
    const supervisor = makeAccountSupervisor({
      initial: { ...INITIAL_SUPERVISOR, current: A },
      closeOldScope: () => {
        attempts += 1
        return attempts === 1
          ? Promise.reject(new Error('disk-error'))
          : Promise.resolve()
      },
    })
    await Effect.runPromise(supervisor.requestSwitch(B))
    const failed = supervisor.bridge.getSnapshot()
    expect(failed.status).toBe('failed')
    expect(failed.current).toBeNull()
    expect(failed.cleanupError).toBe('disk-error')
    const recovered = await Effect.runPromise(supervisor.retryCleanup(B))
    expect(recovered).toBe(true)
    const done = supervisor.bridge.getSnapshot()
    expect(done.status).toBe('idle')
    expect(done.current).toEqual(B)
    expect(done.cleanupError).toBeNull()
  })
})
