import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import 'fake-indexeddb/auto'

import type { CatalogRecord, GroupRecord } from './contract'
import * as queryWorkerModule from './query-worker'
import {
  createInlineOfflineWorkerForTests,
  createOfflineQueryClient,
} from './query-worker'
import {
  useOfflineActivities,
  useOfflineBudget,
  useOfflineBudgets,
  useOfflineExpenseComments,
  useOfflineExpenses,
  useOfflineFilterOptions,
  useOfflineGlobalExpenses,
  useOfflineGroup,
  useOfflineOverview,
  useOfflineSplitPresets,
  useOfflineSubgroups,
} from './read-hooks'

const mocks = vi.hoisted(() => ({
  useSession: vi.fn(),
  useStorage: vi.fn(),
  useActiveUser: vi.fn(),
  useCurrentAccount: vi.fn(),
  useOnlineStatus: vi.fn(),
  trpcGroupsGet: vi.fn(),
  trpcGroupsExpensesList: vi.fn(),
  trpcGroupsExpensesGet: vi.fn(),
  trpcGroupsBalancesList: vi.fn(),
  trpcOverviewGet: vi.fn(),
  trpcExpensesList: vi.fn(),
  trpcFilterOptions: vi.fn(),
  trpcGroupsActivitiesList: vi.fn(),
  trpcGroupsSubgroupsList: vi.fn(),
  trpcGroupsSplitPresetsList: vi.fn(),
  trpcGroupsBudgetsList: vi.fn(),
  trpcGroupsBudgetsGet: vi.fn(),
}))

vi.mock('./provider', () => ({
  useOfflineSession: mocks.useSession,
  useOptionalOfflineStorage: mocks.useStorage,
  useOptionalOfflineLifecycle: () => null,
  useOptionalOfflineConnectivity: () => null,
}))

vi.mock('@/lib/hooks', () => ({
  useActiveUser: mocks.useActiveUser,
}))

vi.mock('@/lib/use-current-account', () => ({
  useCurrentAccount: mocks.useCurrentAccount,
}))

vi.mock('@/lib/use-online-status', () => ({
  useOnlineStatus: mocks.useOnlineStatus,
  useOfflineWithoutData: () => false,
}))

vi.mock('@/trpc/client', () => ({
  trpc: {
    overview: { get: { useQuery: mocks.trpcOverviewGet } },
    groups: {
      get: { useQuery: mocks.trpcGroupsGet },
      expenses: {
        list: { useInfiniteQuery: mocks.trpcGroupsExpensesList },
        get: { useQuery: mocks.trpcGroupsExpensesGet },
      },
      balances: { list: { useQuery: mocks.trpcGroupsBalancesList } },
      activities: {
        list: { useInfiniteQuery: mocks.trpcGroupsActivitiesList },
      },
      subgroups: { list: { useQuery: mocks.trpcGroupsSubgroupsList } },
      splitPresets: { list: { useQuery: mocks.trpcGroupsSplitPresetsList } },
      budgets: {
        list: { useQuery: mocks.trpcGroupsBudgetsList },
        get: { useQuery: mocks.trpcGroupsBudgetsGet },
      },
    },
    expenses: {
      list: { useInfiniteQuery: mocks.trpcExpensesList },
      filterOptions: { useQuery: mocks.trpcFilterOptions },
    },
  },
}))

const NAMESPACE = JSON.stringify(['http://localhost:3001', 'account-alice'])
const BASE_TIME = new Date('2026-03-08T12:00:00.000Z')

function listItem(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    title: `Expense ${id}`,
    amount: 1000,
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
    paidByList: [
      {
        ledgerParticipant: {
          id: 'p-alice',
          name: 'Alice',
          account: { id: 'account-alice', name: 'Alice', image: null },
          removed: false,
        },
        shares: 1,
      },
    ],
    paidFor: [
      {
        ledgerParticipant: {
          id: 'p-bob',
          name: 'Bob',
          account: { id: 'account-bob', name: 'Bob', image: null },
          removed: false,
        },
        shares: 1,
      },
    ],
    recurringSeriesId: null,
    recurringSeriesStatus: null,
    documentCount: 0,
    permissions: { canEdit: true, canDelete: true, canManageRecurrence: false },
    ...overrides,
  }
}

function detail(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    title: `Expense ${id}`,
    amount: 1000,
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
    paidByList: [{ ledgerParticipantId: 'p-alice', shares: 1 }],
    paidFor: [{ ledgerParticipantId: 'p-bob', shares: 1 }],
    items: [],
    itemizedRemainder: null,
    recurringSeriesId: null,
    recurringSeries: null,
    recurrence: null,
    previousExpenseId: null,
    nextExpenseId: null,
    permissions: { canEdit: true, canDelete: true, canManageRecurrence: false },
    ...overrides,
  }
}

function expenseRecord(id: string) {
  return {
    list: listItem(id),
    detail: detail(id),
  } as never
}

function snapshotPayload(groupId: string, ids: string[]) {
  return {
    schemaVersion: 2,
    accountId: 'account-alice',
    groupId,
    capturedAt: BASE_TIME,
    group: {
      group: {
        participants: [
          {
            id: 'p-alice',
            name: 'Alice',
            account: { id: 'account-alice', name: 'Alice', image: null },
          },
        ],
        members: [
          { accountId: 'account-alice', ledgerParticipant: { id: 'p-alice' } },
        ],
      },
      displayName: `Group ${groupId}`,
      currentLedgerParticipantId: 'p-alice',
      currentMember: { id: 'm-1', role: 'MEMBER', status: 'ACTIVE' },
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
      name: `Group ${groupId}`,
      information: null,
      archived: false,
      createdAt: BASE_TIME.toISOString(),
      groupType: 'GROUP',
      ledger: { currency: 'USD', currencyCode: 'USD' },
      memberCount: 2,
      currentMemberRole: 'MEMBER',
      preference: { starred: false, hidden: false },
      displayName: `Group ${groupId}`,
      friendAccount: null,
      memberAccounts: [],
      financialSummary: {
        expenseCount: ids.length,
        netBalance: 100,
        state: 'OWED_TO_YOU',
        latestExpenseCreatedAt: BASE_TIME.toISOString(),
      },
      access: 'MEMBER',
      viewKey: null,
      lastOpenedAt: null,
    },
    global: {
      id: groupId,
      name: `Group ${groupId}`,
      archived: false,
      hidden: false,
      groupType: 'GROUP',
      displayName: `Group ${groupId}`,
      currency: 'USD',
      currencyCode: 'USD',
      participantCount: 2,
    },
    balances: {
      balances: { 'p-alice': { paid: 1000, paidFor: 0, total: 1000 } },
      suggestedSettlements: [{ from: 'p-bob', to: 'p-alice', amount: 500 }],
      currencyBalances: [],
      participants: [
        { id: 'p-alice', name: 'Alice', removed: false },
        { id: 'p-bob', name: 'Bob', removed: false },
      ],
      settlement: {
        subgroup: { units: [], legs: [], hasInternalBalances: false },
        individual: {
          suggestedSettlements: [{ from: 'p-bob', to: 'p-alice', amount: 500 }],
          policy: 'standard',
        },
      },
    },
    expenses: ids.map((id) => expenseRecord(id)),
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
  } as never
}

function groupRecord(
  groupId: string,
  ids: string[],
  overrides: Partial<GroupRecord> = {},
): GroupRecord {
  return {
    namespace: NAMESPACE,
    groupId,
    schemaVersion: 1,
    capturedAt: BASE_TIME,
    storedAt: new Date('2026-03-09T00:00:00.000Z'),
    commitNonce: `nonce-${groupId}`,
    dirtySince: null,
    payload: snapshotPayload(groupId, ids) as never,
    ...overrides,
  }
}

function catalogWith(ids: string[]): CatalogRecord {
  return {
    namespace: NAMESPACE,
    capturedAt: BASE_TIME,
    schemaVersion: 2,
    groups: ids.map((id) => ({
      overview: {
        id,
        name: `Group ${id}`,
        information: null,
        archived: false,
        createdAt: BASE_TIME.toISOString(),
        groupType: 'GROUP',
        ledger: { currency: 'USD', currencyCode: 'USD' },
        memberCount: 2,
        currentMemberRole: 'MEMBER',
        preference: { starred: false, hidden: false },
        displayName: `Group ${id}`,
        friendAccount: null,
        memberAccounts: [],
        financialSummary: {
          expenseCount: 1,
          netBalance: 100,
          state: 'OWED_TO_YOU',
          latestExpenseCreatedAt: BASE_TIME.toISOString(),
        },
        access: 'MEMBER',
        viewKey: null,
        lastOpenedAt: null,
      },
      global: {
        id,
        name: `Group ${id}`,
        archived: false,
        hidden: false,
        groupType: 'GROUP',
        displayName: `Group ${id}`,
        currency: 'USD',
        currencyCode: 'USD',
        participantCount: 2,
      },
    })),
  } as unknown as CatalogRecord
}

function makeRepository(options: {
  catalog: CatalogRecord | null
  groups: Map<string, GroupRecord>
  readGroupImpl?: (groupId: string) => Promise<never>
  readGroupMetaImpl?: (groupId: string) => Promise<never>
}) {
  return {
    readCatalog: vi.fn(async () => {
      if (!options.catalog) return { status: 'missing' as const }
      return { status: 'ready' as const, record: options.catalog }
    }),
    readGroup: vi.fn(async (_namespace: string, groupId: string) => {
      if (options.readGroupImpl) return options.readGroupImpl(groupId)
      const record = options.groups.get(groupId)
      if (!record) return { status: 'missing' as const }
      return { status: 'ready' as const, record }
    }),
    readGroupMeta: vi.fn(async (_namespace: string, groupId: string) => {
      if (options.readGroupMetaImpl) return options.readGroupMetaImpl(groupId)
      const record = options.groups.get(groupId)
      if (!record) return { status: 'missing' as const }
      return {
        status: 'ready' as const,
        record: {
          namespace: NAMESPACE,
          groupId,
          schemaVersion: 1,
          serverRevision:
            (record.payload as { revision?: string }).revision ?? 'o2.c0.v0',
          capturedAt: record.capturedAt,
          storedAt: record.storedAt,
          commitNonce: record.commitNonce,
          dirtySince: record.dirtySince,
          lastConfirmedAt: record.storedAt,
          totalCount: record.payload.totalCount,
          hasMore: record.payload.hasMore,
          truncatedAt: record.payload.truncatedAt,
        },
      }
    }),
    readGroupData: vi.fn(async (_namespace: string, groupId: string) => {
      const record = options.groups.get(groupId)
      if (!record) return { status: 'missing' as const }
      return {
        status: 'ready' as const,
        record: {
          namespace: NAMESPACE,
          groupId,
          data: {
            group: record.payload.group,
            overview: record.payload.overview,
            global: record.payload.global,
            balances: record.payload.balances,
            subgroups: record.payload.subgroups,
            splitPresets: record.payload.splitPresets,
            budgets: record.payload.budgets,
            activities: record.payload.activities,
            activityTotalCount: record.payload.activityTotalCount,
            activityHasMore: record.payload.activityHasMore,
          },
        },
      }
    }),
  }
}

/**
 * Seed the worker engine's Dexie tables from the same fixtures the repository
 * mock serves. Hooks read metadata through the mock; the inline worker reads
 * entities through Dexie.
 */
async function seedEngine(
  catalog: CatalogRecord | null,
  groups: Map<string, GroupRecord>,
): Promise<void> {
  const { OfflineDexieDatabase } = await import('./database')
  const db = new OfflineDexieDatabase()
  await db.open()
  try {
    if (catalog) {
      await db.catalogs.put({
        ...catalog,
        groups: catalog.groups.map((entry) => ({
          ...entry,
          revision: (entry as { revision?: string }).revision ?? 'o2.c0.v0',
        })),
      })
    }
    for (const [groupId, record] of groups) {
      const revision =
        (record.payload as { revision?: string }).revision ?? 'o2.c0.v0'
      await db.groupMeta.put({
        namespace: NAMESPACE,
        groupId,
        schemaVersion: 1,
        serverRevision: revision,
        capturedAt: record.capturedAt,
        storedAt: record.storedAt,
        commitNonce: record.commitNonce,
        dirtySince: record.dirtySince,
        lastConfirmedAt: record.storedAt,
        totalCount: record.payload.totalCount,
        hasMore: record.payload.hasMore,
        truncatedAt: record.payload.truncatedAt,
      })
      await db.groupData.put({
        namespace: NAMESPACE,
        groupId,
        data: {
          group: record.payload.group,
          overview: record.payload.overview,
          global: record.payload.global,
          balances: record.payload.balances,
          subgroups: record.payload.subgroups,
          splitPresets: record.payload.splitPresets,
          budgets: record.payload.budgets,
          activities: record.payload.activities,
          activityTotalCount: record.payload.activityTotalCount,
          activityHasMore: record.payload.activityHasMore,
        },
      })
      await db.expenseList.bulkPut(
        record.payload.expenses.map((entry) => ({
          namespace: NAMESPACE,
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
        record.payload.expenses.map((entry) => ({
          namespace: NAMESPACE,
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

async function setupLocal(options: {
  catalog: CatalogRecord | null
  groups: Map<string, GroupRecord>
  readGroupImpl?: (groupId: string) => Promise<never>
}) {
  const repository = makeRepository(options)
  mocks.useStorage.mockReturnValue(makeStorage(repository))
  await seedEngine(options.catalog, options.groups)
  return repository
}

function makeStorage(repository: unknown) {
  return {
    subscribe: () => () => {},
    getRepository: () => repository,
  }
}

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
  return { Wrapper, client }
}

describe('offline read hooks', () => {
  beforeEach(async () => {
    const { deleteOfflineDatabaseForTests } = await import('./database')
    await deleteOfflineDatabaseForTests()
    queryWorkerModule.dropWorkerWorkingSet()
    vi.clearAllMocks()
    mocks.useSession.mockReturnValue({
      namespace: NAMESPACE,
      generation: 1,
      account: { id: 'account-alice' },
    })
    mocks.useActiveUser.mockReturnValue('p-alice')
    mocks.useCurrentAccount.mockReturnValue({ data: { id: 'account-alice' } })
    mocks.useOnlineStatus.mockReturnValue(false)
    mocks.trpcGroupsGet.mockReturnValue({
      data: undefined,
      error: undefined,
      isFetching: false,
    })
    mocks.trpcGroupsExpensesList.mockReturnValue({
      data: undefined,
      error: undefined,
      isFetching: false,
      fetchNextPage: vi.fn(),
    })
    mocks.trpcGroupsExpensesGet.mockReturnValue({
      data: undefined,
      error: undefined,
      isFetching: false,
    })
    mocks.trpcGroupsBalancesList.mockReturnValue({
      data: undefined,
      error: undefined,
      isFetching: false,
    })
    mocks.trpcOverviewGet.mockReturnValue({
      data: undefined,
      error: undefined,
      isFetching: false,
    })
    mocks.trpcExpensesList.mockReturnValue({
      data: undefined,
      error: undefined,
      isFetching: false,
      fetchNextPage: vi.fn(),
    })
    mocks.trpcFilterOptions.mockReturnValue({
      data: undefined,
      error: undefined,
      isFetching: false,
    })
    mocks.trpcGroupsActivitiesList.mockReturnValue({
      data: undefined,
      error: undefined,
      isFetching: false,
      fetchNextPage: vi.fn(),
    })
    mocks.trpcGroupsSubgroupsList.mockReturnValue({
      data: undefined,
      error: undefined,
      isFetching: false,
    })
    mocks.trpcGroupsSplitPresetsList.mockReturnValue({
      data: undefined,
      error: undefined,
      isFetching: false,
    })
    mocks.trpcGroupsBudgetsList.mockReturnValue({
      data: undefined,
      error: undefined,
      isFetching: false,
    })
    mocks.trpcGroupsBudgetsGet.mockReturnValue({
      data: undefined,
      error: undefined,
      isFetching: false,
    })
    // Worker is mandatory in production; happy-dom has no real Worker, so
    // hook tests run the real worker protocol through an inline stand-in.
    // Tests that need a failing/custom client override this per test.
    queryWorkerModule.dropWorkerWorkingSet()
    vi.spyOn(queryWorkerModule, 'getDefaultOfflineQueryClient').mockReturnValue(
      createOfflineQueryClient({
        createWorker: () => createInlineOfflineWorkerForTests(),
      }),
    )
  })

  afterEach(async () => {
    const { deleteOfflineDatabaseForTests } = await import('./database')
    queryWorkerModule.dropWorkerWorkingSet()
    await deleteOfflineDatabaseForTests()
  })

  it('selects the offline download when the network has no complete result', async () => {
    const catalog = catalogWith(['g1'])
    const record = groupRecord('g1', ['a', 'b'])
    await setupLocal({
      catalog,
      groups: new Map([['g1', record]]),
    })
    mocks.trpcGroupsGet.mockReturnValue({
      data: undefined,
      error: new Error('offline'),
      isFetching: false,
    })
    const { Wrapper } = makeWrapper()
    const { result } = renderHook(() => useOfflineGroup('g1'), {
      wrapper: Wrapper,
    })
    await waitFor(() => {
      expect(result.current.meta.availability).toBe('ready')
    })
    expect(result.current.meta.source).toBe('download')
    expect(result.current.data).toBeDefined()
  })

  it('reports missing (not indefinite loading) when the network is paused', async () => {
    await setupLocal({ catalog: null, groups: new Map() })
    mocks.trpcGroupsGet.mockReturnValue({
      data: undefined,
      error: undefined,
      isFetching: true,
      isPaused: true,
    })
    const { Wrapper } = makeWrapper()
    const { result } = renderHook(() => useOfflineGroup('g1'), {
      wrapper: Wrapper,
    })
    await waitFor(() => {
      expect(result.current.meta.availability).toBe('missing')
    })
    expect(result.current.data).toBeUndefined()
    expect(result.current.meta.refreshing).toBe(false)
  })

  it('keeps refreshing false when online but the network is idle', async () => {
    const catalog = catalogWith(['g1'])
    const record = groupRecord('g1', ['a'])
    await setupLocal({
      catalog,
      groups: new Map([['g1', record]]),
    })
    mocks.useOnlineStatus.mockReturnValue(true)
    mocks.trpcGroupsGet.mockReturnValue({
      data: undefined,
      error: undefined,
      isFetching: false,
    })
    const { Wrapper } = makeWrapper()
    const { result } = renderHook(() => useOfflineGroup('g1'), {
      wrapper: Wrapper,
    })
    await waitFor(() => {
      expect(result.current.meta.availability).toBe('ready')
    })
    // Regression: refreshing was `isFetching || isOnline` (stuck true online).
    expect(result.current.meta.refreshing).toBe(false)
  })

  it('returns error (not a synthesized ready-empty) when the local load fails', async () => {
    const catalog = catalogWith(['g1'])
    const record = groupRecord('g1', ['a'])
    await setupLocal({
      catalog,
      groups: new Map([['g1', record]]),
    })
    mocks.trpcGroupsExpensesList.mockReturnValue({
      data: undefined,
      error: undefined,
      isFetching: false,
      fetchNextPage: vi.fn(),
    })
    const failingQuery = vi.fn(async () => {
      throw new Error('snapshot unreadable')
    })
    const spy = vi
      .spyOn(queryWorkerModule, 'getDefaultOfflineQueryClient')
      .mockReturnValue({ query: failingQuery } as never)
    const { Wrapper } = makeWrapper()
    const { result } = renderHook(() => useOfflineExpenses({ groupId: 'g1' }), {
      wrapper: Wrapper,
    })
    await waitFor(() => {
      expect(result.current.meta.availability).toBe('error')
    })
    expect(result.current.data).toBeUndefined()
    expect(result.current.meta.source).toBe('download')
    spy.mockRestore()
  })

  it('routes overview/global/filter through the Worker client', async () => {
    const catalog = catalogWith(['g1'])
    const record = groupRecord('g1', ['a'])
    await setupLocal({
      catalog,
      groups: new Map([['g1', record]]),
    })
    const seenKinds: string[] = []
    const fakeQuery = vi.fn(async (request: { kind: string }) => {
      seenKinds.push(request.kind)
      if (request.kind === 'overview') {
        return {
          groups: [],
          balanceSummaries: [],
          peopleBalances: [],
          totalsAvailable: true,
          incompleteGroupCount: 0,
          dirtyGroupCount: 0,
          oldestCapturedAt: null,
        }
      }
      if (request.kind === 'global-expenses') {
        return {
          rows: [],
          totalFiltered: 0,
          nextOffset: null,
          hasMore: false,
          incompleteGroupCount: 0,
          dirtyGroupCount: 0,
          totalsAuthoritative: false,
          currencyError: null,
        }
      }
      return {
        groups: [],
        people: [],
        currencies: [],
        incompleteGroupCount: 0,
      }
    })
    const spy = vi
      .spyOn(queryWorkerModule, 'getDefaultOfflineQueryClient')
      .mockReturnValue({ query: fakeQuery } as never)

    const { Wrapper: OverviewWrapper } = makeWrapper()
    const overview = renderHook(() => useOfflineOverview(), {
      wrapper: OverviewWrapper,
    })
    await waitFor(() => {
      expect(overview.result.current.meta.availability).toBe('ready')
    })

    const { Wrapper: GlobalWrapper } = makeWrapper()
    const global = renderHook(() => useOfflineGlobalExpenses({}), {
      wrapper: GlobalWrapper,
    })
    await waitFor(() => {
      expect(global.result.current.meta.availability).toBe('ready')
    })

    const { Wrapper: FilterWrapper } = makeWrapper()
    const filter = renderHook(() => useOfflineFilterOptions(), {
      wrapper: FilterWrapper,
    })
    await waitFor(() => {
      expect(filter.result.current.meta.availability).toBe('ready')
    })

    expect(seenKinds).toContain('overview')
    expect(seenKinds).toContain('global-expenses')
    expect(seenKinds).toContain('filter-options')
    spy.mockRestore()
  })

  it('makes global fetchNextPage cancellable on filter changes', async () => {
    const catalog = catalogWith(['g1'])
    const ids = Array.from({ length: 45 }, (_, index) => `exp-${index}`)
    const record = groupRecord('g1', ids)
    // Slow worker replies so a next-page load races a filter change.
    await setupLocal({
      catalog,
      groups: new Map([['g1', record]]),
    })
    const client = createOfflineQueryClient({
      createWorker: () => createInlineOfflineWorkerForTests(),
    })
    const originalQuery = client.query.bind(client)
    let slowNextReads = false
    vi.spyOn(client, 'query').mockImplementation(
      async (request, requestOptions) => {
        if (slowNextReads) {
          await new Promise((resolve) => setTimeout(resolve, 30))
        }
        return originalQuery(request, requestOptions)
      },
    )
    vi.spyOn(queryWorkerModule, 'getDefaultOfflineQueryClient').mockReturnValue(
      client,
    )
    const { Wrapper } = makeWrapper()
    const { result, rerender } = renderHook(
      ({ search }: { search: string }) =>
        useOfflineGlobalExpenses({ search } as never),
      { wrapper: Wrapper, initialProps: { search: '' } },
    )
    await waitFor(() => {
      expect(result.current.meta.availability).toBe('ready')
    })
    expect(result.current.hasMore).toBe(true)
    expect(result.current.data?.pages[0]?.expenses).toHaveLength(20)
    slowNextReads = true
    // Start a stale next-page load for the old filter, then immediately switch
    // filters. The stale reply must not append to the new filter pages.
    const staleFetch = result.current.fetchNextPage()
    rerender({ search: 'zzz-nomatch' })
    await staleFetch.catch(() => undefined)
    await waitFor(() => {
      // New filter matches nothing: a single empty first page, no stale append.
      expect(result.current.data?.pages.length).toBe(1)
      expect(result.current.data?.pages[0]?.expenses).toHaveLength(0)
    })
    expect(result.current.hasMore).toBe(false)
  })

  it('scopes global missing/dirty counts to the currency filter', async () => {
    const usdCatalog = {
      namespace: NAMESPACE,
      capturedAt: BASE_TIME,
      schemaVersion: 2,
      groups: [
        {
          overview: { id: 'g-usd' },
          global: {
            id: 'g-usd',
            hidden: false,
            archived: false,
            currency: 'USD',
            currencyCode: 'USD',
          },
        },
        {
          overview: { id: 'g-eur' },
          global: {
            id: 'g-eur',
            hidden: false,
            archived: false,
            currency: 'EUR',
            currencyCode: 'EUR',
          },
        },
      ],
    } as unknown as CatalogRecord
    const usdRecord = groupRecord('g-usd', ['usd-1'])
    ;(usdRecord.payload as { global: unknown }).global = {
      id: 'g-usd',
      currency: 'USD',
      currencyCode: 'USD',
    }
    const eurRecord = groupRecord('g-eur', ['eur-1'], {
      dirtySince: new Date(),
    })
    ;(eurRecord.payload as { global: unknown }).global = {
      id: 'g-eur',
      currency: 'EUR',
      currencyCode: 'EUR',
    }
    await setupLocal({
      catalog: usdCatalog,
      groups: new Map([
        ['g-usd', usdRecord],
        ['g-eur', eurRecord],
      ]),
    })
    const { Wrapper } = makeWrapper()
    const { result } = renderHook(
      () => useOfflineGlobalExpenses({ currencies: ['USD:USD'] }),
      { wrapper: Wrapper },
    )
    await waitFor(() => {
      expect(result.current.meta.availability).toBe('ready')
    })
    // EUR dirty group is excluded by the currency scope.
    expect(result.current.data?.dirtyGroupCount).toBe(0)
    expect(result.current.meta.incompleteGroupCount).toBe(0)
  })

  it('caps the involvement tail at the hidden cap with continuation', async () => {
    const involvingIds = Array.from(
      { length: 5 },
      (_, index) => `involving-${index}`,
    )
    const hiddenIds = Array.from(
      { length: 200 },
      (_, index) => `hidden-${index}`,
    )
    // Build a snapshot where involving rows sort first (newer dates).
    const involvingExpenses = involvingIds.map((id, index) => ({
      list: listItem(id, {
        expenseDate: new Date(BASE_TIME.getTime() + (index + 1) * 1000),
        createdAt: new Date(BASE_TIME.getTime() + (index + 1) * 1000),
      }),
      detail: detail(id, {
        expenseDate: new Date(BASE_TIME.getTime() + (index + 1) * 1000),
        createdAt: new Date(BASE_TIME.getTime() + (index + 1) * 1000),
      }),
    }))
    const hiddenExpenses = hiddenIds.map((id, index) => ({
      list: listItem(id, {
        expenseDate: new Date(BASE_TIME.getTime() - (index + 1) * 1000),
        createdAt: new Date(BASE_TIME.getTime() - (index + 1) * 1000),
        paidByList: [{ ledgerParticipant: { id: 'p-other', account: null } }],
        paidFor: [{ ledgerParticipant: { id: 'p-other', account: null } }],
      }),
      detail: detail(id, {
        expenseDate: new Date(BASE_TIME.getTime() - (index + 1) * 1000),
        createdAt: new Date(BASE_TIME.getTime() - (index + 1) * 1000),
      }),
    }))
    const payload = snapshotPayload('g1', [])
    ;(payload as { expenses: unknown }).expenses = [
      ...involvingExpenses,
      ...hiddenExpenses,
    ] as never
    const record = groupRecord('g1', [], {})
    ;(record as { payload: unknown }).payload = payload
    const catalog = catalogWith(['g1'])
    await setupLocal({
      catalog,
      groups: new Map([['g1', record]]),
    })
    const { Wrapper } = makeWrapper()
    const { result } = renderHook(
      () => useOfflineExpenses({ groupId: 'g1', collapseInvolving: true }),
      { wrapper: Wrapper },
    )
    await waitFor(() => {
      expect(result.current.meta.availability).toBe('ready')
    })
    const firstPage = result.current.data?.pages[0]
    expect(firstPage?.expenses.length).toBeLessThanOrEqual(120)
    expect(firstPage?.expenses.length).toBe(100)
    expect(result.current.hasMore).toBe(true)
  })

  it('resets pagination when a same-second recommit changes only the nonce', async () => {
    const catalog = catalogWith(['g1'])
    let nonce = 'nonce-a'
    const base = groupRecord('g1', ['a'])
    const repository = {
      readCatalog: vi.fn(async () => ({
        status: 'ready' as const,
        record: catalog,
      })),
      readGroupMeta: vi.fn(async () => ({
        status: 'ready' as const,
        record: {
          namespace: NAMESPACE,
          groupId: 'g1',
          schemaVersion: 1,
          serverRevision: 'o2.c0.v0',
          capturedAt: BASE_TIME,
          storedAt: new Date('2026-03-09T00:00:00.000Z'),
          commitNonce: nonce,
          dirtySince: null,
          lastConfirmedAt: new Date('2026-03-09T00:00:00.000Z'),
          totalCount: 1,
          hasMore: false,
          truncatedAt: null,
        },
      })),
      readGroupData: vi.fn(async () => ({
        status: 'ready' as const,
        record: {
          namespace: NAMESPACE,
          groupId: 'g1',
          data: {
            group: base.payload.group,
            overview: base.payload.overview,
            global: base.payload.global,
            balances: base.payload.balances,
          },
        },
      })),
    }
    mocks.useStorage.mockReturnValue(makeStorage(repository))
    await seedEngine(catalog, new Map([['g1', base]]))
    const { Wrapper, client } = makeWrapper()
    const { result } = renderHook(() => useOfflineExpenses({ groupId: 'g1' }), {
      wrapper: Wrapper,
    })
    await waitFor(() => {
      expect(result.current.meta.availability).toBe('ready')
    })
    // Same-second recommit with a new nonce must invalidate the group query.
    nonce = 'nonce-b'
    const event = new StorageEvent('storage', {
      key: 'spliit:offline:event',
      newValue: JSON.stringify({ type: 'committed' }),
    })
    window.dispatchEvent(event)
    await waitFor(() => {
      expect(repository.readGroupMeta.mock.calls.length).toBeGreaterThan(1)
    })
    void client
  })

  it('maps group download records to network list items for shared UI', async () => {
    const catalog = catalogWith(['g1'])
    const record = groupRecord('g1', ['a'])
    await setupLocal({
      catalog,
      groups: new Map([['g1', record]]),
    })
    mocks.trpcGroupsExpensesList.mockReturnValue({
      data: undefined,
      error: new Error('offline'),
      isFetching: false,
      fetchNextPage: vi.fn(),
    })
    const { Wrapper } = makeWrapper()
    const { result } = renderHook(() => useOfflineExpenses({ groupId: 'g1' }), {
      wrapper: Wrapper,
    })
    await waitFor(() => {
      expect(result.current.meta.availability).toBe('ready')
    })
    const row = result.current.data?.pages[0]?.expenses[0] as Record<
      string,
      unknown
    >
    // Regression: raw `{list, detail}` records crashed ExpenseTimeline with
    // `RangeError: Invalid time value` (`new Date(undefined)`). Consumers
    // receive the bare list item instead.
    expect(row?.id).toBe('a')
    expect(row?.expenseDate).toBeInstanceOf(Date)
    expect(row?.expenseTimeZone).toBe('UTC')
    expect(row).not.toHaveProperty('list')
    expect(row).not.toHaveProperty('detail')
  })

  it('merges network rows over cached rows without swapping the list', async () => {
    const { clearPendingExpensesForTests } = await import('./pending-expenses')
    clearPendingExpensesForTests()
    mocks.useOnlineStatus.mockReturnValue(true)
    const catalog = catalogWith(['g1'])
    const record = groupRecord('g1', ['a'])
    await setupLocal({
      catalog,
      groups: new Map([['g1', record]]),
    })
    const localRow = (
      record.payload.expenses[0] as { list: Record<string, unknown> }
    ).list
    const networkA = { ...localRow }
    const networkB = {
      ...localRow,
      id: 'b',
      title: 'Expense b',
      expenseDate: new Date('2026-05-01T12:00:00Z'),
      createdAt: new Date('2026-05-01T13:00:00Z'),
    }
    // Stage 1: slow network — cached rows render immediately.
    mocks.trpcGroupsExpensesList.mockReturnValue({
      data: undefined,
      error: undefined,
      isFetching: true,
      fetchNextPage: vi.fn(),
      refetch: vi.fn(),
    })
    const { Wrapper } = makeWrapper()
    const { result, rerender } = renderHook(
      () => useOfflineExpenses({ groupId: 'g1' }),
      { wrapper: Wrapper },
    )
    await waitFor(() => {
      expect(result.current.meta.availability).toBe('ready')
    })
    expect(result.current.meta.source).toBe('download')
    // Stage 2: network arrives — rows merge in place, no source swap flash.
    mocks.trpcGroupsExpensesList.mockReturnValue({
      data: {
        pages: [{ expenses: [networkA, networkB], hasMore: false }],
      },
      error: undefined,
      isFetching: false,
      fetchNextPage: vi.fn(),
      refetch: vi.fn(),
    })
    rerender()
    await waitFor(() => {
      expect(result.current.meta.source).toBe('network')
    })
    await waitFor(() => {
      expect(
        result.current.data?.pages[0]?.expenses.map(
          (expense) => (expense as { id: string }).id,
        ),
      ).toEqual(['b', 'a'])
    })
    // Incremental insert, not a wholesale swap: unchanged rows keep the
    // on-screen (local) reference so memoized cards bail out.
    expect(result.current.data?.addedIds).toEqual(['b'])
    const firstPage = result.current.data?.pages[0]?.expenses as
      | Array<Record<string, unknown>>
      | undefined
    expect(firstPage?.map((expense) => expense.title)).toEqual([
      'Expense b',
      'Expense a',
    ])
    expect(result.current.meta.source).toBe('network')
  })

  it('keeps cached rows mounted across connectivity flips (no skeleton flash)', async () => {
    mocks.useOnlineStatus.mockReturnValue(false)
    const catalog = catalogWith(['g1'])
    const record = groupRecord('g1', ['a'])
    await setupLocal({
      catalog,
      groups: new Map([['g1', record]]),
    })
    mocks.trpcGroupsExpensesList.mockReturnValue({
      data: undefined,
      error: new Error('offline'),
      isFetching: false,
      fetchNextPage: vi.fn(),
      refetch: vi.fn(),
    })
    const { Wrapper } = makeWrapper()
    const { result, rerender } = renderHook(
      () => useOfflineExpenses({ groupId: 'g1' }),
      { wrapper: Wrapper },
    )
    await waitFor(() => {
      expect(result.current.meta.availability).toBe('ready')
    })
    expect(
      result.current.data?.pages[0]?.expenses.map(
        (expense) => (expense as { id: string }).id,
      ),
    ).toEqual(['a'])
    // Flip online while the network is still slow: cached rows must stay
    // mounted instead of resetting to an empty window (skeleton flash).
    mocks.useOnlineStatus.mockReturnValue(true)
    mocks.trpcGroupsExpensesList.mockReturnValue({
      data: undefined,
      error: undefined,
      isFetching: true,
      fetchNextPage: vi.fn(),
      refetch: vi.fn(),
    })
    rerender()
    expect(result.current.data).toBeDefined()
    expect(
      result.current.data?.pages[0]?.expenses.map(
        (expense) => (expense as { id: string }).id,
      ),
    ).toEqual(['a'])
    expect(result.current.meta.availability).toBe('ready')
  })

  it('terminates the list when the network paginates to exhaustion', async () => {
    const { clearPendingExpensesForTests } = await import('./pending-expenses')
    clearPendingExpensesForTests()
    mocks.useOnlineStatus.mockReturnValue(true)
    // Multi-page snapshot (>20 rows): the downloaded first page reports
    // hasMore while the network is still slow.
    const ids = Array.from({ length: 25 }, (_, index) => `e${index}`)
    const catalog = catalogWith(['g1'])
    const record = groupRecord('g1', ids)
    await setupLocal({
      catalog,
      groups: new Map([['g1', record]]),
    })
    mocks.trpcGroupsExpensesList.mockReturnValue({
      data: undefined,
      error: undefined,
      isFetching: true,
      fetchNextPage: vi.fn(),
      refetch: vi.fn(),
    })
    const { Wrapper } = makeWrapper()
    const { result, rerender } = renderHook(
      () => useOfflineExpenses({ groupId: 'g1' }),
      { wrapper: Wrapper },
    )
    await waitFor(() => {
      expect(result.current.meta.availability).toBe('ready')
    })
    expect(result.current.meta.source).toBe('download')
    expect(result.current.hasMore).toBe(true)
    // Network arrives already exhausted: termination must be network-driven.
    // A stale local hasMore must not keep the sentinel spinner alive.
    const localRow = (
      record.payload.expenses[0] as { list: Record<string, unknown> }
    ).list
    mocks.trpcGroupsExpensesList.mockReturnValue({
      data: {
        pages: [{ expenses: [{ ...localRow }], hasMore: false }],
      },
      error: undefined,
      isFetching: false,
      fetchNextPage: vi.fn(),
      refetch: vi.fn(),
    })
    rerender()
    await waitFor(() => {
      expect(result.current.meta.source).toBe('network')
    })
    await waitFor(() => {
      expect(result.current.hasMore).toBe(false)
    })
    expect(result.current.meta.hasMore).toBe(false)
  })

  it('overlays pending offline-created rows on the merged list', async () => {
    const { clearPendingExpensesForTests, enqueuePendingExpenseForTests } =
      await import('./pending-expenses')
    clearPendingExpensesForTests()
    const catalog = catalogWith(['g1'])
    const record = groupRecord('g1', ['a'])
    await setupLocal({
      catalog,
      groups: new Map([['g1', record]]),
    })
    enqueuePendingExpenseForTests('g1', {
      id: 'pending-1',
      clientId: 'pending-1',
      requestId: 'req-1',
      status: 'pending',
      expenseDate: new Date('2026-03-04T12:00:00Z'),
      createdAt: new Date('2026-03-04T13:00:00Z'),
      amount: 500,
      title: 'Pending coffee',
      expenseTimeZone: 'UTC',
      version: 0,
    })
    mocks.trpcGroupsExpensesList.mockReturnValue({
      data: undefined,
      error: new Error('offline'),
      isFetching: false,
      fetchNextPage: vi.fn(),
      refetch: vi.fn(),
    })
    const { Wrapper } = makeWrapper()
    const { result } = renderHook(() => useOfflineExpenses({ groupId: 'g1' }), {
      wrapper: Wrapper,
    })
    await waitFor(() => {
      expect(result.current.meta.availability).toBe('ready')
    })
    expect(
      result.current.data?.pages[0]?.expenses.map(
        (expense) => (expense as { id: string }).id,
      ),
    ).toContain('pending-1')
    expect(result.current.data?.pendingIds).toEqual(['pending-1'])
    clearPendingExpensesForTests()
  })

  it('maps global download records to list items with group context', async () => {
    const catalog = catalogWith(['g1'])
    const record = groupRecord('g1', ['a'])
    await setupLocal({
      catalog,
      groups: new Map([['g1', record]]),
    })
    mocks.trpcExpensesList.mockReturnValue({
      data: undefined,
      error: new Error('offline'),
      isFetching: false,
      fetchNextPage: vi.fn(),
    })
    const { Wrapper } = makeWrapper()
    const { result } = renderHook(() => useOfflineGlobalExpenses({}), {
      wrapper: Wrapper,
    })
    await waitFor(() => {
      expect(result.current.meta.availability).toBe('ready')
    })
    const row = result.current.data?.pages[0]?.expenses[0] as Record<
      string,
      unknown
    >
    expect(row?.id).toBe('a')
    expect(row?.expenseDate).toBeInstanceOf(Date)
    expect(row).not.toHaveProperty('list')
    expect(row).not.toHaveProperty('detail')
    expect((row?.group as { id?: string } | undefined)?.id).toBe('g1')
  })

  it('surfaces unsupported schemas distinctly from missing (P1-5)', async () => {
    const catalog = catalogWith(['g1'])
    const repository = makeRepository({
      catalog,
      groups: new Map(),
      readGroupMetaImpl: async () =>
        ({ status: 'unsupported', schemaVersion: 99 }) as never,
    })
    mocks.useStorage.mockReturnValue(makeStorage(repository))
    mocks.trpcGroupsGet.mockReturnValue({
      data: undefined,
      error: new Error('offline'),
      isFetching: false,
    })
    const { Wrapper } = makeWrapper()
    const { result } = renderHook(() => useOfflineGroup('g1'), {
      wrapper: Wrapper,
    })
    await waitFor(() => {
      expect(result.current.meta.availability).toBe('unsupported')
    })
    expect(result.current.data).toBeUndefined()
    expect(result.current.meta.source).toBe('download')
  })

  it('reads stored subgroups from the download when the network is out', async () => {
    const catalog = catalogWith(['g1'])
    const record = groupRecord('g1', [])
    record.payload.subgroups = {
      enabled: true,
      subgroups: [
        { id: 'sg-1', name: 'Trip crew', participantIds: ['p-alice'] },
      ],
    }
    await setupLocal({
      catalog,
      groups: new Map([['g1', record]]),
    })
    mocks.trpcGroupsSubgroupsList.mockReturnValue({
      data: undefined,
      error: new Error('offline'),
      isFetching: false,
    })
    const { Wrapper } = makeWrapper()
    const { result } = renderHook(
      () => useOfflineSubgroups({ groupId: 'g1' }),
      { wrapper: Wrapper },
    )
    await waitFor(() => {
      expect(result.current.meta.availability).toBe('ready')
    })
    expect(result.current.meta.source).toBe('download')
    expect(result.current.data?.enabled).toBe(true)
    expect(result.current.data?.subgroups).toEqual([
      { id: 'sg-1', name: 'Trip crew', participantIds: ['p-alice'] },
    ])
  })

  it('reads stored budgets offline with archive filtering', async () => {
    const catalog = catalogWith(['g1'])
    const record = groupRecord('g1', [])
    record.payload.budgets = [
      { id: 'bud-1', archived: false },
      { id: 'bud-old', archived: true },
    ] as never
    await setupLocal({
      catalog,
      groups: new Map([['g1', record]]),
    })
    mocks.trpcGroupsBudgetsList.mockReturnValue({
      data: undefined,
      error: new Error('offline'),
      isFetching: false,
    })
    const { Wrapper } = makeWrapper()
    const { result } = renderHook(() => useOfflineBudgets({ groupId: 'g1' }), {
      wrapper: Wrapper,
    })
    await waitFor(() => {
      expect(result.current.meta.availability).toBe('ready')
    })
    expect(
      (result.current.data?.budgets as Array<{ id: string }> | undefined)?.map(
        (budget) => budget.id,
      ),
    ).toEqual(['bud-1'])
  })

  it('resolves a single stored budget offline and reports unknown ids missing', async () => {
    const catalog = catalogWith(['g1'])
    const record = groupRecord('g1', [])
    record.payload.budgets = [{ id: 'bud-1', archived: false }] as never
    await setupLocal({
      catalog,
      groups: new Map([['g1', record]]),
    })
    mocks.trpcGroupsBudgetsGet.mockReturnValue({
      data: undefined,
      error: new Error('offline'),
      isFetching: false,
    })
    const { Wrapper } = makeWrapper()
    const { result } = renderHook(
      () => useOfflineBudget({ groupId: 'g1', budgetId: 'bud-1' }),
      { wrapper: Wrapper },
    )
    await waitFor(() => {
      expect(result.current.meta.availability).toBe('ready')
    })
    expect(
      (result.current.data?.budget as { id?: string } | undefined)?.id,
    ).toBe('bud-1')

    const { result: missing } = renderHook(
      () => useOfflineBudget({ groupId: 'g1', budgetId: 'bud-unknown' }),
      { wrapper: Wrapper },
    )
    await waitFor(() => {
      expect(missing.current.meta.availability).toBe('missing')
    })
    expect(missing.current.data).toBeUndefined()
  })

  it('reads stored split presets offline', async () => {
    const catalog = catalogWith(['g1'])
    const record = groupRecord('g1', [])
    record.payload.splitPresets = {
      presets: [{ id: 'preset-1', name: 'Even', scope: 'SHARED' }],
      canManageShared: true,
      canManagePersonal: true,
      groupDefaults: { paidByPresetId: null, paidForPresetId: null },
      personalDefaults: {
        paidBy: { mode: 'INHERIT', presetId: null },
        paidFor: { mode: 'INHERIT', presetId: null },
      },
      effectiveDefaults: { paidByPresetId: null, paidForPresetId: null },
    } as never
    await setupLocal({
      catalog,
      groups: new Map([['g1', record]]),
    })
    mocks.trpcGroupsSplitPresetsList.mockReturnValue({
      data: undefined,
      error: new Error('offline'),
      isFetching: false,
    })
    const { Wrapper } = makeWrapper()
    const { result } = renderHook(() => useOfflineSplitPresets('g1'), {
      wrapper: Wrapper,
    })
    await waitFor(() => {
      expect(result.current.meta.availability).toBe('ready')
    })
    expect(result.current.meta.source).toBe('download')
    expect(
      (result.current.data?.presets as Array<{ id?: string }> | undefined)?.map(
        (preset) => preset.id,
      ),
    ).toEqual(['preset-1'])
  })

  it('paginates the cached activity window and discloses older history', async () => {
    const catalog = catalogWith(['g1'])
    const record = groupRecord('g1', [])
    record.payload.activities = Array.from({ length: 25 }, (_, index) => ({
      id: `act-${index}`,
      ledgerId: 'ledger-1',
      time: new Date(Date.UTC(2026, 5, 10, 12, index, 0)),
      type: 'EXPENSE_CREATED',
      actorType: 'ACCOUNT',
      actorId: 'account-alice',
      subjectType: 'EXPENSE',
      subjectId: `exp-${index}`,
      data: null,
      actorName: 'Alice',
      expense: null,
    })) as never
    record.payload.activityTotalCount = 100
    record.payload.activityHasMore = true
    await setupLocal({
      catalog,
      groups: new Map([['g1', record]]),
    })
    mocks.trpcGroupsActivitiesList.mockReturnValue({
      data: undefined,
      error: new Error('offline'),
      isFetching: false,
      fetchNextPage: vi.fn(),
    })
    const { Wrapper } = makeWrapper()
    const { result } = renderHook(
      () => useOfflineActivities({ groupId: 'g1', limit: 20 }),
      { wrapper: Wrapper },
    )
    await waitFor(() => {
      expect(result.current.meta.availability).toBe('ready')
    })
    expect(result.current.meta.source).toBe('download')
    expect(result.current.data?.pages[0]?.activities).toHaveLength(20)
    expect(result.current.hasMore).toBe(true)
    // The cache boundary is disclosed, never presented as complete.
    expect(result.current.data?.activityTotalCount).toBe(100)
    expect(result.current.data?.activityHasMore).toBe(true)

    await result.current.fetchNextPage()
    await waitFor(() => {
      expect(result.current.data?.pages[0]?.activities).toHaveLength(25)
    })
    // Cache exhausted: local pagination stops while the server boundary
    // disclosure remains.
    expect(result.current.hasMore).toBe(false)
    expect(result.current.data?.activityHasMore).toBe(true)
  })

  it('reads downloaded expense comments from the expense detail', async () => {
    const catalog = catalogWith(['g1'])
    const record = groupRecord('g1', ['a'])
    const detail = record.payload.expenses[0]!.detail as {
      comments?: unknown[]
    }
    detail.comments = [
      {
        id: 'cmt-1',
        body: 'First!',
        createdAt: new Date('2026-03-02T00:00:00.000Z'),
        author: { accountId: 'account-bob', name: 'Bob', image: null },
        canDelete: false,
      },
    ]
    await setupLocal({
      catalog,
      groups: new Map([['g1', record]]),
    })
    mocks.trpcGroupsExpensesGet.mockReturnValue({
      data: undefined,
      error: new Error('offline'),
      isFetching: false,
    })
    const { Wrapper } = makeWrapper()
    const { result } = renderHook(() => useOfflineExpenseComments('g1', 'a'), {
      wrapper: Wrapper,
    })
    await waitFor(() => {
      expect(result.current.meta.availability).toBe('ready')
    })
    expect(result.current.data?.comments).toHaveLength(1)
    expect(
      (result.current.data?.comments[0] as { body?: string } | undefined)?.body,
    ).toBe('First!')
  })
})
