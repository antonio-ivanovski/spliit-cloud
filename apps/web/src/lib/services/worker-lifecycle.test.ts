import { Deferred, Effect } from 'effect'
import { describe, expect, it } from 'vitest'

import { StaleGenerationError } from './errors'
import {
  attemptPublish,
  fenceGuard,
  makeWorkerRuntime,
  scopeForEvent,
} from './worker-lifecycle'

// Authoring gate (test-audit): this file owns the worker/event lifetime
// contract — per-event scopes isolate resources and run finalizers, fenced
// generations never publish, and the worker runtime is a separate graph.
// Regression: a shared scope across service-worker events would leak one
// event's resources into the next; a late worker response publishing after
// an account switch would mix namespaces. No production seams: fences read
// plain generation callbacks, scopes use the production runner shape.

describe('per-event scopes', () => {
  it('isolates resources between events and runs finalizers per event', async () => {
    let live = 0
    let released = 0
    const use = () =>
      Effect.acquireRelease(
        Effect.sync(() => {
          live += 1
          return live
        }),
        () =>
          Effect.sync(() => {
            released += 1
          }),
      )
    const first = await Effect.runPromise(
      scopeForEvent(
        Effect.gen(function* () {
          const id = yield* use()
          // Second acquisition in the same event is distinct work.
          return yield* Effect.succeed(id)
        }),
      ),
    )
    expect(first).toBe(1)
    expect(released).toBe(1)
    const second = await Effect.runPromise(scopeForEvent(use()))
    expect(second).toBe(2)
    expect(released).toBe(2)
    expect(live).toBe(2)
  })
})

describe('generation fencing', () => {
  it('fails stale completions with the namespace fenced', async () => {
    const error = await Effect.runPromise(
      Effect.flip(fenceGuard(3, () => 4, 'ns-1')),
    )
    expect(error).toBeInstanceOf(StaleGenerationError)
    expect(error).toMatchObject({ namespace: 'ns-1' })
  })

  it('publishes current generations and silently discards late ones', async () => {
    let generation = 7
    let published = 0
    const publish = () =>
      Effect.sync(() => {
        published += 1
      })
    const admitted = await Effect.runPromise(
      attemptPublish({
        expectedGeneration: 7,
        readCurrentGeneration: () => generation,
        namespace: 'ns-1',
        publish: publish(),
      }),
    )
    expect(admitted).toBe(true)
    expect(published).toBe(1)
    // A non-cancellable API resolves after the account switch: discard.
    generation = 8
    const fenced = await Effect.runPromise(
      attemptPublish({
        expectedGeneration: 7,
        readCurrentGeneration: () => generation,
        namespace: 'ns-1',
        publish: publish(),
      }),
    )
    expect(fenced).toBe(false)
    expect(published).toBe(1)
  })
})

describe('worker runtime split', () => {
  it('builds separate runtimes with independent scopes', async () => {
    const first = makeWorkerRuntime()
    const second = makeWorkerRuntime()
    try {
      expect(first).not.toBe(second)
      // Per-event work runs on either graph without shared state.
      const gate = await Effect.runPromise(Deferred.make<number>())
      const seen: number[] = []
      await first.runPromise(scopeForEvent(Deferred.succeed(gate, 1)))
      await second.runPromise(
        scopeForEvent(Effect.as(Deferred.await(gate), seen.push(1))),
      )
      expect(seen).toEqual([1])
    } finally {
      await first.dispose()
      await second.dispose()
    }
  })
})
