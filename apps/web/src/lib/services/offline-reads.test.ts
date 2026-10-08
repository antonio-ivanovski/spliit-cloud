import { Cause, Effect, Exit, Fiber } from 'effect'
import { describe, expect, it } from 'vitest'

import {
  OFFLINE_WORKER_REQUEST_TIMEOUT_MS,
  OfflineWorkerUnavailableError,
  type OfflineQueryClient,
  type OfflineWorkerRequest,
} from '@/lib/offline/query-worker'

import type { TimeoutError } from './errors'
import {
  makeOfflineReads,
  mapReadError,
  type OfflineReadsDeps,
} from './offline-reads'

// Authoring gate (test-audit): this file owns the worker read boundary —
// timeouts fail TimeoutError (never hang), generation moves fence late
// results, caller aborts interrupt without publishing, and worker absence
// rejects as CapabilityError instead of silently running heavy filtering on
// the main thread. Regression: an unfenced late result would render
// another account's data; a missing-worker silent fallback would jank the
// main thread on every query; an abort reported as a tag would paint error
// UI on navigation. Timeout values and pending-settlement inside the client
// are owned by query-worker.test.ts; this file owns the Effect policy
// around them. The stub client is the production createClient parameter.

const NAMESPACE = '["http://localhost:3001","reads-service-test"]'

type RequestInput = Omit<OfflineWorkerRequest, 'requestId'> & {
  requestId?: string
}

function baseRequest(generation = 0): RequestInput {
  return { namespace: NAMESPACE, generation, kind: 'overview' }
}

function stubClient(
  overrides?: Partial<OfflineQueryClient>,
): OfflineQueryClient & {
  calls: { query: number; fallback: number; discarded: number[] }
  recreated: () => boolean
  disposed: () => boolean
} {
  const calls = { query: 0, fallback: 0, discarded: [] as number[] }
  let recreated = false
  let disposed = false
  const client = {
    query: () => {
      calls.query += 1
      return Promise.resolve({ rows: [], totalFiltered: 0 })
    },
    discardGeneration: (generation: number) => {
      calls.discarded.push(generation)
    },
    dispose: () => {
      disposed = true
    },
    fallback: () => {
      calls.fallback += 1
      return Promise.resolve({ rows: [], totalFiltered: 0 })
    },
    recreate: () => {
      recreated = true
    },
    recreateIfFailed: () => {
      recreated = true
    },
    ...overrides,
  } as unknown as OfflineQueryClient & {
    calls: typeof calls
    recreated: () => boolean
    disposed: () => boolean
  }
  client.calls = calls
  client.recreated = () => recreated
  client.disposed = () => disposed
  return client
}

function readsWith(
  client: OfflineQueryClient,
  deps?: Partial<OfflineReadsDeps>,
) {
  return makeOfflineReads({ createClient: () => client, ...deps })
}

describe('read error mapping', () => {
  it('maps worker rejections to tags and aborts to interruption', () => {
    expect(mapReadError(new DOMException('Aborted', 'AbortError'))).toBe(null)
    const timeout = mapReadError(
      new DOMException('offline query timed out', 'TimeoutError'),
    )
    expect(timeout?._tag).toBe('TimeoutError')
    expect(
      mapReadError(new OfflineWorkerUnavailableError('no worker'))?._tag,
    ).toBe('CapabilityError')
    expect(mapReadError(new Error('worker exploded'))?._tag).toBe('WorkerError')
  })
})

describe('worker query policy', () => {
  it('passes the request through and returns the result', async () => {
    const client = stubClient()
    const seen: OfflineWorkerRequest[] = []
    const recording = stubClient({
      query: ((request: OfflineWorkerRequest) => {
        seen.push(request)
        return Promise.resolve({ rows: [1], totalFiltered: 1 })
      }) as OfflineQueryClient['query'],
    })
    const reads = readsWith(recording)
    const result = await Effect.runPromise(reads.query(baseRequest()))
    expect(result).toEqual({ rows: [1], totalFiltered: 1 })
    expect(seen.length).toBe(1)
    expect(typeof seen[0]!.requestId).toBe('string')
    expect(seen[0]!.requestId.length).toBeGreaterThan(0)
    expect(seen[0]!.namespace).toBe(NAMESPACE)
    expect(client.calls.query).toBe(0)
  })

  it('fails TimeoutError when the worker outlasts the bound', async () => {
    const hanging = stubClient({
      query: (() => new Promise(() => {})) as OfflineQueryClient['query'],
    })
    const reads = readsWith(hanging)
    const error = await Effect.runPromise(
      Effect.flip(reads.query(baseRequest(), { timeoutMs: 30 })),
    )
    expect(error._tag).toBe('TimeoutError')
    expect((error as TimeoutError).timeoutMs).toBe(30)
  })

  it('uses the 30s worker default when no bound is given', () => {
    expect(OFFLINE_WORKER_REQUEST_TIMEOUT_MS).toBe(30_000)
    const timeout = mapReadError(
      new DOMException('offline query timed out', 'TimeoutError'),
    ) as TimeoutError | null
    expect(timeout?.timeoutMs).toBe(OFFLINE_WORKER_REQUEST_TIMEOUT_MS)
  })

  it('fences results when the generation moved before delivery', async () => {
    const client = stubClient()
    let generation = 0
    const reads = readsWith(client, { readGeneration: () => generation })
    generation = 1
    const error = await Effect.runPromise(
      Effect.flip(reads.query(baseRequest(0))),
    )
    expect(error._tag).toBe('StaleGenerationError')
  })

  it('fenceToGeneration moves the fence and settles the worker pending set', async () => {
    const client = stubClient()
    const reads = readsWith(client)
    await Effect.runPromise(reads.fenceToGeneration(2))
    expect(client.calls.discarded).toEqual([2])
    const error = await Effect.runPromise(
      Effect.flip(reads.query(baseRequest(0))),
    )
    expect(error._tag).toBe('StaleGenerationError')
  })

  it('interrupts a pre-aborted query without touching the worker', async () => {
    const client = stubClient()
    const reads = readsWith(client)
    const controller = new AbortController()
    controller.abort()
    const exit = await Effect.runPromiseExit(
      reads.query(baseRequest(), { signal: controller.signal }),
    )
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      expect(Cause.hasInterrupts(exit.cause)).toBe(true)
    }
    expect(client.calls.query).toBe(0)
  })

  it('interrupts a mid-flight query when the caller aborts', async () => {
    const abortable = stubClient({
      query: ((
        _request: OfflineWorkerRequest,
        options?: { signal?: AbortSignal },
      ) =>
        new Promise((_resolve, reject) => {
          options?.signal?.addEventListener(
            'abort',
            () => reject(new DOMException('Aborted', 'AbortError')),
            { once: true },
          )
        })) as OfflineQueryClient['query'],
    })
    const reads = readsWith(abortable)
    const controller = new AbortController()
    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const fiber = yield* Effect.forkChild(
          reads.query(baseRequest(), { signal: controller.signal }),
        )
        yield* Effect.sleep(5)
        controller.abort()
        return yield* Fiber.join(fiber)
      }),
    )
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      expect(Cause.hasInterrupts(exit.cause)).toBe(true)
    }
  })

  it('rejects missing workers as CapabilityError, never silent fallback', async () => {
    const missing = stubClient({
      query: (() =>
        Promise.reject(
          new OfflineWorkerUnavailableError('offline worker failed'),
        )) as OfflineQueryClient['query'],
    })
    const reads = readsWith(missing)
    const error = await Effect.runPromise(
      Effect.flip(reads.query(baseRequest())),
    )
    expect(error._tag).toBe('CapabilityError')
    expect(missing.calls.fallback).toBe(0)
  })

  it('runs the explicit chunked fallback only on demand', async () => {
    let fallbackCalls = 0
    const client = stubClient({
      fallback: (() => {
        fallbackCalls += 1
        return Promise.resolve({ rows: [7], totalFiltered: 1 })
      }) as OfflineQueryClient['fallback'],
    })
    const reads = readsWith(client)
    const result = await Effect.runPromise(reads.queryFallback(baseRequest()))
    expect(result).toEqual({ rows: [7], totalFiltered: 1 })
    expect(fallbackCalls).toBe(1)
    expect(client.calls.query).toBe(0)
  })

  it('recreates once after failure and terminates on dispose', async () => {
    const client = stubClient()
    const reads = readsWith(client)
    await Effect.runPromise(reads.recreateAfterFailure)
    expect(client.recreated()).toBe(true)
    await Effect.runPromise(reads.dispose)
    expect(client.disposed()).toBe(true)
  })
})
