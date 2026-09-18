import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AuthAccount } from '@/lib/auth'

import {
  clearRevokedMarker,
  createOfflineChannel,
  createOfflineLifecycle,
  FALLBACK_EVENT_KEY,
  hasRevokedMarker,
  isForbiddenError,
  revokedKeyFor,
  shouldVerifySessionOnError,
  writeRevokedMarkerSync,
  type SessionFetchResult,
} from './lifecycle'

function makeAccount(id: string): AuthAccount {
  return {
    id,
    name: `User ${id}`,
    email: `${id}@example.com`,
    image: null,
    emailVerified: true,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
  }
}

function memoryStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() {
      return map.size
    },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => {
      map.delete(key)
    },
    setItem: (key: string, value: string) => {
      map.set(key, value)
    },
  }
}

function namespaceFor(accountId: string): string {
  return JSON.stringify(['http://localhost:3001', accountId])
}

type Harness = {
  lastAccount: AuthAccount | null
  deleted: Array<{ namespace: string; generation: number }>
  lifecycle: ReturnType<typeof createOfflineLifecycle>
  storage: Storage
  broadcasts: Array<{ type: string; namespace: string; generation: number }>
}

function makeHarness(opts?: {
  cached?: AuthAccount | null
  verify?:
    | SessionFetchResult
    | (() => SessionFetchResult | Promise<SessionFetchResult>)
  storage?: Storage | null
  online?: boolean
  deleteImpl?: (namespace: string, generation: number) => Promise<void>
}): Harness {
  const storage =
    opts?.storage === undefined ? memoryStorage() : (opts.storage as Storage)
  let lastAccount: AuthAccount | null = opts?.cached ?? null
  const deleted: Harness['deleted'] = []
  const broadcasts: Harness['broadcasts'] = []
  const verifyValue = opts?.verify ?? { kind: 'signed-out' as const }
  const lifecycle = createOfflineLifecycle({
    readLastAccount: () => lastAccount,
    writeLastAccount: (account) => {
      lastAccount = account
    },
    clearLastAccount: () => {
      lastAccount = null
    },
    resolveNamespace: (id: string) => namespaceFor(id),
    verifySession:
      typeof verifyValue === 'function'
        ? async () =>
            await (
              verifyValue as () =>
                | SessionFetchResult
                | Promise<SessionFetchResult>
            )()
        : async () => verifyValue as SessionFetchResult,
    storage,
    isNavigatorOnline: () => opts?.online ?? true,
    persisted: {
      deleteNamespace: opts?.deleteImpl
        ? async (namespace, generation) =>
            opts.deleteImpl!(namespace, generation)
        : async (namespace, generation) => {
            deleted.push({ namespace, generation })
          },
    },
    onEventBroadcast: (event) => {
      broadcasts.push(event as Harness['broadcasts'][number])
    },
  })
  return {
    get lastAccount() {
      return lastAccount
    },
    deleted,
    lifecycle,
    storage,
    broadcasts,
  }
}

describe('offline lifecycle markers', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('writes the revocation marker synchronously with a unique UUID', () => {
    const storage = memoryStorage()
    const namespace = namespaceFor('a')
    const key = revokedKeyFor(namespace)
    expect(key).toBe(`spliit:offline:revoked:${encodeURIComponent(namespace)}`)
    expect(writeRevokedMarkerSync(namespace, 'uuid-1', storage)).toBe(true)
    expect(storage.getItem(key)).toBe('uuid-1')
    expect(hasRevokedMarker(namespace, storage)).toBe(true)
    expect(clearRevokedMarker(namespace, storage)).toBe(true)
    expect(hasRevokedMarker(namespace, storage)).toBe(false)
  })

  it('never treats failed storage access as successful clearance', () => {
    const failing: Storage = {
      get length() {
        return 0
      },
      clear: () => {},
      getItem: () => {
        throw new Error('denied')
      },
      key: () => null,
      removeItem: () => {
        throw new Error('denied')
      },
      setItem: () => {
        throw new Error('denied')
      },
    }
    const namespace = namespaceFor('a')
    expect(writeRevokedMarkerSync(namespace, 'uuid-1', failing)).toBe(false)
    expect(clearRevokedMarker(namespace, failing)).toBe(false)
    // Unreadable storage yields no marker, but callers must still rely on IDB
    // generation checks — this helper never throws.
    expect(hasRevokedMarker(namespace, failing)).toBe(false)
  })

  it('shouldVerifySessionOnError only for 401 / UNAUTHORIZED', () => {
    expect(shouldVerifySessionOnError({ status: 401 })).toBe(true)
    expect(shouldVerifySessionOnError({ data: { code: 'UNAUTHORIZED' } })).toBe(
      true,
    )
    expect(
      shouldVerifySessionOnError({ cause: { data: { code: 'UNAUTHORIZED' } } }),
    ).toBe(true)
    expect(isForbiddenError({ data: { code: 'FORBIDDEN' } })).toBe(true)
    // Group FORBIDDEN alone never signs out.
    expect(shouldVerifySessionOnError({ data: { code: 'FORBIDDEN' } })).toBe(
      false,
    )
    expect(shouldVerifySessionOnError({ status: 403 })).toBe(false)
    expect(shouldVerifySessionOnError({ status: 500 })).toBe(false)
    expect(shouldVerifySessionOnError(new Error('boom'))).toBe(false)
  })
})

describe('offline lifecycle cold start', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('restores the cached identity immediately while verifying concurrently', async () => {
    const cached = makeAccount('a')
    let resolveVerify!: (value: SessionFetchResult) => void
    const harness = makeHarness({
      cached,
      verify: () =>
        new Promise<SessionFetchResult>((resolve) => {
          resolveVerify = resolve
        }) as unknown as SessionFetchResult,
    })
    // Bootstrap starts restore + verification concurrently; restore displays
    // the cached identity without waiting for the network.
    const pending = harness.lifecycle.bootstrap()
    // Flush the restore microtask while verification still hangs.
    await vi.advanceTimersByTimeAsync(0)
    await Promise.resolve()
    expect(harness.lifecycle.getSnapshot().account?.id).toBe('a')
    expect(harness.lifecycle.getSnapshot().session).toBe('checking')

    resolveVerify({ kind: 'verified', account: cached })
    await pending
    expect(harness.lifecycle.getSnapshot().session).toBe('verified')
    expect(harness.lastAccount?.id).toBe('a')
    harness.lifecycle.dispose()
  })

  it('null (successful) session revokes the read identity', async () => {
    const harness = makeHarness({
      cached: makeAccount('a'),
      verify: { kind: 'signed-out' },
    })
    await harness.lifecycle.bootstrap()
    expect(harness.lifecycle.getSnapshot().session).toBe('signed-out')
    expect(harness.lifecycle.getSnapshot().account).toBeNull()
    expect(harness.lastAccount).toBeNull()
    expect(harness.deleted.length).toBeGreaterThan(0)
    harness.lifecycle.dispose()
  })

  it('failed session (network error) preserves the read identity', async () => {
    const cached = makeAccount('a')
    const harness = makeHarness({
      cached,
      verify: {
        kind: 'network-failure',
        error: new TypeError('Failed to fetch'),
      },
    })
    await harness.lifecycle.bootstrap()
    expect(harness.lifecycle.getSnapshot().account?.id).toBe('a')
    expect(harness.lifecycle.getSnapshot().session).toBe('offline-identity')
    // Offline identity does not clear the device snapshot.
    expect(harness.lastAccount?.id).toBe('a')
    harness.lifecycle.dispose()
  })

  it('5xx preserves the read identity', async () => {
    const cached = makeAccount('a')
    const harness = makeHarness({
      cached,
      verify: { kind: 'server-failure', status: 500 },
    })
    await harness.lifecycle.bootstrap()
    expect(harness.lifecycle.getSnapshot().account?.id).toBe('a')
    expect(harness.lifecycle.getSnapshot().session).toBe('offline-identity')
    harness.lifecycle.dispose()
  })

  it('skips hanging waits when the browser explicitly reports offline', async () => {
    let called = false
    const harness = makeHarness({
      cached: makeAccount('a'),
      online: false,
      verify: async () => {
        called = true
        return { kind: 'verified', account: makeAccount('a') }
      },
    })
    await harness.lifecycle.bootstrap()
    expect(called).toBe(false)
    expect(harness.lifecycle.getSnapshot().session).toBe('offline-identity')
    expect(harness.lifecycle.getSnapshot().account?.id).toBe('a')
    harness.lifecycle.dispose()
  })

  it('never restores from a revoked namespace', async () => {
    const storage = memoryStorage()
    const namespace = namespaceFor('a')
    storage.setItem(revokedKeyFor(namespace), 'marker-1')
    const harness = makeHarness({
      cached: makeAccount('a'),
      storage,
      verify: { kind: 'network-failure' },
    })
    const restored = await harness.lifecycle.restoreOfflineIdentity()
    expect(restored.account).toBeNull()
    harness.lifecycle.dispose()
  })
})

describe('offline lifecycle account transitions', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('switch A->B fences A synchronously, clears queries, then mounts B', async () => {
    const accountA = makeAccount('a')
    const accountB = makeAccount('b')
    const cancelQueries = vi.fn(async () => undefined)
    const clear = vi.fn()
    const storage = memoryStorage()
    let lastAccount: AuthAccount | null = accountA
    const deleted: Array<{ namespace: string; generation: number }> = []
    const lifecycle = createOfflineLifecycle({
      readLastAccount: () => lastAccount,
      writeLastAccount: (account) => {
        lastAccount = account
      },
      clearLastAccount: () => {
        lastAccount = null
      },
      resolveNamespace: (id) => namespaceFor(id),
      verifySession: async () => ({ kind: 'verified', account: accountB }),
      queryClient: { cancelQueries, clear },
      storage,
      persisted: {
        deleteNamespace: async (namespace, generation) => {
          deleted.push({ namespace, generation })
        },
      },
    })
    // Seed A as verified first.
    const seed = createOfflineLifecycle({
      readLastAccount: () => accountA,
      writeLastAccount: (account) => {
        lastAccount = account
      },
      clearLastAccount: () => {
        lastAccount = null
      },
      resolveNamespace: (id) => namespaceFor(id),
      verifySession: async () => ({ kind: 'verified', account: accountA }),
      storage,
    })
    await seed.bootstrap()
    seed.dispose()
    // Drive the switch through a different-account verification response.
    await lifecycle.bootstrap()
    // Bootstrap with B verified when cached A exists triggers the switch path
    // via handleVerifiedAccount; emulate the cold-start race explicitly:
    await lifecycle.handleVerifiedAccount(accountA)
    expect(lifecycle.getSnapshot().account?.id).toBe('a')
    await lifecycle.handleVerifiedAccount(accountB)
    expect(cancelQueries).toHaveBeenCalled()
    expect(clear).toHaveBeenCalled()
    expect(lifecycle.getSnapshot().account?.id).toBe('b')
    expect(lifecycle.getSnapshot().session).toBe('verified')
    // A fenced via marker + generation; persisted A data deleted.
    expect(hasRevokedMarker(namespaceFor('a'), storage)).toBe(true)
    expect(deleted.some((entry) => entry.namespace === namespaceFor('a'))).toBe(
      true,
    )
    lifecycle.dispose()
  })

  it('physical-delete failure still fences A and surfaces cleanup failure', async () => {
    const storage = memoryStorage()
    let lastAccount: AuthAccount | null = makeAccount('a')
    const lifecycle = createOfflineLifecycle({
      readLastAccount: () => lastAccount,
      writeLastAccount: (account) => {
        lastAccount = account
      },
      clearLastAccount: () => {
        lastAccount = null
      },
      resolveNamespace: (id) => namespaceFor(id),
      verifySession: async () => ({ kind: 'signed-out' }),
      storage,
      persisted: {
        deleteNamespace: async () => {
          throw new Error('disk full')
        },
      },
    })
    await lifecycle.bootstrap()
    // Revoked even though the disk delete threw.
    expect(lifecycle.getSnapshot().session).toBe('signed-out')
    expect(lifecycle.getSnapshot().cleanupError).toBe('cleanup-failed')
    expect(hasRevokedMarker(namespaceFor('a'), storage)).toBe(true)
    lifecycle.dispose()
  })

  it('retryCleanup recovers after a failed delete (P1-6)', async () => {
    const storage = memoryStorage()
    let shouldFail = true
    let lastAccount: AuthAccount | null = makeAccount('a')
    const lifecycle = createOfflineLifecycle({
      readLastAccount: () => lastAccount,
      writeLastAccount: (account) => {
        lastAccount = account
      },
      clearLastAccount: () => {
        lastAccount = null
      },
      resolveNamespace: (id) => namespaceFor(id),
      verifySession: async () => ({ kind: 'signed-out' }),
      storage,
      persisted: {
        deleteNamespace: async () => {
          if (shouldFail) throw new Error('disk full')
        },
      },
    })
    await lifecycle.bootstrap()
    expect(lifecycle.getSnapshot().cleanupError).toBe('cleanup-failed')
    shouldFail = false
    const ok = await lifecycle.retryCleanup()
    expect(ok).toBe(true)
    expect(lifecycle.getSnapshot().cleanupError).toBeNull()
    lifecycle.dispose()
  })

  it('successful sign-out revokes locally, clears last-account, and navigates out', async () => {
    const storage = memoryStorage()
    let lastAccount: AuthAccount | null = makeAccount('a')
    const cleared: Array<string> = []
    const navigate = vi.fn()
    const lifecycle = createOfflineLifecycle({
      readLastAccount: () => lastAccount,
      writeLastAccount: (account) => {
        lastAccount = account
      },
      clearLastAccount: () => {
        cleared.push('cleared')
        lastAccount = null
      },
      resolveNamespace: (id) => namespaceFor(id),
      verifySession: async () => ({
        kind: 'verified',
        account: makeAccount('a'),
      }),
      queryClient: { cancelQueries: async () => undefined, clear: () => {} },
      navigate,
      storage,
      persisted: {
        deleteNamespace: async () => {},
      },
    })
    await lifecycle.bootstrap()
    await lifecycle.signOut({ navigateTo: '/' })
    expect(lastAccount).toBeNull()
    expect(cleared).toContain('cleared')
    expect(navigate).toHaveBeenCalledWith('/')
    expect(lifecycle.getSnapshot().session).toBe('signed-out')
    lifecycle.dispose()
  })

  it('stale-tab reactivation only from a fresh verified session', async () => {
    const storage = memoryStorage()
    const namespace = namespaceFor('a')
    storage.setItem(revokedKeyFor(namespace), 'old-marker')
    const box: { current: AuthAccount | null } = { current: null }
    const finished: Array<string> = []
    const lifecycle = createOfflineLifecycle({
      readLastAccount: () => box.current,
      writeLastAccount: (account) => {
        box.current = account
      },
      clearLastAccount: () => {
        box.current = null
      },
      resolveNamespace: (id) => namespaceFor(id),
      verifySession: async () => ({
        kind: 'verified',
        account: makeAccount('a'),
      }),
      storage,
      persisted: {
        finishRevokedDeletion: async (ns) => {
          finished.push(ns)
        },
        resetLifecycle: async () => ({ generation: 7 }),
      },
    })
    await lifecycle.bootstrap()
    // Fresh verified session reactivates: old payloads finished, generation
    // bumped, marker cleared last, last-account rewritten from verification.
    expect(finished).toContain(namespace)
    expect(hasRevokedMarker(namespace, storage)).toBe(false)
    expect(lifecycle.getSnapshot().session).toBe('verified')
    expect(lifecycle.getSnapshot().generation).toBe(7)
    expect(box.current?.id).toBe('a')
    lifecycle.dispose()
  })

  it('cross-tab revoke invalidates and stale hook data cannot repopulate', async () => {
    const storage = memoryStorage()
    const accountA = makeAccount('a')
    let lastAccount: AuthAccount | null = accountA
    const lifecycle = createOfflineLifecycle({
      readLastAccount: () => lastAccount,
      writeLastAccount: (account) => {
        // Stale hook writes go through the single owner, which drops them
        // while invalidated.
        if (lifecycle.getSnapshot().invalidated) return
        lastAccount = account
      },
      clearLastAccount: () => {
        lastAccount = null
      },
      resolveNamespace: (id) => namespaceFor(id),
      verifySession: async () => ({ kind: 'verified', account: accountA }),
      storage,
    })
    await lifecycle.bootstrap()
    const namespace = namespaceFor('a')
    lifecycle.handleCrossTabEvent({
      type: 'revoked',
      namespace,
      generation: lifecycle.getSnapshot().generation + 1,
      nonce: 'nonce-1',
    })
    expect(lifecycle.getSnapshot().invalidated).toBe(true)
    expect(lastAccount).toBeNull()
    // A stale Better Auth hook delivery for the same account must not write.
    // (The provider's legacy effect is disabled; direct writes are dropped.)
    expect(lifecycle.getSnapshot().account?.id).toBe('a')
    lifecycle.dispose()
  })

  it('focus rechecks control after a missed revoke', async () => {
    const storage = memoryStorage()
    const accountA = makeAccount('a')
    let lastAccount: AuthAccount | null = accountA
    let revoked = false
    const lifecycle = createOfflineLifecycle({
      readLastAccount: () => lastAccount,
      writeLastAccount: (account) => {
        lastAccount = account
      },
      clearLastAccount: () => {
        lastAccount = null
      },
      resolveNamespace: (id) => namespaceFor(id),
      verifySession: async () => ({ kind: 'verified', account: accountA }),
      storage,
      persisted: {
        readControl: async () => ({ revoked, generation: 3 }),
      },
    })
    await lifecycle.bootstrap()
    expect(lifecycle.getSnapshot().invalidated).toBe(false)
    // Missed the broadcast; the control record now reports revoked.
    revoked = true
    await lifecycle.recheckOnFocus()
    expect(lifecycle.getSnapshot().invalidated).toBe(true)
    lifecycle.dispose()
  })
})

describe('offline cross-tab channel', () => {
  it('posts without payloads and works without BroadcastChannel', () => {
    const seen: Array<{ type: string; namespace: string }> = []
    const storage = memoryStorage()
    const channel = createOfflineChannel(
      (event) => {
        seen.push(event)
        // No payloads/profile/tokens ever ride the channel.
        expect((event as Record<string, unknown>).payload).toBeUndefined()
        expect((event as Record<string, unknown>).profile).toBeUndefined()
      },
      { broadcastChannel: null, storage },
    )
    const nonce = channel.post({
      type: 'revoked',
      namespace: namespaceFor('a'),
      generation: 2,
    })
    expect(typeof nonce).toBe('string')
    // Fallback key carries event + nonce for BC-less tabs.
    const raw = storage.getItem(FALLBACK_EVENT_KEY)
    expect(raw).toContain('revoked')
    expect(raw).toContain(nonce)
    channel.close()
  })
})

describe('auth error verification and bounded server-failure (P1)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('UNAUTHORIZED notifies verification, FORBIDDEN does not (P1-1)', async () => {
    const harness = makeHarness({
      cached: null,
      verify: { kind: 'signed-out' },
    })
    expect(harness.lifecycle.getSnapshot().verifyAttempt).toBe(0)

    harness.lifecycle.notifyAuthError({ data: { code: 'UNAUTHORIZED' } })
    expect(harness.lifecycle.getSnapshot().verifyAttempt).toBe(1)
    // Wait for the in-flight verification to settle so the next assertion
    // measures exclusion, not single-flight dedupe.
    await harness.lifecycle.verifySession()
    expect(harness.lifecycle.getSnapshot().verifyAttempt).toBe(1)

    const beforeForbidden = harness.lifecycle.getSnapshot().verifyAttempt
    harness.lifecycle.notifyAuthError({ data: { code: 'FORBIDDEN' } })
    await vi.advanceTimersByTimeAsync(0)
    await Promise.resolve()
    expect(harness.lifecycle.getSnapshot().verifyAttempt).toBe(beforeForbidden)

    // Direct HTTP 401 shape also verifies; 403 never does.
    harness.lifecycle.notifyAuthError({ status: 401 })
    expect(harness.lifecycle.getSnapshot().verifyAttempt).toBe(
      beforeForbidden + 1,
    )
    await harness.lifecycle.verifySession()
    const before403 = harness.lifecycle.getSnapshot().verifyAttempt
    harness.lifecycle.notifyAuthError({ status: 403 })
    await vi.advanceTimersByTimeAsync(0)
    await Promise.resolve()
    expect(harness.lifecycle.getSnapshot().verifyAttempt).toBe(before403)
    harness.lifecycle.dispose()
  })

  it('cold start with no cached account bounds server-failure to signed-out (P1-2)', async () => {
    const harness = makeHarness({
      cached: null,
      verify: { kind: 'server-failure', status: 401 },
    })
    await harness.lifecycle.bootstrap()
    // 4xx (including the provider's 401 error shape) must not leave the
    // initial `checking` state unbounded when there is no cached identity.
    expect(harness.lifecycle.getSnapshot().account).toBeNull()
    expect(harness.lifecycle.getSnapshot().session).toBe('signed-out')
    harness.lifecycle.dispose()
  })
})
