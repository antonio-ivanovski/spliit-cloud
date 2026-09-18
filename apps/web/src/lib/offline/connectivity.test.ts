import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  buildHealthUrl,
  createConnectivityStore,
  isJsonContentType,
  isValidHealthPayload,
} from './connectivity'

function okJsonFetch() {
  return vi.fn(
    async () =>
      new Response(JSON.stringify({ status: 'ok' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
  ) as unknown as typeof fetch
}

describe('offline connectivity store', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('starts unknown and reports online until unreachable', () => {
    const store = createConnectivityStore({
      fetchFn: okJsonFetch(),
      isNavigatorOnline: () => true,
      isVisible: () => true,
    })
    expect(store.getSnapshot().transport).toBe('unknown')
    expect(store.isOnline()).toBe(true)
    store.dispose()
  })

  it('false-positive navigator.online still reports offline after network failure', () => {
    const store = createConnectivityStore({
      fetchFn: okJsonFetch(),
      isNavigatorOnline: () => true,
      isVisible: () => true,
    })
    // Browser claims online, but the API fetch genuinely failed.
    store.reportNetworkFailure(new TypeError('Failed to fetch'))
    expect(store.getSnapshot().transport).toBe('unreachable')
    expect(store.isOnline()).toBe(false)
    store.dispose()
  })

  it('distinguishes 503 (server response) from a network error', () => {
    const store = createConnectivityStore({
      fetchFn: okJsonFetch(),
      isNavigatorOnline: () => true,
      isVisible: () => true,
    })
    store.reportServerResponse(503)
    // Server answered: reachable transport with a distinct failure record.
    expect(store.getSnapshot().transport).toBe('reachable')
    expect(store.getSnapshot().serverFailure).toMatchObject({
      kind: 'http-error',
      status: 503,
    })
    expect(store.isOnline()).toBe(true)

    store.reportNetworkFailure(new TypeError('Failed to fetch'))
    expect(store.getSnapshot().transport).toBe('unreachable')
    expect(store.isOnline()).toBe(false)
    store.dispose()
  })

  it('ignores user aborts and non-network errors', () => {
    const store = createConnectivityStore({
      fetchFn: okJsonFetch(),
      isNavigatorOnline: () => true,
      isVisible: () => true,
    })
    store.reportNetworkFailure(new DOMException('Aborted', 'AbortError'))
    expect(store.getSnapshot().transport).toBe('unknown')
    store.reportNetworkFailure(new Error('UNAUTHORIZED'))
    expect(store.getSnapshot().transport).toBe('unknown')
    store.reportUserAbort()
    expect(store.getSnapshot().transport).toBe('unknown')
    store.dispose()
  })

  it('bounded timeout marks unreachable', () => {
    const store = createConnectivityStore({
      fetchFn: okJsonFetch(),
      isNavigatorOnline: () => true,
      isVisible: () => true,
    })
    store.reportTimeout()
    expect(store.getSnapshot().transport).toBe('unreachable')
    store.dispose()
  })

  it('recovers via explicit retry without an online event', async () => {
    const fetchFn = okJsonFetch()
    const store = createConnectivityStore({
      fetchFn,
      isNavigatorOnline: () => true,
      isVisible: () => true,
    })
    store.reportNetworkFailure(new TypeError('Failed to fetch'))
    expect(store.isOnline()).toBe(false)

    const pending = store.retryNow()
    await vi.runAllTimersAsync()
    await expect(pending).resolves.toBe(true)
    expect(store.getSnapshot().transport).toBe('reachable')
    expect(fetchFn).toHaveBeenCalledOnce()
    store.dispose()
  })

  it('rejects captive-portal HTML even with HTTP 200', async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response('<html>portal</html>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        }),
    ) as unknown as typeof fetch
    const store = createConnectivityStore({
      fetchFn,
      isNavigatorOnline: () => true,
      isVisible: () => true,
    })
    await store.probeOnce()
    expect(store.getSnapshot().transport).toBe('reachable')
    expect(store.getSnapshot().serverFailure).toMatchObject({ kind: 'portal' })
    store.dispose()
  })

  it('treats invalid JSON shape as a portal, not offline', async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response(JSON.stringify({ status: 'degraded' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    ) as unknown as typeof fetch
    const store = createConnectivityStore({
      fetchFn,
      isNavigatorOnline: () => true,
      isVisible: () => true,
    })
    await store.probeOnce()
    expect(store.getSnapshot().serverFailure).toMatchObject({ kind: 'portal' })
    expect(store.getSnapshot().transport).toBe('reachable')
    store.dispose()
  })

  it('probe timeout marks unreachable', async () => {
    const fetchFn = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'))
          })
        }),
    ) as unknown as typeof fetch
    const store = createConnectivityStore({
      fetchFn,
      probeTimeoutMs: 5000,
      isNavigatorOnline: () => true,
      isVisible: () => true,
    })
    const pending = store.probeOnce()
    await vi.advanceTimersByTimeAsync(6000)
    await expect(pending).resolves.toBe(false)
    expect(store.getSnapshot().transport).toBe('unreachable')
    store.dispose()
  })

  it('only runs one probe at a time', async () => {
    let calls = 0
    const fetchFn = vi.fn(async () => {
      calls += 1
      return new Response(JSON.stringify({ status: 'ok' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }) as unknown as typeof fetch
    const store = createConnectivityStore({
      fetchFn,
      isNavigatorOnline: () => true,
      isVisible: () => true,
    })
    const first = store.probeOnce()
    const second = store.probeOnce()
    await first
    await second
    expect(calls).toBe(1)
    store.dispose()
  })

  it('start() is idempotent and stop() removes listeners', () => {
    const addSpy = vi.fn()
    const removeSpy = vi.fn()
    const originalWindow = globalThis.window
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      writable: true,
      value: { addEventListener: addSpy, removeEventListener: removeSpy },
    })
    try {
      const store = createConnectivityStore({
        fetchFn: okJsonFetch(),
        isNavigatorOnline: () => true,
        isVisible: () => true,
      })
      store.start()
      store.start()
      // online + offline + focus = 3 registrations, once despite two starts.
      expect(addSpy).toHaveBeenCalledTimes(3)
      store.stop()
      expect(removeSpy).toHaveBeenCalledTimes(3)
      // Restart registers exactly once more.
      store.start()
      expect(addSpy).toHaveBeenCalledTimes(6)
      store.dispose()
    } finally {
      if (originalWindow === undefined) {
        // oxlint-disable-next-line typescript/no-explicit-any -- test teardown restores globals
        delete (globalThis as any).window
      } else {
        Object.defineProperty(globalThis, 'window', {
          configurable: true,
          writable: true,
          value: originalWindow,
        })
      }
    }
  })

  it('validates health helpers', () => {
    expect(buildHealthUrl('http://localhost:3001/')).toBe(
      'http://localhost:3001/health/liveness',
    )
    expect(isJsonContentType('application/json; charset=utf-8')).toBe(true)
    expect(isJsonContentType('text/html')).toBe(false)
    expect(isValidHealthPayload({ status: 'ok' })).toBe(true)
    expect(isValidHealthPayload({ status: 'down' })).toBe(false)
  })
})
