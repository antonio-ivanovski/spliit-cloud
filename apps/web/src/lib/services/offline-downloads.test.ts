import { Effect, Fiber } from 'effect'
import { TestClock } from 'effect/testing'
import { describe, expect, it } from 'vitest'

import type { GroupReadResult } from '@/lib/offline/contract'
import type { SyncPassRequest } from '@/lib/offline/sync'
import type {
  OfflineCatalogOutput,
  OfflineSnapshotOutput,
} from '@spliit/api/offline-contract'

import {
  StaleLeaseError,
  StaleRevisionError,
  StorageQuotaError,
} from './errors'
import {
  makeOfflineDownloads,
  type OfflineDownloadDeps,
} from './offline-downloads'
import type { OfflineStorage, StorageServiceError } from './offline-storage'

// Authoring gate (test-audit): this file owns download coordination —
// revision skipping (no fetch for unchanged, freshness confirmed without
// expense writes), trigger coalescing without loss, bounded transient
// retries, Retry-After deferral/resume with the lease released, quota
// stopping writes while keeping reads, lease-loss interruption, visibility
// pause, auth re-verification, forbidden reconciliation, and generation
// fencing, and local deletion follow-ups (expense/group removals apply
// locally, then refresh or evict without resurrection). Regression: an unchanged group fetched again wastes radio and
// risks resurrecting deletes; an unmerged trigger silently drops a refresh;
// an unbounded retry loop hammers a failing endpoint; a held lease across a
// long deferral blocks every other tab; a late result publishing after an
// account switch renders another account's data. Classification, ordering,
// and merge policy are owned by sync.test.ts; this file owns the Effect
// driver around them. The stub storage is the production OfflineStorage
// dependency; stub fetchers match the Sync*Fn shapes the tRPC download
// client provides.

const NAMESPACE = '["http://localhost:3001","downloads-service-test"]'

function catalogEntry(
  groupId: string,
  revision = 'o2.c1.v0',
  latestExpenseCreatedAt: string | null = null,
) {
  return {
    overview: {
      id: groupId,
      name: `Group ${groupId}`,
      displayName: `Group ${groupId}`,
      financialSummary: {
        expenseCount: 0,
        netBalance: 0,
        state: 'NO_EXPENSES',
        latestExpenseCreatedAt,
      },
    },
    global: { id: groupId },
    revision,
  }
}

function makeCatalog(groupIds: string[], revisions?: Record<string, string>) {
  return {
    schemaVersion: 1,
    accountId: 'downloads-service-test',
    capturedAt: new Date(1_000_000),
    groups: groupIds.map((id) =>
      catalogEntry(id, revisions?.[id] ?? 'o2.c1.v0'),
    ),
  } as unknown as OfflineCatalogOutput
}

function makeSnapshot(groupId: string) {
  return {
    groupId,
    marker: `snapshot-${groupId}`,
  } as unknown as OfflineSnapshotOutput
}

function readyMeta(serverRevision: string, dirtySince: Date | null = null) {
  return {
    status: 'ready',
    record: { dirtySince, serverRevision },
  } as unknown as GroupReadResult
}

const MISSING_META = { status: 'missing' } as unknown as GroupReadResult

type StorageCalls = {
  replaceCatalog: number
  confirmGroup: string[]
  commits: string[]
  evicts: string[]
  acquires: number
  renewals: number
  releases: number
  attempts: { groupId: string; result: string }[]
  dirty: string[][]
  deletedExpenses: { groupId: string; expenseId: string }[]
  deletedGroups: string[]
}

function stubStorage(overrides?: {
  control?: Record<string, unknown> | null
  metas?: Record<string, GroupReadResult>
  onReplaceCatalog?: () =>
    | Effect.Effect<{ generation: number; removedGroupIds: string[] }, never>
    | Effect.Effect<never, InstanceType<typeof StaleRevisionError>>
  onCommit?: (
    groupId: string,
  ) => Effect.Effect<
    { storedAt: Date; commitNonce: string },
    InstanceType<typeof StorageQuotaError>
  >
  onRenew?: () => Effect.Effect<
    { leaseOwner: string; leaseUntil: number },
    InstanceType<typeof StaleLeaseError>
  >
  onAcquire?: () => Effect.Effect<
    { leaseOwner: string; leaseUntil: number },
    InstanceType<typeof StaleLeaseError>
  >
  onDeleteExpense?: (input: {
    groupId: string
    expenseId: string
  }) => Effect.Effect<{ dataRevision: number }, StorageServiceError>
  onDeleteGroup?: (input: {
    groupId: string
  }) => Effect.Effect<{ dataRevision: number }, StorageServiceError>
}): OfflineStorage & { calls: StorageCalls } {
  const calls: StorageCalls = {
    replaceCatalog: 0,
    confirmGroup: [],
    commits: [],
    evicts: [],
    deletedExpenses: [],
    deletedGroups: [],
    acquires: 0,
    renewals: 0,
    releases: 0,
    attempts: [],
    dirty: [],
  }
  const control =
    overrides?.control === undefined
      ? {
          namespace: NAMESPACE,
          generation: 0,
          dataRevision: 0,
          revoked: false,
          leaseOwner: null,
          leaseUntil: null,
        }
      : overrides.control
  const metas = overrides?.metas ?? {}
  const storage = {
    open: Effect.void,
    close: Effect.void,
    isOpen: Effect.succeed(true),
    readControl: () => Effect.succeed(control),
    ensureControl: () => Effect.succeed(control),
    readCatalog: () => Effect.succeed({ status: 'missing' as const }),
    readGroupMeta: (_namespace: string, groupId: string) =>
      Effect.succeed(metas[groupId] ?? MISSING_META),
    readGroupData: () => Effect.succeed({ status: 'missing' as const }),
    listGroupStatus: () => Effect.succeed([]),
    replaceCatalog: () => {
      calls.replaceCatalog += 1
      return (
        overrides?.onReplaceCatalog?.() ??
        Effect.succeed({ generation: 0, removedGroupIds: [] as string[] })
      )
    },
    commitGroup: (input: { snapshot: { groupId: string } }) => {
      calls.commits.push(input.snapshot.groupId)
      return (
        overrides?.onCommit?.(input.snapshot.groupId) ??
        Effect.succeed({ storedAt: new Date(), commitNonce: 'n' })
      )
    },
    confirmGroup: (input: { groupId: string }) => {
      calls.confirmGroup.push(input.groupId)
      return Effect.succeed({ confirmed: true })
    },
    markDirty: (input: { dirtyGroupIds: string[] }) => {
      calls.dirty.push(input.dirtyGroupIds)
      return Effect.succeed({ dataRevision: 1 })
    },
    evictGroup: (input: { groupId: string }) => {
      calls.evicts.push(input.groupId)
      return Effect.succeed({ dataRevision: 1 })
    },
    acquireLease: (input: { owner: string }) => {
      calls.acquires += 1
      return (
        overrides?.onAcquire?.() ??
        Effect.succeed({ leaseOwner: input.owner, leaseUntil: 9_999_999_999 })
      )
    },
    renewLease: (input: { owner: string }) => {
      calls.renewals += 1
      return (
        overrides?.onRenew?.() ??
        Effect.succeed({ leaseOwner: input.owner, leaseUntil: 9_999_999_999 })
      )
    },
    releaseLease: () => {
      calls.releases += 1
      return Effect.void
    },
    deleteExpenseLocally: (input: { groupId: string; expenseId: string }) => {
      calls.deletedExpenses.push({
        groupId: input.groupId,
        expenseId: input.expenseId,
      })
      return (
        overrides?.onDeleteExpense?.(input) ??
        Effect.succeed({ dataRevision: 1 })
      )
    },
    deleteGroupLocally: (input: { groupId: string }) => {
      calls.deletedGroups.push(input.groupId)
      return (
        overrides?.onDeleteGroup?.(input) ?? Effect.succeed({ dataRevision: 1 })
      )
    },
    recordAttempt: (input: { groupId: string; result: string }) => {
      calls.attempts.push({ groupId: input.groupId, result: input.result })
      return Effect.void
    },
  } as unknown as OfflineStorage & { calls: StorageCalls }
  storage.calls = calls
  return storage
}

function harness(
  deps?: Partial<OfflineDownloadDeps> & {
    storage?: OfflineStorage & { calls: StorageCalls }
    catalog?: OfflineCatalogOutput
    snapshots?: Record<string, OfflineSnapshotOutput>
    fetchCatalogImpl?: (signal: AbortSignal) => Promise<OfflineCatalogOutput>
    fetchSnapshotImpl?: (
      groupId: string,
      signal: AbortSignal,
    ) => Promise<OfflineSnapshotOutput>
    verifyImpl?: (signal: AbortSignal) => Promise<boolean>
  },
) {
  const storage = deps?.storage ?? stubStorage()
  const catalog = deps?.catalog ?? makeCatalog([])
  const snapshots = deps?.snapshots ?? {}
  const fetchedGroups: string[] = []
  const catalogCalls: string[] = []
  let nowMs = 1_000_000
  let generation = 0
  let verifyCalls = 0
  const downloads = makeOfflineDownloads({
    namespace: NAMESPACE,
    storage,
    verifySession:
      deps?.verifyImpl ??
      (async () => {
        verifyCalls += 1
        return true
      }),
    fetchCatalog:
      deps?.fetchCatalogImpl ??
      (async () => {
        catalogCalls.push('catalog')
        return catalog
      }),
    fetchSnapshot:
      deps?.fetchSnapshotImpl ??
      (async (groupId: string) => {
        fetchedGroups.push(groupId)
        return snapshots[groupId] ?? makeSnapshot(groupId)
      }),
    getCurrentGroupId: deps?.getCurrentGroupId ?? (() => null),
    isVisible: deps?.isVisible ?? (() => true),
    waitForVisible: deps?.waitForVisible ?? (() => Promise.resolve()),
    now: deps?.now ?? (() => nowMs),
    randomUUID: deps?.randomUUID ?? (() => 'owner-test'),
    random01: deps?.random01 ?? (() => 0),
    readGeneration: deps?.readGeneration ?? (() => generation),
    broadcast: deps?.broadcast,
    onConnectivityFailure: deps?.onConnectivityFailure,
    isConnectivityError:
      deps?.isConnectivityError ??
      ((error: unknown) => error instanceof TypeError),
  })
  return {
    downloads,
    storage,
    fetchedGroups,
    catalogCalls,
    getVerifyCalls: () => verifyCalls,
    advanceTime: (ms: number) => {
      nowMs += ms
    },
    setGeneration: (value: number) => {
      generation = value
    },
  }
}

const FULL: SyncPassRequest = { kind: 'full', triggerKind: 'launch' }

/**
 * Drive a TestClock fiber to settlement. Clock adjusts race the fiber reaching
 * its next sleep, so a single upfront adjust can fire with nothing scheduled
 * and strand the fiber; stepping until the observable condition holds (or the
 * fiber exits) keeps timing deterministic.
 */
const settleFiber = (
  fiber: Fiber.Fiber<void, never>,
  until: () => boolean,
  maxSteps = 400,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    for (let step = 0; step < maxSteps; step += 1) {
      if (until()) return
      // Effect v4 exposes only the synchronous pollUnsafe hook.
      const polled = yield* Effect.sync(() => fiber.pollUnsafe())
      if (polled !== undefined) return
      yield* TestClock.adjust('1 second')
    }
    throw new Error('test fiber did not settle in time')
  })

describe('revision-aware skipping', () => {
  it('skips unchanged histories and confirms freshness without expense writes', async () => {
    const storage = stubStorage({
      metas: {
        'g-unchanged': readyMeta('o2.c1.v0'),
        'g-changed': readyMeta('o2.c0.v0'),
      },
    })
    const catalog = makeCatalog(['g-unchanged', 'g-changed', 'g-missing'])
    const ctx = harness({ storage, catalog })
    await Effect.runPromise(ctx.downloads.requestDownload(FULL))
    // Only missing + changed download, in that order; unchanged only confirms.
    expect(ctx.fetchedGroups).toEqual(['g-missing', 'g-changed'])
    expect(storage.calls.confirmGroup).toEqual(['g-unchanged'])
    expect(storage.calls.commits.sort()).toEqual(['g-changed', 'g-missing'])
    const snapshot = await Effect.runPromise(ctx.downloads.snapshot)
    expect(snapshot.phase).toBe('done')
    expect(snapshot.totalGroups).toBe(3)
  })

  it('downloads dirty groups even when the token matches', async () => {
    const storage = stubStorage({
      metas: { 'g-dirty': readyMeta('o2.c1.v0', new Date(2_000_000)) },
    })
    const ctx = harness({ storage, catalog: makeCatalog(['g-dirty']) })
    await Effect.runPromise(ctx.downloads.requestDownload(FULL))
    expect(ctx.fetchedGroups).toEqual(['g-dirty'])
    expect(storage.calls.confirmGroup).toEqual([])
  })
})

describe('trigger coalescing', () => {
  it('merges concurrent triggers without loss or overlap', async () => {
    let releaseCatalog!: () => void
    const gate = new Promise<void>((resolve) => {
      releaseCatalog = resolve
    })
    let inFlight = 0
    let maxInFlight = 0
    const ctx = harness({
      catalog: makeCatalog(['g1', 'g2']),
      fetchCatalogImpl: async () => {
        ctx.catalogCalls.push('catalog')
        await gate
        return makeCatalog(['g1', 'g2'])
      },
      fetchSnapshotImpl: async (groupId: string) => {
        ctx.fetchedGroups.push(groupId)
        inFlight += 1
        maxInFlight = Math.max(maxInFlight, inFlight)
        await new Promise((resolve) => setTimeout(resolve, 5))
        inFlight -= 1
        return makeSnapshot(groupId)
      },
    })
    const program = Effect.gen(function* () {
      const first = yield* Effect.forkChild(
        ctx.downloads.requestDownload({
          kind: 'targeted',
          groupIds: ['g1'],
          triggerKind: 'mutation',
        }),
      )
      const second = yield* Effect.forkChild(
        ctx.downloads.requestDownload(FULL),
      )
      yield* Effect.sleep(10)
      // One active pass: the second trigger merged instead of overlapping.
      expect(ctx.catalogCalls.length).toBe(1)
      releaseCatalog()
      yield* Fiber.join(first)
      yield* Fiber.join(second)
    })
    await Effect.runPromise(program)
    // Both intents honored: the targeted g1 fetch plus the full pass.
    expect(ctx.catalogCalls.length).toBe(2)
    expect(ctx.fetchedGroups).toContain('g1')
    expect(ctx.fetchedGroups).toContain('g2')
    expect(maxInFlight).toBe(1)
  })

  it('lets a full request supersede a targeted one', async () => {
    const ctx = harness({ catalog: makeCatalog(['g1', 'g2']) })
    await Effect.runPromise(
      ctx.downloads.requestDownload({
        kind: 'targeted',
        groupIds: ['g1'],
        triggerKind: 'mutation',
      }),
    )
    expect(ctx.fetchedGroups).toEqual(['g1'])
    await Effect.runPromise(ctx.downloads.handleReconnect)
    expect(ctx.fetchedGroups).toEqual(['g1', 'g1', 'g2'])
  })
})

describe('foreground and mutation triggers', () => {
  it('runs foreground only after 5 minutes and refreshes mutated groups', async () => {
    const storage = stubStorage()
    const ctx = harness({ storage, catalog: makeCatalog(['g1']) })
    await Effect.runPromise(ctx.downloads.handleForeground)
    expect(ctx.catalogCalls.length).toBe(1)
    await Effect.runPromise(ctx.downloads.handleForeground)
    expect(ctx.catalogCalls.length).toBe(1)
    ctx.advanceTime(6 * 60 * 1000)
    await Effect.runPromise(ctx.downloads.handleForeground)
    expect(ctx.catalogCalls.length).toBe(2)
    await Effect.runPromise(ctx.downloads.handleMutation({ groupIds: ['g1'] }))
    expect(storage.calls.dirty).toEqual([['g1']])
    expect(ctx.fetchedGroups).toEqual(['g1', 'g1', 'g1'])
  })

  it('requests a full pass for mutations without a group', async () => {
    const ctx = harness({ catalog: makeCatalog(['g1']) })
    await Effect.runPromise(ctx.downloads.handleMutation({}))
    expect(ctx.fetchedGroups).toEqual(['g1'])
  })
})

describe('bounded transient retries', () => {
  it('retries 5s then 10s and commits on the third attempt', async () => {
    let attempts = 0
    const ctx = harness({
      catalog: makeCatalog(['g1']),
      fetchSnapshotImpl: async (groupId: string) => {
        attempts += 1
        if (attempts <= 2) throw { status: 500 }
        return makeSnapshot(groupId)
      },
    })
    const program = Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(ctx.downloads.requestDownload(FULL))
      yield* settleFiber(fiber, () => attempts >= 3)
      yield* Fiber.join(fiber)
    }).pipe(Effect.provide(TestClock.layer()))
    await Effect.runPromise(program)
    expect(attempts).toBe(3)
    expect(ctx.storage.calls.commits).toEqual(['g1'])
    const snapshot = await Effect.runPromise(ctx.downloads.snapshot)
    expect(snapshot.phase).toBe('done')
  })

  it('records the error after three attempts and continues with others', async () => {
    let g1Attempts = 0
    const ctx = harness({
      catalog: makeCatalog(['g1', 'g2']),
      fetchSnapshotImpl: async (groupId: string) => {
        if (groupId === 'g1') {
          g1Attempts += 1
          throw { status: 503 }
        }
        return makeSnapshot(groupId)
      },
    })
    const program = Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(ctx.downloads.requestDownload(FULL))
      yield* settleFiber(fiber, () => g1Attempts >= 3)
      yield* Fiber.join(fiber)
    }).pipe(Effect.provide(TestClock.layer()))
    await Effect.runPromise(program)
    expect(g1Attempts).toBe(3)
    expect(ctx.storage.calls.commits).toEqual(['g2'])
    const snapshot = await Effect.runPromise(ctx.downloads.snapshot)
    expect(snapshot.phase).toBe('failed')
    expect(snapshot.errors['g1']).toBe('http-503')
  })

  it('bounds the catalog timeout and retries once', async () => {
    let catalogAttempts = 0
    const catalog = makeCatalog(['g1'])
    const ctx = harness({
      catalog,
      fetchCatalogImpl: async () => {
        catalogAttempts += 1
        if (catalogAttempts === 1) {
          await new Promise(() => {})
        }
        return catalog
      },
    })
    const program = Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(ctx.downloads.requestDownload(FULL))
      yield* settleFiber(
        fiber,
        () => ctx.storage.calls.commits.length >= 1,
        400,
      )
      yield* Fiber.join(fiber)
    }).pipe(Effect.provide(TestClock.layer()))
    await Effect.runPromise(program)
    expect(catalogAttempts).toBe(2)
    expect(ctx.storage.calls.commits).toEqual(['g1'])
  })
})

describe('rate-limit deferral', () => {
  it('defers past long Retry-After, releases the lease, and resumes on schedule', async () => {
    const storage = stubStorage()
    // The server recovers after the delay: only the first g1 attempt is
    // rate-limited, so the resumed pass can complete.
    let g1Limited = false
    const ctx = harness({
      storage,
      catalog: makeCatalog(['g1', 'g2']),
      fetchSnapshotImpl: async (groupId: string) => {
        ctx.fetchedGroups.push(groupId)
        if (groupId === 'g1' && !g1Limited) {
          g1Limited = true
          throw { status: 429, retryAfter: '120' }
        }
        return makeSnapshot(groupId)
      },
    })
    await Effect.runPromise(ctx.downloads.requestDownload(FULL))
    const deferred = await Effect.runPromise(ctx.downloads.snapshot)
    expect(deferred.phase).toBe('rate-limited')
    expect(deferred.earliestRetryAt).toBe(1_000_000 + 120_000)
    // The lease is released by the pass finalizer — never held long.
    expect(storage.calls.releases).toBe(1)
    expect(ctx.fetchedGroups).toEqual(['g1'])
    // An early trigger does not retry and does not fetch.
    await Effect.runPromise(ctx.downloads.handleReconnect)
    expect(ctx.fetchedGroups).toEqual(['g1'])
    // After the deadline the scheduler resumes the untried remainder.
    ctx.advanceTime(121_000)
    await Effect.runPromise(ctx.downloads.handleReconnect)
    expect(ctx.fetchedGroups).toEqual(['g1', 'g1', 'g2'])
    const resumed = await Effect.runPromise(ctx.downloads.snapshot)
    expect(resumed.phase).toBe('done')
    expect(resumed.earliestRetryAt).toBe(null)
  })

  it('sleeps short Retry-After minima once and retries once', async () => {
    let attempts = 0
    const ctx = harness({
      catalog: makeCatalog(['g1']),
      fetchSnapshotImpl: async (groupId: string) => {
        attempts += 1
        if (attempts === 1) throw { status: 429, retryAfter: '1' }
        return makeSnapshot(groupId)
      },
    })
    const program = Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(ctx.downloads.requestDownload(FULL))
      yield* settleFiber(fiber, () => attempts >= 2)
      yield* Fiber.join(fiber)
    }).pipe(Effect.provide(TestClock.layer()))
    await Effect.runPromise(program)
    expect(attempts).toBe(2)
    expect(ctx.storage.calls.commits).toEqual(['g1'])
  })
})

describe('quota pressure', () => {
  it('stops writes on quota, keeps reads, and refuses new passes', async () => {
    const storage = stubStorage({
      onCommit: (groupId: string) =>
        groupId === 'g2'
          ? Effect.fail(new StorageQuotaError({}))
          : Effect.succeed({ storedAt: new Date(), commitNonce: 'n' }),
    })
    const ctx = harness({ storage, catalog: makeCatalog(['g1', 'g2']) })
    await Effect.runPromise(ctx.downloads.requestDownload(FULL))
    const snapshot = await Effect.runPromise(ctx.downloads.snapshot)
    expect(snapshot.phase).toBe('quota-error')
    // Commit-path quota records the classification kind, mirroring the
    // legacy coordinator (fetch-path quota records 'quota-exceeded').
    expect(snapshot.errors['g2']).toBe('quota')
    // g1 committed before the pressure; g2 retains its prior (missing) state.
    expect(storage.calls.commits).toEqual(['g1', 'g2'])
    expect(storage.calls.attempts).toContainEqual({
      groupId: 'g1',
      result: 'ok',
    })
    // New passes refuse while storage pressure holds.
    const fetchesBefore = ctx.fetchedGroups.length
    await Effect.runPromise(ctx.downloads.handleReconnect)
    expect(ctx.fetchedGroups.length).toBe(fetchesBefore)
  })
})

describe('connectivity recovery', () => {
  it('pauses on connectivity loss and resumes on reconnect', async () => {
    let catalogAttempts = 0
    let connectivityReports = 0
    const ctx = harness({
      catalog: makeCatalog(['g1']),
      fetchCatalogImpl: async () => {
        catalogAttempts += 1
        if (catalogAttempts === 1) throw new TypeError('fetch failed')
        return makeCatalog(['g1'])
      },
      onConnectivityFailure: () => {
        connectivityReports += 1
      },
    })
    await Effect.runPromise(ctx.downloads.requestDownload(FULL))
    const paused = await Effect.runPromise(ctx.downloads.snapshot)
    expect(paused.phase).toBe('paused-connectivity')
    expect(connectivityReports).toBe(1)
    await Effect.runPromise(ctx.downloads.handleReconnect)
    const recovered = await Effect.runPromise(ctx.downloads.snapshot)
    expect(recovered.phase).toBe('done')
    expect(ctx.storage.calls.commits).toEqual(['g1'])
  })
})

describe('auth and access outcomes', () => {
  it('re-verifies on 401 and continues when the session is live', async () => {
    const ctx = harness({
      catalog: makeCatalog(['g1', 'g2']),
      fetchSnapshotImpl: async (groupId: string) => {
        ctx.fetchedGroups.push(groupId)
        if (groupId === 'g1') throw { status: 401 }
        return makeSnapshot(groupId)
      },
    })
    await Effect.runPromise(ctx.downloads.requestDownload(FULL))
    // Pass-start verification plus the mid-pass re-verification.
    expect(ctx.getVerifyCalls()).toBe(2)
    expect(ctx.storage.calls.commits).toEqual(['g2'])
    const snapshot = await Effect.runPromise(ctx.downloads.snapshot)
    expect(snapshot.errors['g1']).toBe('auth')
  })

  it('reconciles forbidden groups by evicting without signing out', async () => {
    const storage = stubStorage()
    const ctx = harness({
      storage,
      catalog: makeCatalog(['g1']),
      fetchSnapshotImpl: async () => {
        throw { status: 403 }
      },
    })
    await Effect.runPromise(ctx.downloads.requestDownload(FULL))
    expect(storage.calls.evicts).toEqual(['g1'])
    expect(storage.calls.commits).toEqual([])
    const snapshot = await Effect.runPromise(ctx.downloads.snapshot)
    expect(snapshot.phase).toBe('failed')
  })
})

describe('leases', () => {
  it('stops the pass when another tab steals the lease', async () => {
    const storage = stubStorage({
      onRenew: () => Effect.fail(new StaleLeaseError({})),
    })
    const ctx = harness({
      storage,
      catalog: makeCatalog(['g1']),
      fetchSnapshotImpl: async () => {
        await new Promise(() => {})
        return makeSnapshot('g1')
      },
    })
    const program = Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(ctx.downloads.requestDownload(FULL))
      yield* settleFiber(fiber, () => storage.calls.renewals >= 1)
      yield* Fiber.join(fiber)
    }).pipe(Effect.provide(TestClock.layer()))
    await Effect.runPromise(program)
    expect(storage.calls.renewals).toBe(1)
    expect(storage.calls.commits).toEqual([])
    // Best-effort release still runs after the theft.
    expect(storage.calls.releases).toBe(1)
    const snapshot = await Effect.runPromise(ctx.downloads.snapshot)
    expect(snapshot.phase).toBe('cancelled')
  })

  it('stands down when another tab owns the lease', async () => {
    const storage = stubStorage({
      onAcquire: () => Effect.fail(new StaleLeaseError({})),
    })
    const ctx = harness({ storage, catalog: makeCatalog(['g1']) })
    await Effect.runPromise(ctx.downloads.requestDownload(FULL))
    const snapshot = await Effect.runPromise(ctx.downloads.snapshot)
    expect(snapshot.phase).toBe('idle')
    expect(snapshot.isOwner).toBe(false)
    expect(ctx.fetchedGroups).toEqual([])
  })
})

describe('visibility', () => {
  it('waits for a visible document before the next group', async () => {
    let visible = true
    const waiters: (() => void)[] = []
    const storage = stubStorage()
    const ctx = harness({
      storage,
      catalog: makeCatalog(['g1', 'g2']),
      isVisible: () => visible,
      waitForVisible: () =>
        new Promise<void>((resolve) => {
          waiters.push(resolve)
        }),
      fetchSnapshotImpl: async (groupId: string) => {
        ctx.fetchedGroups.push(groupId)
        if (groupId === 'g1') visible = false
        return makeSnapshot(groupId)
      },
    })
    const program = Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(ctx.downloads.requestDownload(FULL))
      // Let the first group finish while the document hides.
      while (!ctx.fetchedGroups.includes('g1')) {
        yield* Effect.sleep(5)
      }
      yield* Effect.sleep(5)
      // The in-flight group finished; the next group never starts hidden.
      expect(ctx.fetchedGroups).toEqual(['g1'])
      visible = true
      for (const wake of waiters) wake()
      yield* Fiber.join(fiber)
    })
    await Effect.runPromise(program)
    expect(ctx.fetchedGroups).toEqual(['g1', 'g2'])
  })
})

describe('generation fencing', () => {
  it('discards a pass whose account generation moved', async () => {
    const ctx = harness({
      catalog: makeCatalog(['g1']),
      fetchCatalogImpl: async () => {
        ctx.catalogCalls.push('catalog')
        ctx.setGeneration(1)
        return makeCatalog(['g1'])
      },
    })
    await Effect.runPromise(ctx.downloads.requestDownload(FULL))
    expect(ctx.storage.calls.commits).toEqual([])
    const snapshot = await Effect.runPromise(ctx.downloads.snapshot)
    expect(snapshot.phase).toBe('cancelled')
  })
})

describe('catalog fencing', () => {
  it('reruns once when a mutation fences the catalog commit', async () => {
    let replaceCalls = 0
    const storage = stubStorage({
      onReplaceCatalog: () => {
        replaceCalls += 1
        return replaceCalls === 1
          ? Effect.fail(new StaleRevisionError({}))
          : Effect.succeed({ generation: 0, removedGroupIds: [] as string[] })
      },
    })
    const ctx = harness({ storage, catalog: makeCatalog(['g1']) })
    await Effect.runPromise(ctx.downloads.requestDownload(FULL))
    expect(replaceCalls).toBe(2)
    expect(storage.calls.commits).toEqual(['g1'])
    const snapshot = await Effect.runPromise(ctx.downloads.snapshot)
    expect(snapshot.phase).toBe('done')
  })
})

describe('local deletion follow-ups', () => {
  it('removes a deleted expense locally and refreshes the group', async () => {
    const events: { type: string; groupId?: string }[] = []
    const storage = stubStorage()
    const ctx = harness({
      storage,
      broadcast: (event) => {
        events.push({ type: event.type, groupId: event.groupId })
      },
    })
    await Effect.runPromise(
      ctx.downloads.handleExpenseDeleted({
        groupId: 'g1',
        expenseId: 'e9',
      }),
    )
    // Atomic local removal first, then the dirty broadcast, then a targeted
    // refresh (the empty-catalog pass still verifies + fetches the catalog).
    expect(storage.calls.deletedExpenses).toEqual([
      { groupId: 'g1', expenseId: 'e9' },
    ])
    // The dirty broadcast leads; the targeted refresh pass may broadcast
    // further committed/catalog events through the same channel.
    expect(events[0]).toEqual({ type: 'dirty', groupId: 'g1' })
    expect(ctx.catalogCalls).toEqual(['catalog'])
  })

  it('marks dirty and still refreshes when local expense deletion fails', async () => {
    const storage = stubStorage({
      onDeleteExpense: () => Effect.fail(new StaleLeaseError({})),
    })
    const ctx = harness({ storage })
    await Effect.runPromise(
      ctx.downloads.handleExpenseDeleted({
        groupId: 'g1',
        expenseId: 'e9',
      }),
    )
    // The old snapshot stays dirty; the refresh still runs.
    expect(storage.calls.dirty).toEqual([['g1']])
    expect(ctx.catalogCalls).toEqual(['catalog'])
  })

  it('evicts a removed group without fetching it', async () => {
    const events: { type: string; groupId?: string }[] = []
    const storage = stubStorage()
    const ctx = harness({
      storage,
      broadcast: (event) => {
        events.push({ type: event.type, groupId: event.groupId })
      },
    })
    await Effect.runPromise(ctx.downloads.handleGroupRemoved({ groupId: 'g9' }))
    expect(storage.calls.deletedGroups).toEqual(['g9'])
    expect(events).toEqual([{ type: 'catalog-changed', groupId: undefined }])
    // No fetch runs for the removed group — not even the catalog.
    expect(ctx.catalogCalls).toEqual([])
    expect(ctx.fetchedGroups).toEqual([])
  })
})
