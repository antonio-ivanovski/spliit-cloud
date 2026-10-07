import { Deferred, Effect, Fiber } from 'effect'
import { describe, expect, it } from 'vitest'

import {
  makePreferencesSync,
  type PreferencesSyncDeps,
} from './preferences-sync'

// Authoring gate (test-audit): this file owns the preferences pipeline —
// patches serialize in call order, remote failures roll back to confirmed
// plus still-pending patches, account switches fence late completions, and
// offline choices stay local with no remote queue. Regression: concurrent
// theme+locale writes racing would confirm out of order; an unfenced late
// confirmation would render another account's preferences; an offline patch
// queued durably would violate read-only offline. Optimistic merge math is
// trivial spread order owned here; server validation stays owned by the
// tRPC boundary tests. The injected pushPatch is the production boundary.

function harness(overrides?: Partial<PreferencesSyncDeps>) {
  const calls: unknown[] = []
  let online = true
  let generation = 7
  let failNext: Error | null = null
  const service = makePreferencesSync({
    pushPatch: (patch) => {
      calls.push({ ...patch })
      if (failNext) {
        const error = failNext
        failNext = null
        return Promise.reject(error)
      }
      return Promise.resolve({ theme: 'dark', locale: 'en-US', ...patch })
    },
    applyLocal: () => undefined,
    onConfirmed: () => undefined,
    canPush: () => online,
    readGeneration: () => generation,
    now: () => 5_000,
    ...overrides,
  })
  return {
    service,
    calls,
    setOnline: (next: boolean) => {
      online = next
    },
    setGeneration: (next: number) => {
      generation = next
    },
    failNextWith: (error: Error) => {
      failNext = error
    },
  }
}

const SEEDED = { theme: 'light', locale: 'en-US' }

describe('serialized patches', () => {
  it('writes in call order with one confirmation each', async () => {
    const { service, calls } = harness()
    await Effect.runPromise(service.seedConfirmed(SEEDED, 7))
    const first = await Effect.runPromise(service.patch({ theme: 'dark' }))
    const second = await Effect.runPromise(service.patch({ locale: 'de-DE' }))
    expect(first).toEqual({ saved: true })
    expect(second).toEqual({ saved: true })
    expect(calls).toEqual([{ theme: 'dark' }, { locale: 'de-DE' }])
    const snapshot = await Effect.runPromise(service.snapshot)
    expect(snapshot.confirmed).toMatchObject({ theme: 'dark', locale: 'de-DE' })
    expect(snapshot.pending).toBe(0)
    expect(snapshot.isUpdating).toBe(false)
  })

  it('rolls back a failed patch to confirmed plus still-pending work', async () => {
    const { service, failNextWith } = harness()
    await Effect.runPromise(service.seedConfirmed(SEEDED, 7))
    failNextWith(new Error('server down'))
    const result = await Effect.runPromise(service.patch({ theme: 'dark' }))
    expect(result).toEqual({ saved: false, reason: 'remote-error' })
    const snapshot = await Effect.runPromise(service.snapshot)
    expect(snapshot.optimistic).toEqual(SEEDED)
    expect(snapshot.confirmed).toEqual(SEEDED)
    expect(snapshot.pending).toBe(0)
    expect(snapshot.lastErrorAt).toBe(5_000)
  })
})

describe('stale-account fencing', () => {
  it('drops a late confirmation after the account switches', async () => {
    const gate = await Effect.runPromise(
      Deferred.make<Record<string, unknown>>(),
    )
    const { service, setGeneration } = harness({
      pushPatch: () => Effect.runPromise(Deferred.await(gate)),
    })
    await Effect.runPromise(service.seedConfirmed(SEEDED, 7))
    const program = Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(service.patch({ theme: 'dark' }))
      // Real rendezvous sleep: let the patch reach the remote call first.
      yield* Effect.sleep(10)
      setGeneration(8)
      yield* Deferred.succeed(gate, { theme: 'dark' })
      return yield* Fiber.join(fiber)
    })
    const result = await Effect.runPromise(program)
    expect(result).toEqual({ saved: false, reason: 'stale-account' })
    const snapshot = await Effect.runPromise(service.snapshot)
    // The late confirmation never lands (the pre-switch optimistic value is
    // cleared by the scope switch re-seed, owned by Task 8 wiring).
    expect(snapshot.confirmed).toEqual(SEEDED)
    expect(snapshot.pending).toBe(0)
  })
})

describe('offline and init', () => {
  it('keeps offline theme choices local without queueing remote work', async () => {
    const applied: unknown[] = []
    const { service, calls, setOnline } = harness({
      applyLocal: (patch) => {
        applied.push(patch)
      },
    })
    await Effect.runPromise(service.seedConfirmed(SEEDED, 7))
    setOnline(false)
    const result = await Effect.runPromise(service.patch({ theme: 'dark' }))
    expect(result).toEqual({ saved: false, reason: 'offline' })
    expect(calls).toEqual([])
    expect(applied).toEqual([{ theme: 'dark' }])
    const snapshot = await Effect.runPromise(service.snapshot)
    expect(snapshot.confirmed).toEqual(SEEDED)
    expect(snapshot.pending).toBe(0)
  })

  it('never bootstraps while offline', async () => {
    const { service, calls, setOnline } = harness()
    await Effect.runPromise(service.seedConfirmed(SEEDED, 7))
    setOnline(false)
    const result = await Effect.runPromise(
      service.initialize({ timeZone: 'Europe/Berlin' }),
    )
    expect(result).toEqual({ saved: false, reason: 'offline' })
    expect(calls).toEqual([])
  })
})
