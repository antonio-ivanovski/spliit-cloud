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
import type { OfflineExpenseCreateEnqueue } from './write-guard'

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

describe('offline expenses.create diversion (Phase 1)', () => {
  const CREATE_KEY = [['groups', 'expenses', 'create']]
  const UPDATE_KEY = [['groups', 'expenses', 'update']]
  const variables = {
    groupId: 'g1',
    requestId: '00000000-0000-4000-8000-000000000001',
    expense: { title: 'Dinner', amount: 300 },
  }

  beforeEach(() => {
    resetWriteGuardForTests()
    resetOfflineWriteBlockedToastForTests()
  })

  afterEach(() => {
    resetWriteGuardForTests()
    resetOfflineWriteBlockedToastForTests()
    vi.restoreAllMocks()
  })

  function offlineCache(enqueue?: OfflineExpenseCreateEnqueue) {
    return new QueryClient({
      defaultOptions: {
        mutations: {
          networkMode: WRITE_GUARD_MUTATION_DEFAULTS.networkMode,
          retry: WRITE_GUARD_MUTATION_DEFAULTS.retry,
        },
      },
      mutationCache: createWriteGuardMutationCache(
        enqueue ? { enqueueExpenseCreate: enqueue } : undefined,
      ),
    })
  }

  it('enqueues expenses.create offline and lets the mutation proceed', async () => {
    configureWriteGuardForTests(offlineDeps())
    const enqueue = vi.fn(async () => ({ queued: true }))
    const mutationFn = vi.fn(async () => 'sent')
    const client = offlineCache(enqueue)
    const mutation = client.getMutationCache().build(client, {
      mutationKey: CREATE_KEY,
      mutationFn,
      retry: 0,
      networkMode: 'always',
    })
    await expect(mutation.execute(variables)).resolves.toBe('sent')
    expect(enqueue).toHaveBeenCalledTimes(1)
    expect(enqueue).toHaveBeenCalledWith(variables)
    expect(mutationFn).toHaveBeenCalledTimes(1)
    client.clear()
  })

  it('still throws for every other mutation while offline', async () => {
    configureWriteGuardForTests(offlineDeps())
    const enqueue = vi.fn(async () => ({ queued: true }))
    const mutationFn = vi.fn(async () => 'sent')
    const client = offlineCache(enqueue)
    const mutation = client.getMutationCache().build(client, {
      mutationKey: UPDATE_KEY,
      mutationFn,
      retry: 0,
      networkMode: 'always',
    })
    await expect(mutation.execute(variables)).rejects.toBeInstanceOf(
      OfflineWriteError,
    )
    expect(enqueue).not.toHaveBeenCalled()
    expect(mutationFn).not.toHaveBeenCalled()
    client.clear()
  })

  it('throws when expenses.create variables are not enqueueable', async () => {
    configureWriteGuardForTests(offlineDeps())
    const enqueue = vi.fn(async () => ({ queued: true }))
    const client = offlineCache(enqueue)
    const mutation = client.getMutationCache().build(client, {
      mutationKey: CREATE_KEY,
      mutationFn: vi.fn(async () => 'sent'),
      retry: 0,
      networkMode: 'always',
    })
    await expect(mutation.execute({ groupId: 'g1' })).rejects.toBeInstanceOf(
      OfflineWriteError,
    )
    expect(enqueue).not.toHaveBeenCalled()
    client.clear()
  })

  it('propagates enqueue failures as OfflineWriteError', async () => {
    configureWriteGuardForTests(offlineDeps())
    const enqueue = vi.fn(async () => {
      throw new OfflineWriteError()
    })
    const mutationFn = vi.fn(async () => 'sent')
    const client = offlineCache(enqueue)
    const mutation = client.getMutationCache().build(client, {
      mutationKey: CREATE_KEY,
      mutationFn,
      retry: 0,
      networkMode: 'always',
    })
    await expect(mutation.execute(variables)).rejects.toBeInstanceOf(
      OfflineWriteError,
    )
    expect(mutationFn).not.toHaveBeenCalled()
    client.clear()
  })

  it('stays inert without a handler and passes online creates through', async () => {
    // No handler: offline creates throw like before (pre-diversion behavior).
    configureWriteGuardForTests(offlineDeps())
    const bare = offlineCache()
    const blocked = bare.getMutationCache().build(bare, {
      mutationKey: CREATE_KEY,
      mutationFn: vi.fn(async () => 'sent'),
      retry: 0,
      networkMode: 'always',
    })
    await expect(blocked.execute(variables)).rejects.toBeInstanceOf(
      OfflineWriteError,
    )
    bare.clear()

    // Online: the handler never runs, the mutation proceeds normally.
    configureWriteGuardForTests(onlineDeps())
    const enqueue = vi.fn(async () => ({ queued: true }))
    const mutationFn = vi.fn(async () => 'sent')
    const online = offlineCache(enqueue)
    const mutation = online.getMutationCache().build(online, {
      mutationKey: CREATE_KEY,
      mutationFn,
      retry: 0,
      networkMode: 'always',
    })
    await expect(mutation.execute(variables)).resolves.toBe('sent')
    expect(enqueue).not.toHaveBeenCalled()
    online.clear()
  })

  function divertedLink(enqueue?: OfflineExpenseCreateEnqueue) {
    const link = createOfflineWriteGuardLink(
      enqueue ? { enqueueExpenseCreate: enqueue } : undefined,
    )
    const next = vi.fn(
      () =>
        ({
          subscribe: () => undefined,
        }) as never,
    )
    const operate = link({} as never) as unknown as (args: {
      op: { type: string; path?: string; input?: unknown }
      next: typeof next
    }) => {
      subscribe: (observer: {
        next?: (value: unknown) => void
        error?: (error: unknown) => void
        complete?: () => void
      }) => { unsubscribe: () => void }
    }
    return { operate, next }
  }

  async function subscribeOnce(observable: {
    subscribe: (observer: {
      next?: (value: unknown) => void
      error?: (error: unknown) => void
      complete?: () => void
    }) => { unsubscribe: () => void }
  }): Promise<unknown> {
    return new Promise<unknown>((resolve, reject) => {
      observable.subscribe({
        next: (value) => resolve(value),
        error: (error) => reject(error),
      })
    })
  }

  it('link short-circuits expenses.create to a synthetic queued result', async () => {
    configureWriteGuardForTests(offlineDeps())
    const queued = { expenseId: 'pending-req', recurringSeriesId: null }
    const enqueue = vi.fn(async () => queued)
    const { operate, next } = divertedLink(enqueue)

    const result = await subscribeOnce(
      operate({
        op: {
          type: 'mutation',
          path: 'groups.expenses.create',
          input: variables,
        },
        next,
      }),
    )
    expect(enqueue).toHaveBeenCalledTimes(1)
    expect(enqueue).toHaveBeenCalledWith(variables)
    expect(next).not.toHaveBeenCalled()
    expect(result).toEqual({ result: { type: 'data', data: queued } })
  })

  it('link passes expenses.create through when online even with a handler', () => {
    // Regression: the diversion once ignored transport, so every online
    // create resolved with a synthetic temp id and never reached the server.
    configureWriteGuardForTests(onlineDeps())
    const enqueue = vi.fn(async () => ({ queued: true }))
    const { operate, next } = divertedLink(enqueue)
    operate({
      op: {
        type: 'mutation',
        path: 'groups.expenses.create',
        input: variables,
      },
      next,
    })
    expect(enqueue).not.toHaveBeenCalled()
    expect(next).toHaveBeenCalledTimes(1)
  })

  it('link still throws for other paths, invalid input, and missing handler', () => {
    configureWriteGuardForTests(offlineDeps())
    const enqueue = vi.fn(async () => ({ queued: true }))
    const { operate, next } = divertedLink(enqueue)
    expect(() =>
      operate({
        op: {
          type: 'mutation',
          path: 'groups.expenses.update',
          input: variables,
        },
        next,
      }),
    ).toThrow(OfflineWriteError)
    expect(() =>
      operate({
        op: {
          type: 'mutation',
          path: 'groups.expenses.create',
          input: { groupId: 'g1' },
        },
        next,
      }),
    ).toThrow(OfflineWriteError)
    expect(enqueue).not.toHaveBeenCalled()

    const bare = divertedLink()
    expect(() =>
      bare.operate({
        op: {
          type: 'mutation',
          path: 'groups.expenses.create',
          input: variables,
        },
        next: bare.next,
      }),
    ).toThrow(OfflineWriteError)
  })

  it('link surfaces enqueue failures through the observable error', async () => {
    configureWriteGuardForTests(offlineDeps())
    const failure = new OfflineWriteError()
    const { operate, next } = divertedLink(async () => {
      throw failure
    })
    await expect(
      subscribeOnce(
        operate({
          op: {
            type: 'mutation',
            path: 'groups.expenses.create',
            input: variables,
          },
          next,
        }),
      ),
    ).rejects.toBe(failure)
    expect(next).not.toHaveBeenCalled()
  })
})
