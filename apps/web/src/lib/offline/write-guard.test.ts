import { QueryClient } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { makeQueryClient } from '@/trpc/query-client'

import {
  assertTransportOnline,
  configureWriteGuardForTests,
  createOfflineWriteGuardLink,
  createWriteGuardMutationCache,
  isKnownOfflineTransport,
  isOfflineWriteError,
  isWriteEligible,
  notifyOfflineWriteBlocked,
  OFFLINE_WRITE_BLOCKED_MESSAGE,
  OfflineWriteError,
  resetOfflineWriteBlockedToastForTests,
  resetWriteGuardForTests,
  shouldSuppressGenericToast,
  WRITE_GUARD_MUTATION_DEFAULTS,
} from './write-guard'

function offlineDeps() {
  return {
    getTransport: () => 'unreachable' as const,
    isNavigatorOnline: () => true,
  }
}

function onlineDeps() {
  return {
    getTransport: () => 'reachable' as const,
    isNavigatorOnline: () => true,
  }
}

describe('offline write guard', () => {
  beforeEach(() => {
    resetWriteGuardForTests()
    resetOfflineWriteBlockedToastForTests()
  })

  afterEach(() => {
    resetWriteGuardForTests()
    resetOfflineWriteBlockedToastForTests()
    vi.restoreAllMocks()
  })

  it('exposes a typed OfflineWriteError with the single reconnect message', () => {
    const error = new OfflineWriteError()
    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('OfflineWriteError')
    expect(error.message).toBe(OFFLINE_WRITE_BLOCKED_MESSAGE)
    expect(error.message).toBe('Reconnect to make changes')
    expect(isOfflineWriteError(error)).toBe(true)
    expect(shouldSuppressGenericToast(error)).toBe(true)
    expect(isOfflineWriteError(new Error('nope'))).toBe(false)
    // Wrapped (tRPC/react-query `cause`) shapes still suppress the duplicate
    // generic toast.
    expect(isOfflineWriteError({ cause: error })).toBe(true)
  })

  it('fails open on unknown transport, blocks known-offline', () => {
    expect(
      isKnownOfflineTransport({
        getTransport: () => 'unknown',
        isNavigatorOnline: () => true,
      }),
    ).toBe(false)
    expect(isKnownOfflineTransport(onlineDeps())).toBe(false)
    expect(isKnownOfflineTransport(offlineDeps())).toBe(true)
    expect(
      isKnownOfflineTransport({
        getTransport: () => 'reachable',
        isNavigatorOnline: () => false,
      }),
    ).toBe(true)
    expect(() => assertTransportOnline(onlineDeps())).not.toThrow()
    expect(() => assertTransportOnline(offlineDeps())).toThrow(
      OfflineWriteError,
    )
  })

  it('computes UI eligibility as verified session + reachable transport', () => {
    expect(
      isWriteEligible({ session: 'verified', transport: 'reachable' }),
    ).toBe(true)
    expect(
      isWriteEligible({ session: 'verified', transport: 'unreachable' }),
    ).toBe(false)
    expect(isWriteEligible({ session: 'verified', transport: 'unknown' })).toBe(
      false,
    )
    expect(
      isWriteEligible({ session: 'offline-identity', transport: 'reachable' }),
    ).toBe(false)
    expect(
      isWriteEligible({ session: 'checking', transport: 'reachable' }),
    ).toBe(false)
    expect(
      isWriteEligible({ session: 'signed-out', transport: 'reachable' }),
    ).toBe(false)
  })

  it('dedupes the reconnect explanation so repeated clicks do not spam toasts', () => {
    const notify = vi.fn()
    let now = 1000
    expect(notifyOfflineWriteBlocked(notify, () => now)).toBe(true)
    expect(notify).toHaveBeenCalledTimes(1)
    expect(notify).toHaveBeenCalledWith(OFFLINE_WRITE_BLOCKED_MESSAGE)
    now += 500
    expect(notifyOfflineWriteBlocked(notify, () => now)).toBe(false)
    expect(notify).toHaveBeenCalledTimes(1)
    now += 3000
    expect(notifyOfflineWriteBlocked(notify, () => now)).toBe(true)
    expect(notify).toHaveBeenCalledTimes(2)
  })

  it('wires mutation defaults networkMode:always + retry:0 (no paused queue/replay)', () => {
    expect(WRITE_GUARD_MUTATION_DEFAULTS.networkMode).toBe('always')
    expect(WRITE_GUARD_MUTATION_DEFAULTS.retry).toBe(0)
    const client = makeQueryClient()
    const defaults = client.getDefaultOptions().mutations
    expect(defaults?.networkMode).toBe('always')
    expect(defaults?.retry).toBe(0)
    client.clear()
  })

  it('global MutationCache.onMutate runs BEFORE per-mutation onMutate (installed query-core ordering)', async () => {
    configureWriteGuardForTests(offlineDeps())
    const order: string[] = []
    let fetchCalls = 0
    const client = new QueryClient({
      defaultOptions: {
        mutations: {
          networkMode: WRITE_GUARD_MUTATION_DEFAULTS.networkMode,
          retry: WRITE_GUARD_MUTATION_DEFAULTS.retry,
        },
      },
      mutationCache: createWriteGuardMutationCache(),
    })
    const mutation = client.getMutationCache().build(client, {
      mutationFn: () => {
        fetchCalls += 1
        return Promise.resolve('sent')
      },
      onMutate: () => {
        // Per-mutation optimism: must never run while the guard rejects.
        order.push('option-onMutate')
      },
      onError: (error) => {
        // Rollback tolerates the missing optimistic context: the guard threw
        // before any context existed, so this runs with `undefined` context
        // and must not throw.
        order.push('option-onError')
        expect(isOfflineWriteError(error)).toBe(true)
      },
      retry: 0,
      networkMode: 'always',
    })
    await expect(mutation.execute({})).rejects.toBeInstanceOf(OfflineWriteError)
    // Guard ran (rejected); per-mutation optimism never ran; no fetch sent.
    expect(order).toEqual(['option-onError'])
    expect(fetchCalls).toBe(0)
    // No paused entry, no retry, no reconnect replay: single error entry.
    // (query-core records the single immediate failure; retry:0 means it is
    // never retried or replayed.)
    const entries = client.getMutationCache().getAll()
    expect(entries).toHaveLength(1)
    const state = entries[0]?.state
    expect(state?.status).toBe('error')
    expect(state?.failureCount).toBeLessThanOrEqual(1)
    expect(
      isOfflineWriteError(
        (state as unknown as { failureReason?: unknown })?.failureReason ??
          (state as unknown as { error?: unknown })?.error,
      ),
    ).toBe(true)
    expect(
      (state as unknown as { isPaused?: boolean } | undefined)?.isPaused,
    ).not.toBe(true)
    expect(client.isMutating()).toBe(0)
    client.clear()
  })

  it('blocked direct client mutations never fetch, pause, retry, or replay', async () => {
    configureWriteGuardForTests(offlineDeps())
    const client = new QueryClient({
      defaultOptions: {
        mutations: {
          networkMode: WRITE_GUARD_MUTATION_DEFAULTS.networkMode,
          retry: WRITE_GUARD_MUTATION_DEFAULTS.retry,
        },
      },
      mutationCache: createWriteGuardMutationCache(),
    })
    const mutationFn = vi.fn(() => Promise.resolve({ ok: true }))
    const optimism = vi.fn(() => ({ optimistic: true }))
    const first = client.getMutationCache().build(client, {
      mutationFn,
      onMutate: optimism,
      retry: 0,
      networkMode: 'always',
    })
    const second = client.getMutationCache().build(client, {
      mutationFn,
      onMutate: optimism,
      retry: 0,
      networkMode: 'always',
    })
    // Repeated clicks: both reject immediately with the typed error.
    await expect(first.execute({ id: 1 })).rejects.toBeInstanceOf(
      OfflineWriteError,
    )
    await expect(second.execute({ id: 1 })).rejects.toBeInstanceOf(
      OfflineWriteError,
    )
    expect(optimism).not.toHaveBeenCalled()
    expect(mutationFn).not.toHaveBeenCalled()
    const paused = client
      .getMutationCache()
      .getAll()
      .filter(
        (entry) =>
          (entry.state as unknown as { isPaused?: boolean }).isPaused === true,
      )
    expect(paused).toHaveLength(0)
    client.clear()
  })

  it('online mutations pass the guard and run optimism + fetch', async () => {
    configureWriteGuardForTests(onlineDeps())
    const client = new QueryClient({
      defaultOptions: {
        mutations: {
          networkMode: WRITE_GUARD_MUTATION_DEFAULTS.networkMode,
          retry: WRITE_GUARD_MUTATION_DEFAULTS.retry,
        },
      },
      mutationCache: createWriteGuardMutationCache(),
    })
    const order: string[] = []
    const mutation = client.getMutationCache().build(client, {
      mutationFn: () => {
        order.push('fetch')
        return Promise.resolve('ok')
      },
      onMutate: () => {
        order.push('option-onMutate')
      },
      retry: 0,
      networkMode: 'always',
    })
    await expect(mutation.execute({})).resolves.toBe('ok')
    expect(order).toEqual(['option-onMutate', 'fetch'])
    client.clear()
  })

  it('tRPC guard link blocks mutations offline without calling next, passes queries', () => {
    configureWriteGuardForTests(offlineDeps())
    const link = createOfflineWriteGuardLink()
    const next = vi.fn(
      () =>
        ({
          subscribe: () => undefined,
        }) as never,
    )
    const operate = link({} as never) as unknown as (args: {
      op: { type: string }
      next: typeof next
    }) => unknown
    expect(() => operate({ op: { type: 'mutation' }, next })).toThrow(
      OfflineWriteError,
    )
    expect(next).not.toHaveBeenCalled()
    // Read-semantic procedures encoded as mutations are still blocked; plain
    // queries/subscriptions (offline adapters) pass through.
    expect(() => operate({ op: { type: 'query' }, next })).not.toThrow()
    expect(next).toHaveBeenCalledTimes(1)
  })

  it('tRPC guard link passes mutations when online', () => {
    configureWriteGuardForTests(onlineDeps())
    const link = createOfflineWriteGuardLink()
    const next = vi.fn(
      () =>
        ({
          subscribe: () => undefined,
        }) as never,
    )
    const operate = link({} as never) as unknown as (args: {
      op: { type: string }
      next: typeof next
    }) => unknown
    expect(() => operate({ op: { type: 'mutation' }, next })).not.toThrow()
    expect(next).toHaveBeenCalledTimes(1)
  })
})
