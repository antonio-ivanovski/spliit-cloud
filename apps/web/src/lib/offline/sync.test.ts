import 'fake-indexeddb/auto'
import { openDB } from 'idb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { buildNamespace, OFFLINE_DB_NAME, OFFLINE_DB_VERSION } from './contract'
import { OfflineRepository } from './repository'
import {
  OFFLINE_SYNC_FOREGROUND_STALE_MS,
  OFFLINE_SYNC_GROUP_RETRY_DELAY_MS,
  OFFLINE_SYNC_MAX_RETRY_AFTER_MS,
  classifySyncError,
  createOfflineSync,
  parseRetryAfterMs,
} from './sync'

const API_ORIGIN = 'http://localhost:3001'
const ACCOUNT = 'account-sync'

function namespaceFor(accountId: string = ACCOUNT): string {
  return buildNamespace(API_ORIGIN, accountId)
}

function overviewEntry(groupId: string, latest: string | null = null) {
  return {
    overview: {
      id: groupId,
      name: `Group ${groupId}`,
      information: null,
      archived: false,
      createdAt: new Date().toISOString(),
      groupType: 'GROUP' as const,
      emoji: null,
      color: null,
      ledger: { currency: 'USD', currencyCode: 'USD' },
      memberCount: 2,
      currentMemberRole: 'MEMBER' as const,
      preference: { starred: false, hidden: false },
      displayName: `Group ${groupId}`,
      friendAccount: null,
      memberAccounts: [],
      financialSummary: {
        expenseCount: 0,
        netBalance: 0,
        state: 'NO_EXPENSES' as const,
        latestExpenseCreatedAt: latest,
      },
      access: 'MEMBER' as const,
      viewKey: null,
      lastOpenedAt: null,
    },
    global: {
      id: groupId,
      name: `Group ${groupId}`,
      archived: false,
      hidden: false,
      groupType: 'GROUP' as const,
      displayName: `Group ${groupId}`,
      currency: 'USD',
      currencyCode: 'USD',
      participantCount: 2,
    },
  }
}

function makeCatalog(
  accountId: string,
  groupIds: string[],
  recency?: Record<string, string | null>,
) {
  return {
    schemaVersion: 1 as const,
    accountId,
    capturedAt: new Date(),
    groups: groupIds.map((id) => overviewEntry(id, recency?.[id] ?? null)),
  }
}

function makeExpenseRecord(expenseId: string) {
  const stamp = new Date('2026-09-01T12:00:00.000Z')
  const category = {
    id: 'general' as const,
    grouping: 'Uncategorized',
    name: 'General',
  }
  return {
    list: {
      id: expenseId,
      title: `Expense ${expenseId}`,
      amount: 500,
      expenseDate: stamp,
      expenseTimeZone: 'UTC',
      categoryId: 'general' as const,
      category,
      splitMode: 'EVENLY' as const,
      paidBySplitMode: 'EVENLY' as const,
      originalAmount: null,
      originalCurrency: null,
      conversionRate: null,
      conversionSource: null,
      originType: null,
      recurrenceSequence: null,
      items: [],
      permissions: {
        canEdit: true,
        canDelete: true,
        canManageRecurrence: false,
      },
      createdAt: stamp,
      paidByList: [],
      paidFor: [],
      recurringSeriesId: null,
      recurringSeriesStatus: null,
      documentCount: 0,
    },
    detail: {
      id: expenseId,
      title: `Expense ${expenseId}`,
      amount: 500,
      expenseDate: stamp,
      expenseTimeZone: 'UTC',
      categoryId: 'general' as const,
      category,
      splitMode: 'EVENLY' as const,
      paidBySplitMode: 'EVENLY' as const,
      originalAmount: null,
      originalCurrency: null,
      conversionRate: null,
      conversionSource: null,
      originType: null,
      recurrenceSequence: null,
      permissions: {
        canEdit: true,
        canDelete: true,
        canManageRecurrence: false,
      },
      version: 1,
      createdAt: stamp,
      notes: null,
      documents: [],
      paidByList: [],
      paidFor: [],
      items: [],
      itemizedRemainder: null,
      recurringSeriesId: null,
      recurringSeries: null,
      recurrence: null,
      previousExpenseId: null,
      nextExpenseId: null,
    },
  }
}

function makeSnapshot(
  accountId: string,
  groupId: string,
  expenseIds: string[] = [],
) {
  const entry = overviewEntry(groupId)
  const capturedAt = new Date()
  const stamp = new Date(capturedAt)
  return {
    schemaVersion: 1 as const,
    accountId,
    groupId,
    capturedAt,
    group: {
      group: {
        id: groupId,
        name: `Group ${groupId}`,
        information: null,
        archived: false,
        createdAt: stamp,
        groupType: 'GROUP' as const,
        emoji: null,
        color: null,
        ledgerId: 'ledger-1',
        friendPairKey: null,
        ledger: {
          id: 'ledger-1',
          currency: 'USD',
          currencyCode: 'USD',
          createdAt: stamp,
        },
        members: [],
        invitations: [],
        currency: 'USD',
        currencyCode: 'USD',
        participants: [],
      },
      displayName: `Group ${groupId}`,
      currentLedgerParticipantId: null,
      currentMember: {
        id: 'member-1',
        role: 'MEMBER' as const,
        status: 'ACTIVE' as const,
      },
      currentInvitation: null,
      linkInviteState: null,
      viewer: {
        source: 'MEMBER' as const,
        access: 'READ_WRITE' as const,
        canMutate: true,
        canAcceptInvitation: false,
      },
      hasSavedView: false,
    },
    overview: entry.overview,
    global: entry.global,
    balances: {
      balances: {},
      suggestedSettlements: [],
      currencyBalances: [],
      participants: [],
      settlement: {
        subgroup: { units: [], legs: [], hasInternalBalances: false },
        individual: { suggestedSettlements: [], policy: 'standard' as const },
      },
    },
    expenses: expenseIds.map((id) => makeExpenseRecord(id)),
    totalCount: expenseIds.length,
    downloadedCount: expenseIds.length,
    hasMore: false,
    truncatedAt: null,
  }
}

const opened: OfflineRepository[] = []
const syncs: Array<ReturnType<typeof createOfflineSync>> = []

async function openRepo(): Promise<OfflineRepository> {
  const repo = await OfflineRepository.open()
  opened.push(repo)
  return repo
}

function trackSync(sync: ReturnType<typeof createOfflineSync>) {
  syncs.push(sync)
  return sync
}

beforeEach(async () => {
  await OfflineRepository.deleteDatabaseForTests()
})

afterEach(async () => {
  for (const sync of syncs.splice(0)) {
    try {
      sync.dispose()
    } catch {
      // Ignore teardown failures.
    }
  }
  for (const repo of opened.splice(0)) {
    try {
      repo.close()
    } catch {
      // Ignore teardown failures.
    }
  }
  vi.restoreAllMocks()
  await OfflineRepository.deleteDatabaseForTests()
})

describe('offline sync leases and ordering', () => {
  it('allows one download owner across tabs; loser reads committed results', async () => {
    const repo = await openRepo()
    const namespace = namespaceFor()
    await repo.ensureControl(namespace)
    const catalog = makeCatalog(ACCOUNT, ['g1', 'g2'])
    let catalogCalls = 0
    const fetchCatalog = async () => {
      catalogCalls += 1
      // Small delay so both tabs race for the lease before catalog fetch.
      await Promise.resolve()
      return catalog
    }
    const fetchSnapshot = async (groupId: string) => {
      await Promise.resolve()
      return makeSnapshot(ACCOUNT, groupId)
    }
    const verify = async () => true
    const syncA = trackSync(
      createOfflineSync({
        namespace,
        repository: repo,
        verifySession: verify,
        fetchCatalog,
        fetchSnapshot,
      }),
    )
    const syncB = trackSync(
      createOfflineSync({
        namespace,
        repository: repo,
        verifySession: verify,
        fetchCatalog,
        fetchSnapshot,
      }),
    )
    expect(syncA.getOwnerId()).not.toBe(syncB.getOwnerId())

    await Promise.all([syncA.handleLaunch(), syncB.handleLaunch()])

    // Loser tabs never fetch: only the owner downloads, both read commits.
    expect(catalogCalls).toBe(1)
    expect((await repo.readGroup(namespace, 'g1')).status).toBe('ready')
    expect((await repo.readGroup(namespace, 'g2')).status).toBe('ready')
  })

  it('downloads the current group first, then missing by recency', async () => {
    const repo = await openRepo()
    const namespace = namespaceFor()
    await repo.ensureControl(namespace)
    const recency = {
      'g-old': '2026-01-01T00:00:00.000Z',
      'g-current': '2026-06-01T00:00:00.000Z',
      'g-new': '2026-09-01T00:00:00.000Z',
    }
    const catalog = makeCatalog(
      ACCOUNT,
      ['g-old', 'g-current', 'g-new'],
      recency,
    )
    const order: string[] = []
    const sync = trackSync(
      createOfflineSync({
        namespace,
        repository: repo,
        verifySession: async () => true,
        fetchCatalog: async () => catalog,
        fetchSnapshot: async (groupId: string) => {
          order.push(groupId)
          return makeSnapshot(ACCOUNT, groupId)
        },
        getCurrentGroupId: () => 'g-current',
      }),
    )
    await sync.handleLaunch()
    expect(order).toEqual(['g-current', 'g-new', 'g-old'])
  })

  it('issues exactly one snapshot request per group (no N+1 detail calls)', async () => {
    // Acceptance shape: 20 catalog groups download with one network snapshot
    // request each. Detail rows arrive inside the snapshot payload; the sync
    // layer never fans out per-expense requests.
    const repo = await openRepo()
    const namespace = namespaceFor()
    await repo.ensureControl(namespace)
    const groupIds = Array.from({ length: 20 }, (_, index) => `g-${index}`)
    const catalog = makeCatalog(ACCOUNT, groupIds)
    let catalogCalls = 0
    const snapshotCalls = new Map<string, number>()
    const sync = trackSync(
      createOfflineSync({
        namespace,
        repository: repo,
        verifySession: async () => true,
        fetchCatalog: async () => {
          catalogCalls += 1
          return catalog
        },
        fetchSnapshot: async (groupId: string) => {
          snapshotCalls.set(groupId, (snapshotCalls.get(groupId) ?? 0) + 1)
          return makeSnapshot(ACCOUNT, groupId)
        },
      }),
    )
    await sync.handleLaunch()
    expect(catalogCalls).toBe(1)
    expect(snapshotCalls.size).toBe(groupIds.length)
    for (const groupId of groupIds) {
      expect(snapshotCalls.get(groupId)).toBe(1)
      expect((await repo.readGroup(namespace, groupId)).status).toBe('ready')
    }
  })

  it('restarts after a crashed owner once the lease expires', async () => {
    const repo = await openRepo()
    const namespace = namespaceFor()
    await repo.ensureControl(namespace)
    let currentTime = Date.now()
    // Crashed owner: acquire directly with no renew or release.
    await repo.acquireLease({
      namespace,
      generation: 0,
      owner: 'crashed-tab',
      ttlMs: 30_000,
      now: currentTime,
    })
    const catalog = makeCatalog(ACCOUNT, ['g1'])
    const sync = trackSync(
      createOfflineSync({
        namespace,
        repository: repo,
        verifySession: async () => true,
        fetchCatalog: async () => catalog,
        fetchSnapshot: async (groupId: string) =>
          makeSnapshot(ACCOUNT, groupId),
        now: () => currentTime,
      }),
    )
    // Still leased: loser does not download.
    await sync.handleLaunch()
    expect((await repo.readGroup(namespace, 'g1')).status).toBe('missing')

    // Crash expiry: move past 30s so the lease becomes replaceable.
    currentTime += 31_000
    await sync.handleLaunch()
    expect((await repo.readGroup(namespace, 'g1')).status).toBe('ready')
  })
})

describe('offline sync resilience', () => {
  it('retries a transient group once then continues to other groups', async () => {
    const repo = await openRepo()
    const namespace = namespaceFor()
    await repo.ensureControl(namespace)
    const catalog = makeCatalog(ACCOUNT, ['g-fail', 'g-ok1', 'g-ok2'])
    const calls = new Map<string, number>()
    const sleeps: number[] = []
    const sync = trackSync(
      createOfflineSync({
        namespace,
        repository: repo,
        verifySession: async () => true,
        fetchCatalog: async () => catalog,
        fetchSnapshot: async (groupId: string) => {
          calls.set(groupId, (calls.get(groupId) ?? 0) + 1)
          if (groupId === 'g-fail') throw { status: 500 }
          return makeSnapshot(ACCOUNT, groupId)
        },
        // Immediate sleep keeps the test fast while still exercising the
        // one-retry-then-continue path (no fake timers needed for IDB).
        sleep: async (ms: number) => {
          sleeps.push(ms)
        },
      }),
    )
    await sync.handleLaunch()

    expect(calls.get('g-fail')).toBe(2)
    expect(calls.get('g-ok1')).toBe(1)
    expect(calls.get('g-ok2')).toBe(1)
    expect((await repo.readGroup(namespace, 'g-ok1')).status).toBe('ready')
    expect((await repo.readGroup(namespace, 'g-ok2')).status).toBe('ready')
    expect(sync.getStatus().errors['g-fail']).toMatch(/.+/)
    expect(sync.getStatus().readyGroups).toBe(2)
  })

  it('cancels an in-flight pass on revocation and never commits late responses', async () => {
    const repo = await openRepo()
    const namespace = namespaceFor()
    await repo.ensureControl(namespace)
    const catalog = makeCatalog(ACCOUNT, ['g1', 'g2'])
    let g2Calls = 0
    let releaseG1!: (value: ReturnType<typeof makeSnapshot>) => void
    const g1Gate = new Promise<ReturnType<typeof makeSnapshot>>((resolve) => {
      releaseG1 = resolve
    })
    let g1FetchStarted!: () => void
    const g1Started = new Promise<void>((resolve) => {
      g1FetchStarted = resolve
    })
    const sync = trackSync(
      createOfflineSync({
        namespace,
        repository: repo,
        verifySession: async () => true,
        fetchCatalog: async () => catalog,
        fetchSnapshot: async (groupId: string) => {
          if (groupId === 'g1') {
            g1FetchStarted()
            return g1Gate
          }
          g2Calls += 1
          return makeSnapshot(ACCOUNT, groupId)
        },
      }),
    )
    const pass = sync.handleLaunch()
    // Wait until g1 fetch starts (control revision already captured), then
    // revoke: bumps generation and fences the pass.
    await g1Started
    await repo.revokeNamespace({ namespace, generation: 0 })
    // Late response captured before revocation must not resurrect.
    releaseG1(makeSnapshot(ACCOUNT, 'g1'))
    await pass

    const control = await repo.readControl(namespace)
    expect(control?.revoked).toBe(true)
    expect(control?.generation).toBe(1)
    expect(await repo.readGroup(namespace, 'g1')).toEqual({ status: 'missing' })
    expect(g2Calls).toBe(0)
  })
})

describe('automatic caching', () => {
  it('retains the previous snapshot and stops automatic retries after a quota failure', async () => {
    const repo = await openRepo()
    const namespace = namespaceFor()
    await repo.ensureControl(namespace)
    await repo.commitGroup({
      namespace,
      generation: 0,
      expectedDataRevision: 0,
      snapshot: makeSnapshot(ACCOUNT, 'g1', ['original']),
    })
    vi.spyOn(repo, 'commitGroup').mockRejectedValue(
      new DOMException('full', 'QuotaExceededError'),
    )
    const fetchSnapshot = vi.fn(async (id: string) =>
      makeSnapshot(ACCOUNT, id, ['new']),
    )
    const sync = trackSync(
      createOfflineSync({
        namespace,
        repository: repo,
        verifySession: async () => true,
        fetchCatalog: async () => makeCatalog(ACCOUNT, ['g1']),
        fetchSnapshot,
      }),
    )
    await sync.handleLaunch()
    await sync.handleForeground()
    await sync.handleReconnect()
    expect(fetchSnapshot).toHaveBeenCalledTimes(1)
    expect(sync.getStatus().phase).toBe('quota-error')
    const saved = await repo.readGroup(namespace, 'g1')
    expect(saved.status).toBe('ready')
    if (saved.status !== 'ready') throw new Error('Expected retained snapshot')
    expect(saved.record.payload.expenses[0]?.list.id).toBe('original')
  })

  it.each([true, false])(
    'caches all groups after verification with legacy enabled=%s',
    async (enabled) => {
      const repo = await openRepo()
      const namespace = namespaceFor()
      await repo.ensureControl(namespace)
      await repo.commitGroup({
        namespace,
        generation: 0,
        expectedDataRevision: 0,
        snapshot: makeSnapshot(ACCOUNT, 'g1', ['saved']),
      })
      const raw = await openDB(OFFLINE_DB_NAME, OFFLINE_DB_VERSION)
      const original = await raw.get('control', namespace)
      await raw.put('control', { ...original, enabled })
      raw.close()
      const sync = trackSync(
        createOfflineSync({
          namespace,
          repository: repo,
          verifySession: async () => true,
          fetchCatalog: async () => makeCatalog(ACCOUNT, ['g1', 'g2']),
          fetchSnapshot: async (id) => {
            if (id === 'g1') {
              const saved = await repo.readGroup(namespace, id)
              expect(saved.status).toBe('ready')
              if (saved.status !== 'ready')
                throw new Error('Expected preserved snapshot')
              expect(saved.record.payload.expenses[0]?.list.id).toBe('saved')
            }
            return makeSnapshot(ACCOUNT, id)
          },
        }),
      )
      await sync.handleLaunch()
      expect(sync.getStatus().phase).toBe('done')
      expect((await repo.readGroup(namespace, 'g1')).status).toBe('ready')
      expect((await repo.readGroup(namespace, 'g2')).status).toBe('ready')
      expect((await repo.readControl(namespace))?.generation).toBe(
        original.generation,
      )
      expect((await repo.readControl(namespace))?.enabled).toBe(true)
    },
  )

  it('does not normalize disabled storage before successful verification', async () => {
    const repo = await openRepo()
    const namespace = namespaceFor()
    await repo.ensureControl(namespace)
    const raw = await openDB(OFFLINE_DB_NAME, OFFLINE_DB_VERSION)
    await raw.put('control', {
      ...(await raw.get('control', namespace)),
      enabled: false,
    })
    raw.close()
    const fetchCatalog = vi.fn()
    const sync = trackSync(
      createOfflineSync({
        namespace,
        repository: repo,
        verifySession: async () => false,
        fetchCatalog,
        fetchSnapshot: vi.fn(),
      }),
    )
    await sync.handleLaunch()
    expect((await repo.readControl(namespace))?.enabled).toBe(false)
    expect(fetchCatalog).not.toHaveBeenCalled()
  })
})

describe('offline sync fencing', () => {
  it('rejects a snapshot captured before a concurrent mutation (revision fencing)', async () => {
    const repo = await openRepo()
    const namespace = namespaceFor()
    await repo.ensureControl(namespace)
    const catalog = makeCatalog(ACCOUNT, ['g1'])
    await repo.replaceCatalog({
      namespace,
      generation: 0,
      expectedDataRevision: 0,
      catalog,
    })
    await repo.commitGroup({
      namespace,
      generation: 0,
      expectedDataRevision: 0,
      snapshot: makeSnapshot(ACCOUNT, 'g1', ['exp-1']),
    })

    let releaseFetch!: (value: ReturnType<typeof makeSnapshot>) => void
    const gate = new Promise<ReturnType<typeof makeSnapshot>>((resolve) => {
      releaseFetch = resolve
    })
    let fetchStarted!: () => void
    const started = new Promise<void>((resolve) => {
      fetchStarted = resolve
    })
    let fetchCount = 0
    const sync = trackSync(
      createOfflineSync({
        namespace,
        repository: repo,
        verifySession: async () => true,
        fetchCatalog: async () => catalog,
        fetchSnapshot: async (groupId: string) => {
          fetchCount += 1
          if (fetchCount === 1) {
            fetchStarted()
            return gate
          }
          return makeSnapshot(ACCOUNT, groupId, ['exp-1', 'exp-2'])
        },
      }),
    )
    const pass = sync.handleLaunch()
    // Wait until the snapshot fetch starts (revision already captured), then
    // fence with a concurrent online mutation.
    await started
    const control = await repo.readControl(namespace)
    await repo.markDirty({
      namespace,
      generation: control!.generation,
      dirtyGroupIds: ['g1'],
    })
    // Stale capture (without exp-2) must be rejected, never committed.
    releaseFetch(makeSnapshot(ACCOUNT, 'g1', ['exp-1']))
    await pass

    const group = await repo.readGroup(namespace, 'g1')
    expect(group.status).toBe('ready')
    if (group.status !== 'ready') throw new Error('expected group')
    // Pending rerun refreshed with the new revision and cleared dirtiness.
    expect(
      group.record.payload.expenses.map((record) => record.list.id).sort(),
    ).toEqual(['exp-1', 'exp-2'])
    expect(group.record.dirtySince).toBeNull()
  })

  it('never resurrects a deleted expense from an older snapshot response', async () => {
    const repo = await openRepo()
    const namespace = namespaceFor()
    await repo.ensureControl(namespace)
    const catalog = makeCatalog(ACCOUNT, ['g1'])
    await repo.replaceCatalog({
      namespace,
      generation: 0,
      expectedDataRevision: 0,
      catalog,
    })
    await repo.commitGroup({
      namespace,
      generation: 0,
      expectedDataRevision: 0,
      snapshot: makeSnapshot(ACCOUNT, 'g1', ['exp-1', 'exp-2']),
    })

    let releaseFetch!: (value: ReturnType<typeof makeSnapshot>) => void
    const gate = new Promise<ReturnType<typeof makeSnapshot>>((resolve) => {
      releaseFetch = resolve
    })
    let fetchStarted!: () => void
    const started = new Promise<void>((resolve) => {
      fetchStarted = resolve
    })
    let fetchCount = 0
    const sync = trackSync(
      createOfflineSync({
        namespace,
        repository: repo,
        verifySession: async () => true,
        fetchCatalog: async () => catalog,
        fetchSnapshot: async (groupId: string) => {
          fetchCount += 1
          if (fetchCount === 1) {
            fetchStarted()
            return gate
          }
          return makeSnapshot(ACCOUNT, groupId, ['exp-1'])
        },
      }),
    )
    const pass = sync.handleLaunch()
    await started
    // Successful online delete removes exp-2 atomically and fences revision.
    const control = await repo.readControl(namespace)
    await repo.deleteExpenseLocally({
      namespace,
      generation: control!.generation,
      groupId: 'g1',
      expenseId: 'exp-2',
    })
    // Older response still containing exp-2 must be rejected entirely.
    releaseFetch(makeSnapshot(ACCOUNT, 'g1', ['exp-1', 'exp-2']))
    await pass

    const group = await repo.readGroup(namespace, 'g1')
    expect(group.status).toBe('ready')
    if (group.status !== 'ready') throw new Error('expected group')
    expect(
      group.record.payload.expenses.map((record) => record.list.id),
    ).toEqual(['exp-1'])
  })

  it('cancels remaining work when the lease is lost mid-pass', async () => {
    const repo = await openRepo()
    const namespace = namespaceFor()
    await repo.ensureControl(namespace)
    const catalog = makeCatalog(ACCOUNT, ['g1', 'g2'])
    let releaseG2!: (value: ReturnType<typeof makeSnapshot>) => void
    const g2Gate = new Promise<ReturnType<typeof makeSnapshot>>((resolve) => {
      releaseG2 = resolve
    })
    let g2Started!: () => void
    const g2FetchStarted = new Promise<void>((resolve) => {
      g2Started = resolve
    })
    const sync = trackSync(
      createOfflineSync({
        namespace,
        repository: repo,
        verifySession: async () => true,
        fetchCatalog: async () => catalog,
        fetchSnapshot: async (groupId: string) => {
          if (groupId === 'g1') return makeSnapshot(ACCOUNT, groupId)
          g2Started()
          return g2Gate
        },
      }),
    )
    const pass = sync.handleLaunch()
    // g2 fetch starts only after g1 committed, so stealing now fences g2.
    await g2FetchStarted
    // Intruder steals the lease inside the same generation.
    const raw = await openDB(OFFLINE_DB_NAME, OFFLINE_DB_VERSION)
    const control = await raw.get('control', namespace)
    await raw.put('control', {
      ...control,
      leaseOwner: 'intruder-tab',
      leaseUntil: Date.now() + 30_000,
    })
    raw.close()

    releaseG2(makeSnapshot(ACCOUNT, 'g2'))
    await pass

    // g1 completed before the loss; g2 never commits from the fenced owner.
    expect((await repo.readGroup(namespace, 'g1')).status).toBe('ready')
    expect(await repo.readGroup(namespace, 'g2')).toEqual({ status: 'missing' })
    expect(sync.getStatus().phase).toBe('cancelled')
  })
})

describe('offline sync Retry-After parsing', () => {
  it('parses delay-seconds, dates, missing, invalid, and past values', () => {
    const now = Date.parse('2026-09-18T12:00:00.000Z')
    expect(parseRetryAfterMs('120', now)).toBe(120_000)
    expect(parseRetryAfterMs('0', now)).toBe(0)
    expect(parseRetryAfterMs('60', now)).toBe(60_000)
    const future = new Date(now + 90_000).toUTCString()
    expect(parseRetryAfterMs(future, now)).toBe(90_000)
    expect(parseRetryAfterMs(null, now)).toBe(OFFLINE_SYNC_MAX_RETRY_AFTER_MS)
    expect(parseRetryAfterMs(undefined, now)).toBe(
      OFFLINE_SYNC_MAX_RETRY_AFTER_MS,
    )
    expect(parseRetryAfterMs('', now)).toBe(OFFLINE_SYNC_MAX_RETRY_AFTER_MS)
    expect(parseRetryAfterMs('not-a-date', now)).toBe(
      OFFLINE_SYNC_MAX_RETRY_AFTER_MS,
    )
    const past = new Date(now - 5_000).toUTCString()
    expect(parseRetryAfterMs(past, now)).toBe(0)
  })
})

describe('offline sync rate limiting', () => {
  it('retries catalog 429 <=60s once then succeeds', async () => {
    const repo = await openRepo()
    const namespace = namespaceFor()
    await repo.ensureControl(namespace)
    const catalog = makeCatalog(ACCOUNT, ['g1'])
    let catalogCalls = 0
    const sleeps: number[] = []
    const sync = trackSync(
      createOfflineSync({
        namespace,
        repository: repo,
        verifySession: async () => true,
        fetchCatalog: async () => {
          catalogCalls += 1
          if (catalogCalls === 1) throw { status: 429, retryAfter: '1' }
          return catalog
        },
        fetchSnapshot: async (groupId: string) =>
          makeSnapshot(ACCOUNT, groupId),
        sleep: async (ms: number) => {
          sleeps.push(ms)
        },
      }),
    )
    await sync.handleLaunch()
    expect(catalogCalls).toBe(2)
    expect(sleeps).toEqual([1000])
    expect(sync.getStatus().phase).toBe('done')
    expect((await repo.readGroup(namespace, 'g1')).status).toBe('ready')
  })

  it('fails catalog after two 429s instead of sticking in catalog phase', async () => {
    const repo = await openRepo()
    const namespace = namespaceFor()
    await repo.ensureControl(namespace)
    let catalogCalls = 0
    const sync = trackSync(
      createOfflineSync({
        namespace,
        repository: repo,
        verifySession: async () => true,
        fetchCatalog: async () => {
          catalogCalls += 1
          throw { status: 429, retryAfter: '1' }
        },
        fetchSnapshot: async (groupId: string) =>
          makeSnapshot(ACCOUNT, groupId),
        sleep: async () => undefined,
      }),
    )
    await sync.handleLaunch()
    expect(catalogCalls).toBe(2)
    expect(sync.getStatus().phase).toBe('failed')
    expect(sync.getStatus().phase).not.toBe('catalog')
  })

  it('ends catalog 429 >60s with phase rate-limited + earliestRetryAt', async () => {
    const repo = await openRepo()
    const namespace = namespaceFor()
    await repo.ensureControl(namespace)
    let currentTime = Date.now()
    let snapshotCalls = 0
    const sync = trackSync(
      createOfflineSync({
        namespace,
        repository: repo,
        verifySession: async () => true,
        fetchCatalog: async () => {
          throw { status: 429, retryAfter: '120' }
        },
        fetchSnapshot: async () => {
          snapshotCalls += 1
          return makeSnapshot(ACCOUNT, 'g1')
        },
        now: () => currentTime,
        sleep: async () => undefined,
      }),
    )
    await sync.handleLaunch()
    expect(sync.getStatus().phase).toBe('rate-limited')
    expect(sync.getEarliestRetryAt()).toBe(currentTime + 120_000)
    expect(sync.getStatus().earliestRetryAt).toBe(currentTime + 120_000)
    expect(snapshotCalls).toBe(0)
  })

  it('retries group 429 <=60s once then succeeds', async () => {
    const repo = await openRepo()
    const namespace = namespaceFor()
    await repo.ensureControl(namespace)
    const catalog = makeCatalog(ACCOUNT, ['g1'])
    const calls = new Map<string, number>()
    const sleeps: number[] = []
    const sync = trackSync(
      createOfflineSync({
        namespace,
        repository: repo,
        verifySession: async () => true,
        fetchCatalog: async () => catalog,
        fetchSnapshot: async (groupId: string) => {
          calls.set(groupId, (calls.get(groupId) ?? 0) + 1)
          if ((calls.get(groupId) ?? 0) === 1)
            throw { status: 429, retryAfter: '1' }
          return makeSnapshot(ACCOUNT, groupId)
        },
        sleep: async (ms: number) => {
          sleeps.push(ms)
        },
      }),
    )
    await sync.handleLaunch()
    expect(calls.get('g1')).toBe(2)
    expect(sleeps).toEqual([1000])
    expect(sync.getStatus().phase).toBe('done')
    expect((await repo.readGroup(namespace, 'g1')).status).toBe('ready')
  })

  it('records second group 429 <=60s as error and continues', async () => {
    const repo = await openRepo()
    const namespace = namespaceFor()
    await repo.ensureControl(namespace)
    const catalog = makeCatalog(ACCOUNT, ['g-fail', 'g-ok'])
    const calls = new Map<string, number>()
    const sync = trackSync(
      createOfflineSync({
        namespace,
        repository: repo,
        verifySession: async () => true,
        fetchCatalog: async () => catalog,
        fetchSnapshot: async (groupId: string) => {
          calls.set(groupId, (calls.get(groupId) ?? 0) + 1)
          if (groupId === 'g-fail') throw { status: 429, retryAfter: '1' }
          return makeSnapshot(ACCOUNT, groupId)
        },
        sleep: async () => undefined,
      }),
    )
    await sync.handleLaunch()
    expect(calls.get('g-fail')).toBe(2)
    expect(calls.get('g-ok')).toBe(1)
    expect(sync.getStatus().errors['g-fail']).toBe('rate-limited')
    expect((await repo.readGroup(namespace, 'g-ok')).status).toBe('ready')
    expect(sync.getStatus().phase).toBe('failed')
  })

  it('ends pass on group 429 >60s with rate-limited and skips remaining', async () => {
    const repo = await openRepo()
    const namespace = namespaceFor()
    await repo.ensureControl(namespace)
    const catalog = makeCatalog(ACCOUNT, ['g1', 'g2'])
    let currentTime = Date.now()
    const calls = new Map<string, number>()
    const sync = trackSync(
      createOfflineSync({
        namespace,
        repository: repo,
        verifySession: async () => true,
        fetchCatalog: async () => catalog,
        fetchSnapshot: async (groupId: string) => {
          calls.set(groupId, (calls.get(groupId) ?? 0) + 1)
          if (groupId === 'g1') throw { status: 429, retryAfter: '120' }
          return makeSnapshot(ACCOUNT, groupId)
        },
        now: () => currentTime,
        sleep: async () => undefined,
      }),
    )
    await sync.handleLaunch()
    expect(calls.get('g1')).toBe(1)
    // Pass ends: remaining groups never start.
    expect(calls.get('g2') ?? 0).toBe(0)
    expect(sync.getStatus().phase).toBe('rate-limited')
    expect(sync.getStatus().errors['g1']).toBe('rate-limited')
    expect(sync.getEarliestRetryAt()).toBe(currentTime + 120_000)
    expect(sync.getStatus().earliestRetryAt).toBe(currentTime + 120_000)
  })

  it('blocks full and targeted launches before deadline, allows post-deadline retry', async () => {
    const repo = await openRepo()
    const namespace = namespaceFor()
    await repo.ensureControl(namespace)
    const catalog = makeCatalog(ACCOUNT, ['g1', 'g2'])
    let currentTime = Date.now()
    let catalogCalls = 0
    let snapshotCalls = 0
    const sync = trackSync(
      createOfflineSync({
        namespace,
        repository: repo,
        verifySession: async () => true,
        fetchCatalog: async () => {
          catalogCalls += 1
          return catalog
        },
        fetchSnapshot: async (groupId: string) => {
          snapshotCalls += 1
          if (snapshotCalls === 1) throw { status: 429, retryAfter: '120' }
          return makeSnapshot(ACCOUNT, groupId)
        },
        now: () => currentTime,
        sleep: async () => undefined,
      }),
    )
    await sync.handleLaunch()
    expect(sync.getStatus().phase).toBe('rate-limited')
    const deadline = sync.getEarliestRetryAt()
    expect(deadline).toBe(currentTime + 120_000)
    const catalogAfterFirst = catalogCalls
    // Launch before deadline is blocked: no new catalog fetch.
    await sync.handleLaunch()
    expect(catalogCalls).toBe(catalogAfterFirst)
    expect(sync.getStatus().phase).toBe('rate-limited')
    // Targeted before deadline is also blocked.
    await sync.requestSync({
      kind: 'targeted',
      groupIds: ['g2'],
      triggerKind: 'mutation',
    })
    expect(catalogCalls).toBe(catalogAfterFirst)
    // Advance past deadline: retry proceeds and clears earliestRetryAt.
    currentTime += 121_000
    await sync.handleLaunch()
    expect(catalogCalls).toBeGreaterThan(catalogAfterFirst)
    expect(sync.getStatus().phase).toBe('done')
    expect(sync.getEarliestRetryAt()).toBeNull()
    expect(sync.getStatus().earliestRetryAt).toBeNull()
  })

  it('automatically retries transient failures after backoff', async () => {
    const repo = await openRepo()
    const namespace = namespaceFor()
    await repo.ensureControl(namespace)
    // A retry waits once before repeating the failed request.
    {
      const catalog = makeCatalog(ACCOUNT, ['g1'])
      const calls = new Map<string, number>()
      const sleeps: number[] = []
      const sync = trackSync(
        createOfflineSync({
          namespace,
          repository: repo,
          verifySession: async () => true,
          fetchCatalog: async () => catalog,
          fetchSnapshot: async (groupId: string) => {
            calls.set(groupId, (calls.get(groupId) ?? 0) + 1)
            if ((calls.get(groupId) ?? 0) === 1) throw { status: 500 }
            return makeSnapshot(ACCOUNT, groupId)
          },
          sleep: async (ms: number) => {
            sleeps.push(ms)
          },
        }),
      )
      await sync.handleLaunch()
      expect(calls.get('g1')).toBe(2)
      expect(sleeps).toEqual([OFFLINE_SYNC_GROUP_RETRY_DELAY_MS])
    }
  })
})

describe('offline sync retry persistence', () => {
  it('retries persisted failures after reload loses in-memory errors', async () => {
    const repo = await openRepo()
    const namespace = namespaceFor()
    await repo.ensureControl(namespace)
    const catalog = makeCatalog(ACCOUNT, ['g-fail', 'g-ok'])
    const firstCalls = new Map<string, number>()
    const syncA = trackSync(
      createOfflineSync({
        namespace,
        repository: repo,
        verifySession: async () => true,
        fetchCatalog: async () => catalog,
        fetchSnapshot: async (groupId: string) => {
          firstCalls.set(groupId, (firstCalls.get(groupId) ?? 0) + 1)
          if (groupId === 'g-fail') throw { status: 500 }
          return makeSnapshot(ACCOUNT, groupId)
        },
        sleep: async () => undefined,
      }),
    )
    await syncA.handleLaunch()
    expect(firstCalls.get('g-fail')).toBe(2)
    expect(syncA.getStatus().errors['g-fail']).toMatch(/.+/)
    const persisted = await repo.listGroupStatus(namespace)
    expect(persisted.find((row) => row.groupId === 'g-fail')?.lastResult).toBe(
      'error',
    )
    // Reload: new sync instance has empty in-memory errors.
    const secondCalls: string[] = []
    const syncB = trackSync(
      createOfflineSync({
        namespace,
        repository: repo,
        verifySession: async () => true,
        fetchCatalog: async () => catalog,
        fetchSnapshot: async (groupId: string) => {
          secondCalls.push(groupId)
          return makeSnapshot(ACCOUNT, groupId)
        },
        sleep: async () => undefined,
      }),
    )
    expect(syncB.getStatus().errors).toEqual({})
    await syncB.handleLaunch()
    expect(secondCalls).toContain('g-fail')
    expect((await repo.readGroup(namespace, 'g-fail')).status).toBe('ready')
    expect(syncB.getStatus().phase).toBe('done')
  })
})

describe('offline sync triggers, visibility, and classification', () => {
  it('handleForeground respects the 5-min rule and never polls while active', async () => {
    const repo = await openRepo()
    const namespace = namespaceFor()
    await repo.ensureControl(namespace)
    const catalog = makeCatalog(ACCOUNT, ['g1'])
    let currentTime = Date.now()
    let catalogCalls = 0
    const sync = trackSync(
      createOfflineSync({
        namespace,
        repository: repo,
        verifySession: async () => true,
        fetchCatalog: async () => {
          catalogCalls += 1
          return catalog
        },
        fetchSnapshot: async (groupId: string) =>
          makeSnapshot(ACCOUNT, groupId),
        now: () => currentTime,
      }),
    )
    await sync.handleLaunch()
    expect(catalogCalls).toBe(1)
    expect(sync.getLastCompletedFullPassAt()).toBe(currentTime)
    // Within 5min: no new pass.
    currentTime += 60_000
    await sync.handleForeground()
    expect(catalogCalls).toBe(1)
    // Past 5min: foreground triggers a full pass.
    currentTime += OFFLINE_SYNC_FOREGROUND_STALE_MS
    await sync.handleForeground()
    expect(catalogCalls).toBe(2)
  })

  it('does not overlap passes when foreground arrives mid-pass', async () => {
    const repo = await openRepo()
    const namespace = namespaceFor()
    await repo.ensureControl(namespace)
    const catalog = makeCatalog(ACCOUNT, ['g1'])
    let release!: (v: ReturnType<typeof makeSnapshot>) => void
    const gate = new Promise<ReturnType<typeof makeSnapshot>>((res) => {
      release = res
    })
    let started!: () => void
    const startedP = new Promise<void>((res) => {
      started = res
    })
    let catalogCalls = 0
    const sync = trackSync(
      createOfflineSync({
        namespace,
        repository: repo,
        verifySession: async () => true,
        fetchCatalog: async () => {
          catalogCalls += 1
          return catalog
        },
        fetchSnapshot: async () => {
          started()
          return gate
        },
      }),
    )
    const first = sync.handleLaunch()
    await startedP
    // Foreground while active coalesces to one pending rerun, never overlaps.
    const second = sync.handleForeground()
    release(makeSnapshot(ACCOUNT, 'g1'))
    await first
    await second
    expect(catalogCalls).toBeLessThanOrEqual(2)
    expect(sync.getStatus().phase).not.toBe('downloading')
  })

  it('handleMutationSuccess uses targeted for ids and full otherwise', async () => {
    const repo = await openRepo()
    const namespace = namespaceFor()
    await repo.ensureControl(namespace)
    const catalog = makeCatalog(ACCOUNT, ['g1', 'g2', 'g3'])
    const fetched: string[] = []
    const sync = trackSync(
      createOfflineSync({
        namespace,
        repository: repo,
        verifySession: async () => true,
        fetchCatalog: async () => catalog,
        fetchSnapshot: async (groupId: string) => {
          fetched.push(groupId)
          return makeSnapshot(ACCOUNT, groupId)
        },
      }),
    )
    await sync.handleMutationSuccess({ groupIds: ['g2'] })
    expect(fetched).toEqual(['g2'])
    fetched.length = 0
    await sync.handleMutationSuccess()
    expect([...fetched].sort()).toEqual(['g1', 'g2', 'g3'])
  })

  it('handleWriteUnknownOutcome refreshes reads without replaying the write', async () => {
    const repo = await openRepo()
    const namespace = namespaceFor()
    await repo.ensureControl(namespace)
    const catalog = makeCatalog(ACCOUNT, ['g1', 'g2'])
    const fetched: string[] = []
    const sync = trackSync(
      createOfflineSync({
        namespace,
        repository: repo,
        verifySession: async () => true,
        fetchCatalog: async () => catalog,
        fetchSnapshot: async (groupId: string) => {
          fetched.push(groupId)
          return makeSnapshot(ACCOUNT, groupId)
        },
      }),
    )
    await sync.handleWriteUnknownOutcome({ groupIds: ['g1'] })
    // Targeted refresh only, no write replay (no throw, only reads fetched).
    expect(fetched).toEqual(['g1'])
    expect((await repo.readGroup(namespace, 'g1')).status).toBe('ready')
    fetched.length = 0
    await sync.handleWriteUnknownOutcome()
    expect([...fetched].sort()).toEqual(['g1', 'g2'])
  })

  it('waits for visible before catalog fetch', async () => {
    const repo = await openRepo()
    const namespace = namespaceFor()
    await repo.ensureControl(namespace)
    const catalog = makeCatalog(ACCOUNT, ['g1'])
    let visible = false
    let waitCalls = 0
    let catalogCalls = 0
    const sync = trackSync(
      createOfflineSync({
        namespace,
        repository: repo,
        verifySession: async () => true,
        fetchCatalog: async () => {
          catalogCalls += 1
          return catalog
        },
        fetchSnapshot: async (groupId: string) =>
          makeSnapshot(ACCOUNT, groupId),
        isVisible: () => visible,
        waitForVisible: async () => {
          waitCalls += 1
          visible = true
        },
      }),
    )
    await sync.handleLaunch()
    expect(waitCalls).toBe(1)
    expect(catalogCalls).toBe(1)
    expect(sync.getStatus().phase).toBe('done')
  })

  it('pauses on connectivity failure and notifies', async () => {
    const repo = await openRepo()
    const namespace = namespaceFor()
    await repo.ensureControl(namespace)
    const notified: unknown[] = []
    const sync = trackSync(
      createOfflineSync({
        namespace,
        repository: repo,
        verifySession: async () => true,
        fetchCatalog: async () => {
          throw new TypeError('Failed to fetch')
        },
        fetchSnapshot: async (groupId: string) =>
          makeSnapshot(ACCOUNT, groupId),
        onConnectivityFailure: (error: unknown) => {
          notified.push(error)
        },
      }),
    )
    await sync.handleLaunch()
    expect(sync.getStatus().phase).toBe('paused-connectivity')
    expect(notified.length).toBe(1)
  })

  it('pauses group downloads on connectivity failure', async () => {
    const repo = await openRepo()
    const namespace = namespaceFor()
    await repo.ensureControl(namespace)
    const catalog = makeCatalog(ACCOUNT, ['g1', 'g2'])
    const calls: string[] = []
    let notified = 0
    const sync = trackSync(
      createOfflineSync({
        namespace,
        repository: repo,
        verifySession: async () => true,
        fetchCatalog: async () => catalog,
        fetchSnapshot: async (groupId: string) => {
          calls.push(groupId)
          throw new TypeError('Load failed')
        },
        onConnectivityFailure: () => {
          notified += 1
        },
      }),
    )
    await sync.handleLaunch()
    expect(sync.getStatus().phase).toBe('paused-connectivity')
    expect(notified).toBe(1)
    expect(calls.length).toBe(1)
  })

  it('classifies TimeoutError as transient and AbortError as cancelled', () => {
    const now = Date.now()
    expect(
      classifySyncError(
        new DOMException('Snapshot timeout', 'TimeoutError'),
        now,
      ),
    ).toEqual({ kind: 'transient', code: 'timeout' })
    expect(
      classifySyncError(new DOMException('Aborted', 'AbortError'), now),
    ).toEqual({ kind: 'cancelled' })
  })

  it('retries TimeoutError once then succeeds', async () => {
    const repo = await openRepo()
    const namespace = namespaceFor()
    await repo.ensureControl(namespace)
    const catalog = makeCatalog(ACCOUNT, ['g1'])
    let calls = 0
    const sync = trackSync(
      createOfflineSync({
        namespace,
        repository: repo,
        verifySession: async () => true,
        fetchCatalog: async () => catalog,
        fetchSnapshot: async (groupId: string) => {
          calls += 1
          if (calls === 1)
            throw new DOMException('Snapshot timeout', 'TimeoutError')
          return makeSnapshot(ACCOUNT, groupId)
        },
        sleep: async () => undefined,
      }),
    )
    await sync.handleLaunch()
    expect(calls).toBe(2)
    expect(sync.getStatus().phase).toBe('done')
  })

  it('never retries schema, auth, or access failures', async () => {
    for (const error of [
      { data: { code: 'BAD_REQUEST' } },
      { data: { code: 'UNAUTHORIZED' } },
      { data: { code: 'FORBIDDEN' } },
      { status: 404 },
    ]) {
      const repo = await openRepo()
      const accountId = `account-${Math.random().toString(36).slice(2)}`
      const namespace = namespaceFor(accountId)
      await repo.ensureControl(namespace)
      const matching = makeCatalog(accountId, ['g1'])
      let calls = 0
      const sleeps: number[] = []
      const sync = trackSync(
        createOfflineSync({
          namespace,
          repository: repo,
          verifySession: async () => true,
          fetchCatalog: async () => matching,
          fetchSnapshot: async () => {
            calls += 1
            throw error
          },
          sleep: async (ms: number) => {
            sleeps.push(ms)
          },
        }),
      )
      await sync.handleLaunch()
      expect(calls).toBe(1)
      expect(sleeps).toEqual([])
      expect(Object.keys(sync.getStatus().errors)).toContain('g1')
    }
  })
})
