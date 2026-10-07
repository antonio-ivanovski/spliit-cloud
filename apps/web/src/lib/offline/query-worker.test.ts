import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import 'fake-indexeddb/auto'

import type { OfflineSnapshotOutput } from '@spliit/api/offline-contract'

import type { CatalogRecord, GroupRecord } from './contract'
import { OfflineDexieDatabase, deleteOfflineDatabaseForTests } from './database'
import {
  OFFLINE_WORKER_REQUEST_TIMEOUT_MS,
  createOfflineQueryClient,
  dropWorkerWorkingSet,
  runOfflineWorkerQuery,
} from './query-worker'
import {
  OFFLINE_FALLBACK_CHUNK_ROWS,
  queryGlobalExpensesOffline,
  queryGlobalExpensesOfflineChunked,
  queryGroupExpensesOffline,
} from './read-model'

function snapshot(groupId: string, ids: string[]): OfflineSnapshotOutput {
  return {
    schemaVersion: 2,
    accountId: 'account-a',
    groupId,
    capturedAt: new Date('2026-03-08T12:00:00.000Z'),
    group: {
      group: { participants: [], members: [] },
      displayName: groupId,
      currentLedgerParticipantId: null,
      currentMember: null,
      currentInvitation: null,
      linkInviteState: null,
      viewer: {
        source: 'MEMBER',
        access: 'READ_WRITE',
        canMutate: true,
        canAcceptInvitation: false,
      },
      hasSavedView: false,
    },
    overview: {
      id: groupId,
      name: groupId,
      information: null,
      archived: false,
      createdAt: new Date().toISOString(),
      groupType: 'GROUP',
      ledger: { currency: 'USD', currencyCode: 'USD' },
      memberCount: 1,
      currentMemberRole: 'MEMBER',
      preference: { starred: false, hidden: false },
      displayName: groupId,
      friendAccount: null,
      memberAccounts: [],
      financialSummary: {
        expenseCount: ids.length,
        netBalance: 0,
        state: 'SETTLED',
        latestExpenseCreatedAt: null,
      },
      access: 'MEMBER',
      viewKey: null,
      lastOpenedAt: null,
    },
    global: {
      id: groupId,
      name: groupId,
      archived: false,
      hidden: false,
      groupType: 'GROUP',
      displayName: groupId,
      currency: 'USD',
      currencyCode: 'USD',
      participantCount: 1,
    },
    balances: {
      balances: {},
      suggestedSettlements: [],
      currencyBalances: [],
      participants: [],
      settlement: {
        subgroup: { units: [], legs: [], hasInternalBalances: false },
        individual: { suggestedSettlements: [], policy: 'standard' },
      },
    },
    expenses: ids.map((id) => ({
      list: {
        id,
        title: `Expense ${id}`,
        amount: 100,
        expenseDate: new Date('2026-03-01T12:00:00.000Z'),
        expenseTimeZone: 'UTC',
        categoryId: 'groceries',
        category: { id: 'groceries', grouping: 'food', name: 'Groceries' },
        splitMode: 'EVENLY',
        paidBySplitMode: 'EVENLY',
        originalAmount: null,
        originalCurrency: null,
        conversionRate: null,
        conversionSource: null,
        originType: null,
        recurrenceSequence: null,
        items: [],
        createdAt: new Date('2026-03-01T13:00:00.000Z'),
        paidByList: [],
        paidFor: [],
        recurringSeriesId: null,
        recurringSeriesStatus: null,
        documentCount: 0,
        permissions: {
          canEdit: false,
          canDelete: false,
          canManageRecurrence: false,
        },
      },
      detail: {
        id,
        title: `Expense ${id}`,
        amount: 100,
        expenseDate: new Date('2026-03-01T12:00:00.000Z'),
        expenseTimeZone: 'UTC',
        categoryId: 'groceries',
        category: { id: 'groceries', grouping: 'food', name: 'Groceries' },
        splitMode: 'EVENLY',
        paidBySplitMode: 'EVENLY',
        originalAmount: null,
        originalCurrency: null,
        conversionRate: null,
        conversionSource: null,
        originType: null,
        recurrenceSequence: null,
        version: 1,
        createdAt: new Date('2026-03-01T13:00:00.000Z'),
        notes: null,
        documents: [],
        comments: [],
        paidByList: [],
        paidFor: [],
        items: [],
        itemizedRemainder: null,
        recurringSeriesId: null,
        recurringSeries: null,
        recurrence: null,
        previousExpenseId: null,
        nextExpenseId: null,
        permissions: {
          canEdit: false,
          canDelete: false,
          canManageRecurrence: false,
        },
      },
    })),
    totalCount: ids.length,
    downloadedCount: ids.length,
    hasMore: false,
    truncatedAt: null,
    budgets: [],
    splitPresets: {
      presets: [],
      canManageShared: false,
      canManagePersonal: false,
      groupDefaults: { paidByPresetId: null, paidForPresetId: null },
      personalDefaults: {
        paidBy: { mode: 'INHERIT', presetId: null },
        paidFor: { mode: 'INHERIT', presetId: null },
      },
      effectiveDefaults: { paidByPresetId: null, paidForPresetId: null },
    },
    subgroups: { enabled: false, subgroups: [] },
    activities: [],
    activityTotalCount: 0,
    activityHasMore: false,
  } as unknown as OfflineSnapshotOutput
}

function groupRecord(
  groupId: string,
  snap: OfflineSnapshotOutput,
): GroupRecord {
  return {
    namespace: 'ns',
    groupId,
    schemaVersion: 1,
    capturedAt: new Date(),
    storedAt: new Date(),
    commitNonce: `nonce-${groupId}`,
    dirtySince: null,
    payload: snap,
  }
}

async function seedSnapshots(snaps: OfflineSnapshotOutput[]): Promise<void> {
  const db = new OfflineDexieDatabase()
  await db.open()
  try {
    await db.catalogs.put({
      namespace: 'ns',
      capturedAt: new Date(),
      schemaVersion: 2,
      groups: snaps.map((snap) => ({
        overview: snap.overview,
        global: snap.global,
        revision: 'o2.c0.v0',
      })),
    })
    for (const snap of snaps) {
      const groupId = snap.groupId
      await db.groupMeta.put({
        namespace: 'ns',
        groupId,
        schemaVersion: 1,
        serverRevision: 'o2.c0.v0',
        capturedAt: snap.capturedAt,
        storedAt: new Date(),
        commitNonce: `nonce-${groupId}`,
        dirtySince: null,
        lastConfirmedAt: new Date(),
        totalCount: snap.expenses.length,
        hasMore: false,
        truncatedAt: null,
      })
      await db.groupData.put({
        namespace: 'ns',
        groupId,
        data: {
          group: snap.group,
          overview: snap.overview,
          global: snap.global,
          balances: snap.balances,
          subgroups: snap.subgroups,
          splitPresets: snap.splitPresets,
          budgets: snap.budgets,
          activities: snap.activities,
          activityTotalCount: snap.activityTotalCount,
          activityHasMore: snap.activityHasMore,
        },
      })
      await db.expenseList.bulkPut(
        snap.expenses.map((entry) => ({
          namespace: 'ns',
          groupId,
          id: entry.list.id,
          expenseDateMs: new Date(entry.list.expenseDate).getTime(),
          createdAtMs: new Date(entry.list.createdAt).getTime(),
          amount: entry.list.amount,
          categoryId: entry.list.categoryId,
          record: entry.list,
        })),
      )
      await db.expenseDetail.bulkPut(
        snap.expenses.map((entry) => ({
          namespace: 'ns',
          groupId,
          id: entry.detail.id,
          record: entry.detail,
        })),
      )
    }
  } finally {
    db.close()
  }
}

describe('offline query worker', () => {
  beforeEach(async () => {
    await deleteOfflineDatabaseForTests()
    dropWorkerWorkingSet()
  })

  afterEach(async () => {
    dropWorkerWorkingSet()
    await deleteOfflineDatabaseForTests()
  })

  it('answers group queries from Dexie without posted histories', async () => {
    const snap = snapshot('g1', ['a', 'b'])
    await seedSnapshots([snap])
    const result = (await runOfflineWorkerQuery({
      requestId: 'req-1',
      generation: 7,
      namespace: 'ns',
      kind: 'group-expenses',
      groupId: 'g1',
    })) as {
      rows: Array<{ list: { id: string }; detail: { id: string } }>
      totalFiltered: number
      serverRevision: string | null
    }
    expect(result.totalFiltered).toBe(2)
    expect(result.rows.map((row) => row.list.id).sort()).toEqual(['a', 'b'])
    // Bounded page carries detail twins; the revision pins pagination.
    expect(result.rows).toHaveLength(2)
    expect(result.rows[0]?.detail.id).toBe(result.rows[0]?.list.id)
    expect(result.serverRevision).toBe('o2.c0.v0')
    // Parity with the pure snapshot engine over the same payload.
    const pure = queryGroupExpensesOffline(snap, {})
    expect(pure.totalFiltered).toBe(result.totalFiltered)
    expect(pure.rows.map((row) => row.list.id).sort()).toEqual(['a', 'b'])
  })

  it('reports truthful totals freshness from confirmations', async () => {
    await seedSnapshots([snapshot('g1', ['a']), snapshot('g2', ['b'])])
    const fresh = (await runOfflineWorkerQuery({
      requestId: 'req-fresh',
      generation: 1,
      namespace: 'ns',
      kind: 'overview',
    })) as { totalsFreshness: string }
    expect(fresh.totalsFreshness).toBe('fresh')
    // Age one confirmation past the threshold: last-known totals warn.
    const db = new OfflineDexieDatabase()
    await db.open()
    try {
      const meta = await db.groupMeta.get(['ns', 'g1'])
      await db.groupMeta.put({
        ...meta!,
        lastConfirmedAt: new Date(Date.now() - 10 * 60_000),
      })
    } finally {
      db.close()
    }
    const aged = (await runOfflineWorkerQuery({
      requestId: 'req-aged',
      generation: 1,
      namespace: 'ns',
      kind: 'overview',
    })) as {
      totalsFreshness: string
      groups: Array<{ id: string; stale?: boolean }>
    }
    expect(aged.totalsFreshness).toBe('stale')
    expect(aged.groups.find((g) => g.id === 'g1')?.stale).toBe(true)
    expect(aged.groups.find((g) => g.id === 'g2')?.stale).toBe(false)
  })

  it('reads current Dexie state on every query (no stale working set)', async () => {
    await seedSnapshots([snapshot('g1', ['a'])])
    const first = (await runOfflineWorkerQuery({
      requestId: 'req-1',
      generation: 1,
      namespace: 'ns',
      kind: 'group-expenses',
      groupId: 'g1',
    })) as { totalFiltered: number }
    expect(first.totalFiltered).toBe(1)
    // Another tab commits: the stateless engine observes it on the next
    // query instead of serving a cached working set.
    const db = new OfflineDexieDatabase()
    await db.open()
    try {
      await db.expenseList.put({
        namespace: 'ns',
        groupId: 'g1',
        id: 'b',
        expenseDateMs: 1,
        createdAtMs: 1,
        amount: 100,
        categoryId: 'groceries',
        record: { id: 'b' },
      } as never)
    } finally {
      db.close()
    }
    const second = (await runOfflineWorkerQuery({
      requestId: 'req-2',
      generation: 1,
      namespace: 'ns',
      kind: 'group-expenses',
      groupId: 'g1',
    })) as { totalFiltered: number }
    expect(second.totalFiltered).toBe(2)
    // Foreign namespaces stay isolated.
    const foreign = (await runOfflineWorkerQuery({
      requestId: 'req-3',
      generation: 1,
      namespace: 'other',
      kind: 'group-expenses',
      groupId: 'g1',
    })) as { totalFiltered: number; serverRevision: null }
    expect(foreign.totalFiltered).toBe(0)
    expect(foreign.serverRevision).toBeNull()
  })

  it('rejects with OfflineWorkerUnavailableError when no worker is available', async () => {
    // Worker use is mandatory: a missing worker rejects
    // instead of silently filtering on the main thread.
    const client = createOfflineQueryClient({ createWorker: () => null })
    const snap = groupRecord('g1', snapshot('g1', ['a']))
    await expect(
      client.query({
        generation: 1,
        namespace: 'ns',
        kind: 'group-expenses',
        groupId: 'g1',
        filter: { search: 'Expense' },
        snapshot: snap,
      }),
    ).rejects.toMatchObject({ name: 'OfflineWorkerUnavailableError' })
    // The explicit test-only chunked entry still answers the same query.
    expect(OFFLINE_FALLBACK_CHUNK_ROWS).toBe(500)
    const ids = Array.from({ length: 1200 }, (_, index) => `exp-${index}`)
    const big = groupRecord('g1', snapshot('g1', ids))
    const result = (await client.fallback({
      requestId: 'req-fallback',
      generation: 1,
      namespace: 'ns',
      kind: 'group-expenses',
      groupId: 'g1',
      filter: { search: 'Expense' },
      snapshot: big,
    })) as { rows: unknown[]; totalFiltered: number }
    expect(result.totalFiltered).toBe(1200)
    expect(result.rows).toHaveLength(20)
    client.dispose()
  })

  it('discards obsolete generations without resolving stale replies', async () => {
    let postMessage:
      | ((message: { requestId: string; generation: number }) => void)
      | null = null
    const fakeWorker = {
      onmessage: null as ((event: { data: unknown }) => void) | null,
      postMessage: (_message: unknown) => undefined,
      terminate: () => undefined,
    }
    const client = createOfflineQueryClient({
      createWorker: () => {
        postMessage = (message) => {
          // Never answer: the pending request must be discardable.
          void message
        }
        return {
          ...fakeWorker,
          postMessage: (message: { requestId: string; generation: number }) => {
            postMessage?.(message)
          },
          set onmessage(handler: ((event: { data: unknown }) => void) | null) {
            fakeWorker.onmessage = handler as never
          },
          get onmessage() {
            return fakeWorker.onmessage
          },
        } as unknown as Worker
      },
    })
    const pending = client.query({
      generation: 1,
      namespace: 'ns',
      kind: 'overview',
    })
    client.discardGeneration(2)
    await expect(pending).rejects.toThrow()
    client.dispose()
  })

  it('answers detail, overview, filter-options, and global kinds from entities', async () => {
    await seedSnapshots([snapshot('g1', ['a', 'b']), snapshot('g2', ['c'])])
    const detail = (await runOfflineWorkerQuery({
      requestId: 'req-detail',
      generation: 1,
      namespace: 'ns',
      kind: 'expense-detail',
      groupId: 'g1',
      expenseId: 'a',
    })) as { status: string; list?: { id: string }; detail?: { id: string } }
    expect(detail.status).toBe('found')
    expect(detail.list?.id).toBe('a')
    expect(detail.detail?.id).toBe('a')
    const missing = (await runOfflineWorkerQuery({
      requestId: 'req-missing',
      generation: 1,
      namespace: 'ns',
      kind: 'expense-detail',
      groupId: 'g1',
      expenseId: 'nope',
    })) as { status: string }
    expect(missing.status).toBe('missing')
    const overview = (await runOfflineWorkerQuery({
      requestId: 'req-overview',
      generation: 1,
      namespace: 'ns',
      kind: 'overview',
    })) as { groups: Array<{ id?: string }>; revisionDigest: string }
    expect(overview.groups).toHaveLength(2)
    expect(overview.revisionDigest).toContain('g1:o2.c0.v0')
    const options = (await runOfflineWorkerQuery({
      requestId: 'req-options',
      generation: 1,
      namespace: 'ns',
      kind: 'filter-options',
    })) as { groups: unknown[]; revisionDigest: string }
    expect(options.groups).toHaveLength(2)
    const global = (await runOfflineWorkerQuery({
      requestId: 'req-global',
      generation: 1,
      namespace: 'ns',
      kind: 'global-expenses',
      filter: {},
    })) as { totalFiltered: number; rows: unknown[]; revisionDigest: string }
    expect(global.totalFiltered).toBe(3)
    expect(global.rows).toHaveLength(3)
    expect(global.revisionDigest).toContain('g2:o2.c0.v0')
  })

  it('returns the group id (not the expense id) on global rows', async () => {
    // Regression: global rows carried `groupId: record.list.id` (the expense
    // id), breaking sort tie-breaks and any consumer reading `row.groupId`.
    await seedSnapshots([snapshot('g1', ['a', 'b']), snapshot('g2', ['c'])])
    const global = (await runOfflineWorkerQuery({
      requestId: 'req-global-group-id',
      generation: 1,
      namespace: 'ns',
      kind: 'global-expenses',
      filter: {},
    })) as {
      rows: Array<{
        list: { id: string }
        group: { id: string }
        groupId: string
      }>
    }
    expect(global.rows).toHaveLength(3)
    for (const row of global.rows) {
      expect(row.groupId).toBe(row.group.id)
      expect(row.groupId).not.toBe(row.list.id)
    }
  })

  it('times out stuck queries and aborts on signal', async () => {
    const never = createOfflineQueryClient({
      createWorker: () =>
        ({
          onmessage: null,
          onerror: null,
          postMessage: () => undefined,
          terminate: () => undefined,
        }) as unknown as Worker,
    })
    await expect(
      never.query(
        { generation: 1, namespace: 'ns', kind: 'overview' },
        { timeoutMs: 20 },
      ),
    ).rejects.toMatchObject({ name: 'TimeoutError' })
    never.dispose()
    const controller = new AbortController()
    const cancellable = createOfflineQueryClient({
      createWorker: () =>
        ({
          onmessage: null,
          onerror: null,
          postMessage: () => undefined,
          terminate: () => undefined,
        }) as unknown as Worker,
    })
    const pending = cancellable.query(
      { generation: 1, namespace: 'ns', kind: 'overview' },
      { signal: controller.signal },
    )
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    cancellable.dispose()
    expect(OFFLINE_WORKER_REQUEST_TIMEOUT_MS).toBe(30_000)
  })

  it('cools down after rapid failures until an explicit recreate', async () => {
    let creations = 0
    const failing = createOfflineQueryClient({
      createWorker: () => {
        creations += 1
        throw new Error('no worker')
      },
    })
    for (let index = 0; index < 3; index += 1) {
      await expect(
        failing.query({ generation: 1, namespace: 'ns', kind: 'overview' }),
      ).rejects.toMatchObject({ name: 'OfflineWorkerUnavailableError' })
    }
    expect(creations).toBe(3)
    // Cooling down: no new worker attempt, still unavailable.
    await expect(
      failing.query({ generation: 1, namespace: 'ns', kind: 'overview' }),
    ).rejects.toMatchObject({ name: 'OfflineWorkerUnavailableError' })
    expect(creations).toBe(3)
    // Explicit recreation (foreground/Retry) resumes attempts.
    failing.recreate()
    await expect(
      failing.query({ generation: 1, namespace: 'ns', kind: 'overview' }),
    ).rejects.toMatchObject({ name: 'OfflineWorkerUnavailableError' })
    expect(creations).toBe(4)
    failing.dispose()
  })

  it('keeps chunked pure helpers yielding every 500 rows (test-only entry)', async () => {
    const idsA = Array.from({ length: 600 }, (_, index) => `a-${index}`)
    const idsB = Array.from({ length: 600 }, (_, index) => `b-${index}`)
    const snapA = groupRecord('g1', snapshot('g1', idsA))
    const snapB = groupRecord('g2', snapshot('g2', idsB))
    const catalog: CatalogRecord = {
      namespace: 'ns',
      capturedAt: new Date(),
      schemaVersion: 1,
      groups: [
        {
          overview: { id: 'g1' },
          global: {
            id: 'g1',
            hidden: false,
            archived: false,
            currency: 'USD',
            currencyCode: 'USD',
          },
        },
        {
          overview: { id: 'g2' },
          global: {
            id: 'g2',
            hidden: false,
            archived: false,
            currency: 'USD',
            currencyCode: 'USD',
          },
        },
      ],
    } as unknown as CatalogRecord
    const byGroupId = new Map([
      ['g1', snapA],
      ['g2', snapB],
    ])
    const syncResult = queryGlobalExpensesOffline(catalog, byGroupId, {})
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout')
    const chunkedResult = await queryGlobalExpensesOfflineChunked(
      catalog,
      byGroupId,
      {},
      500,
    )
    expect(chunkedResult.totalFiltered).toBe(syncResult.totalFiltered)
    expect(chunkedResult.totalFiltered).toBe(1200)
    expect(chunkedResult.rows).toHaveLength(20)
    // 1200 candidates yield at least twice (every 500 rows).
    expect(setTimeoutSpy.mock.calls.length).toBeGreaterThanOrEqual(2)
    setTimeoutSpy.mockRestore()

    const client = createOfflineQueryClient({ createWorker: () => null })
    await expect(
      client.query({
        generation: 1,
        namespace: 'ns',
        kind: 'global-expenses',
        catalog,
        snapshots: [snapA, snapB],
        filter: {},
      }),
    ).rejects.toMatchObject({ name: 'OfflineWorkerUnavailableError' })
    const fallback = (await client.fallback({
      requestId: 'req-global-fallback',
      generation: 1,
      namespace: 'ns',
      kind: 'global-expenses',
      catalog,
      snapshots: [snapA, snapB],
      filter: {},
    })) as { totalFiltered: number; rows: unknown[] }
    expect(fallback.totalFiltered).toBe(1200)
    expect(fallback.rows).toHaveLength(20)
    client.dispose()
  })
})
