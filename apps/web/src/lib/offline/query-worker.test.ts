import { describe, expect, it, vi } from 'vitest'

import type { OfflineSnapshotOutput } from '@spliit/api/offline-contract'

import type { CatalogRecord, GroupRecord } from './contract'
import {
  createOfflineQueryClient,
  dropWorkerWorkingSet,
  runOfflineWorkerQuery,
} from './query-worker'
import {
  OFFLINE_FALLBACK_CHUNK_ROWS,
  queryGlobalExpensesOffline,
  queryGlobalExpensesOfflineChunked,
} from './read-model'

function snapshot(groupId: string, ids: string[]): OfflineSnapshotOutput {
  return {
    schemaVersion: 1,
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

describe('offline query worker', () => {
  it('answers group queries with requestId/generation', () => {
    dropWorkerWorkingSet()
    const snap = groupRecord('g1', snapshot('g1', ['a', 'b']))
    const result = runOfflineWorkerQuery({
      requestId: 'req-1',
      generation: 7,
      namespace: 'ns',
      kind: 'group-expenses',
      groupId: 'g1',
      snapshot: snap,
    }) as { rows: Array<{ list: { id: string } }>; totalFiltered: number }
    expect(result.totalFiltered).toBe(2)
    expect(result.rows.map((row) => row.list.id).sort()).toEqual(['a', 'b'])
  })

  it('drops the working set on generation events', () => {
    dropWorkerWorkingSet()
    const snap = groupRecord('g1', snapshot('g1', ['a']))
    runOfflineWorkerQuery({
      requestId: 'req-1',
      generation: 1,
      namespace: 'ns',
      kind: 'group-expenses',
      groupId: 'g1',
      snapshot: snap,
    })
    dropWorkerWorkingSet()
    // After the drop, a query without an inline snapshot finds nothing rather
    // than resurrecting the previous account data.
    const catalog: CatalogRecord = {
      namespace: 'ns',
      capturedAt: new Date(),
      schemaVersion: 1,
      groups: [],
    }
    const result = runOfflineWorkerQuery({
      requestId: 'req-2',
      generation: 2,
      namespace: 'ns',
      kind: 'global-expenses',
      catalog,
      snapshots: [],
    }) as { rows: unknown[] }
    expect(result.rows).toEqual([])
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

  it('evicts previous group working sets on sequential group-expenses', () => {
    dropWorkerWorkingSet()
    const snap1 = groupRecord('g1', snapshot('g1', ['a']))
    const snap2 = groupRecord('g2', snapshot('g2', ['b']))
    runOfflineWorkerQuery({
      requestId: 'req-g1',
      generation: 1,
      namespace: 'ns',
      kind: 'group-expenses',
      groupId: 'g1',
      snapshot: snap1,
    })
    runOfflineWorkerQuery({
      requestId: 'req-g2',
      generation: 1,
      namespace: 'ns',
      kind: 'group-expenses',
      groupId: 'g2',
      snapshot: snap2,
    })
    // g1 was evicted when g2 became the current working set.
    const retained = runOfflineWorkerQuery({
      requestId: 'req-g2-again',
      generation: 1,
      namespace: 'ns',
      kind: 'group-expenses',
      groupId: 'g2',
    }) as { totalFiltered: number; rows: Array<{ list: { id: string } }> }
    expect(retained.totalFiltered).toBe(1)
    expect(retained.rows.map((row) => row.list.id)).toEqual(['b'])
    const evicted = runOfflineWorkerQuery({
      requestId: 'req-g1-again',
      generation: 1,
      namespace: 'ns',
      kind: 'group-expenses',
      groupId: 'g1',
    }) as { totalFiltered: number }
    expect(evicted.totalFiltered).toBe(0)
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
