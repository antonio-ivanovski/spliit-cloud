import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'

import { getDefaultConnectivityStore } from '@/lib/offline/connectivity'

import { AppStatusService } from './app-status'
import { getPageRuntime } from './runtime'
import {
  createEffectFetch,
  EFFECT_BRIDGE_QUERY_DEFAULTS,
  probeOutcomeForFetchEvent,
  reportFetchOutcomeToLegacyStore,
  reportFetchOutcomeToServices,
  transportForFetchEvent,
  type FetchReportEvent,
} from './transport-integration'

// Authoring gate (test-audit): this file owns the SDK-boundary fetch
// contract — caller signals reach the underlying fetch, aborts never mark
// offline, genuine failures report once, and HTTP statuses resolve as
// Responses for SDK body reading. Regression: a signal dropped before fetch
// would make TanStack cancellation a no-op; an abort reported as
// unreachable would paint offline UI on navigation; a 5xx thrown instead
// of resolved would break tRPC error-body parsing. Classification itself
// is owned by transport.test.ts; this file owns the boundary behavior
// around it. The stub fetchFn is the production EffectFetchDeps parameter.

function stubFetch(
  handler: (input: string, init?: RequestInit) => Promise<Response>,
): typeof fetch {
  return ((input: string, init?: RequestInit) =>
    handler(input, init)) as typeof fetch
}

function events() {
  const seen: FetchReportEvent[] = []
  return {
    seen,
    report: (event: FetchReportEvent) => {
      seen.push(event)
    },
  }
}

function readAppStatus() {
  return getPageRuntime().runSync(
    Effect.gen(function* () {
      const service = yield* AppStatusService
      return yield* service.snapshot
    }),
  )
}

describe('effect fetch boundary', () => {
  it('resolves Responses and reports reachability', async () => {
    const collector = events()
    const fetchImpl = createEffectFetch({
      fetchFn: stubFetch(() =>
        Promise.resolve(new Response('{}', { status: 200 })),
      ),
      report: collector.report,
    })
    const response = await fetchImpl('https://api.example/trpc')
    expect(response.status).toBe(200)
    expect(collector.seen).toEqual([{ kind: 'response', status: 200 }])
  })

  it('resolves HTTP error statuses for SDK body reading', async () => {
    const collector = events()
    const fetchImpl = createEffectFetch({
      fetchFn: stubFetch(() =>
        Promise.resolve(new Response('error-body', { status: 503 })),
      ),
      report: collector.report,
    })
    const response = await fetchImpl('https://api.example/trpc')
    expect(response.status).toBe(503)
    expect(await response.text()).toBe('error-body')
    expect(collector.seen).toEqual([{ kind: 'response', status: 503 }])
  })

  it('throws the original error once on genuine network failure', async () => {
    const collector = events()
    const original = new TypeError('Failed to fetch')
    const fetchImpl = createEffectFetch({
      fetchFn: stubFetch(() => Promise.reject(original)),
      report: collector.report,
    })
    await expect(fetchImpl('https://api.example/trpc')).rejects.toBe(original)
    expect(collector.seen).toEqual([
      { kind: 'network-failure', error: original },
    ])
  })

  it('forwards the query signal and reports aborts without going offline', async () => {
    const collector = events()
    let observed: AbortSignal | null | undefined
    const fetchImpl = createEffectFetch({
      fetchFn: stubFetch(
        (_input, init) =>
          new Promise<Response>((_resolve, reject) => {
            observed = init?.signal as AbortSignal | null | undefined
            init?.signal?.addEventListener('abort', () => {
              reject(new DOMException('Aborted', 'AbortError'))
            })
          }),
      ),
      report: collector.report,
    })
    const controller = new AbortController()
    const pending = fetchImpl('https://api.example/trpc', {
      signal: controller.signal,
    })
    // The TanStack/query signal reaches the underlying fetch.
    expect(observed).toBeDefined()
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(collector.seen).toEqual([{ kind: 'aborted' }])
  })

  it('never calls fetch when the signal is already aborted', async () => {
    let calls = 0
    const fetchImpl = createEffectFetch({
      fetchFn: stubFetch(() => {
        calls += 1
        return Promise.resolve(new Response('{}', { status: 200 }))
      }),
    })
    await expect(
      fetchImpl('https://api.example/trpc', { signal: AbortSignal.abort() }),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(calls).toBe(0)
  })
})

describe('fetch outcome projection', () => {
  it('keeps server answers distinct from offline', () => {
    expect(
      probeOutcomeForFetchEvent({ kind: 'response', status: 200 }),
    ).toEqual({ outcome: 'reachable' })
    expect(
      probeOutcomeForFetchEvent({ kind: 'response', status: 503 }),
    ).toEqual({ outcome: 'server-failure', status: 503 })
    expect(
      probeOutcomeForFetchEvent({ kind: 'network-failure', error: null }),
    ).toEqual({ outcome: 'unreachable' })
    expect(probeOutcomeForFetchEvent({ kind: 'aborted' })).toBeNull()
  })

  it('projects transport state with aborts carrying no signal', () => {
    expect(transportForFetchEvent({ kind: 'aborted' })).toBeNull()
    expect(
      transportForFetchEvent({ kind: 'network-failure', error: null }),
    ).toBe('unreachable')
    expect(transportForFetchEvent({ kind: 'response', status: 200 })).toBe(
      'reachable',
    )
  })

  it('mirrors trackedFetch reporting to the legacy store', () => {
    // Parity probe: the real store accepts the same event shapes without
    // throwing outside a browser; the mapping is asserted above.
    expect(() =>
      reportFetchOutcomeToLegacyStore({ kind: 'aborted' }),
    ).not.toThrow()
    expect(EFFECT_BRIDGE_QUERY_DEFAULTS).toEqual({
      retry: 0,
      networkMode: 'always',
    })
  })

  it('projects one classification to both the legacy store and AppStatus', () => {
    // Task 8 unification: a single classification fans out to both
    // projections — no inline copies at call sites, no doubled reporting.
    getDefaultConnectivityStore().resetForTests()
    reportFetchOutcomeToServices({ kind: 'response', status: 503 })
    expect(getDefaultConnectivityStore().getSnapshot().serverFailure).toEqual({
      kind: 'http-error',
      status: 503,
      at: expect.any(Number),
    })
    expect(readAppStatus().serverFailure).toEqual({
      kind: 'http-error',
      status: 503,
      at: expect.any(Number),
    })
    // Recovery clears both legs together.
    reportFetchOutcomeToServices({ kind: 'response', status: 200 })
    expect(getDefaultConnectivityStore().getSnapshot().serverFailure).toBeNull()
    expect(readAppStatus().serverFailure).toBeNull()
    expect(readAppStatus().transport).toBe('reachable')
  })

  it('reports aborts to neither projection', () => {
    getDefaultConnectivityStore().resetForTests()
    reportFetchOutcomeToServices({ kind: 'response', status: 200 })
    const before = readAppStatus()
    reportFetchOutcomeToServices({ kind: 'aborted' })
    expect(readAppStatus()).toEqual(before)
    expect(getDefaultConnectivityStore().getSnapshot().transport).toBe(
      'reachable',
    )
  })
})
