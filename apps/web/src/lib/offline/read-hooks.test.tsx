import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { CatalogRecord, GroupRecord } from './contract'
import * as queryWorkerModule from './query-worker'
import {
  createInlineOfflineWorkerForTests,
  createOfflineQueryClient,
} from './query-worker'
import {
  useOfflineExpenses,
  useOfflineFilterOptions,
  useOfflineGlobalExpenses,
  useOfflineGroup,
  useOfflineOverview,
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
    schemaVersion: 1,
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
    schemaVersion: 1,
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
  }
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
  beforeEach(() => {
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

  it('selects the offline download when the network has no complete result', async () => {
    const catalog = catalogWith(['g1'])
    const record = groupRecord('g1', ['a', 'b'])
    const repository = makeRepository({
      catalog,
      groups: new Map([['g1', record]]),
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
      expect(result.current.meta.availability).toBe('ready')
    })
    expect(result.current.meta.source).toBe('download')
    expect(result.current.data).toBeDefined()
  })

  it('keeps refreshing false when online but the network is idle', async () => {
    const catalog = catalogWith(['g1'])
    const record = groupRecord('g1', ['a'])
    const repository = makeRepository({
      catalog,
      groups: new Map([['g1', record]]),
    })
    mocks.useStorage.mockReturnValue(makeStorage(repository))
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
    const repository = makeRepository({
      catalog,
      groups: new Map([['g1', record]]),
    })
    mocks.useStorage.mockReturnValue(makeStorage(repository))
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
    const repository = makeRepository({
      catalog,
      groups: new Map([['g1', record]]),
    })
    mocks.useStorage.mockReturnValue(makeStorage(repository))
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
    // Slow reads so a next-page load races a filter change.
    const repository = makeRepository({
      catalog,
      groups: new Map([['g1', record]]),
    })
    const originalReadGroup = repository.readGroup
    let slowNextReads = false
    repository.readGroup = vi.fn(async (...args: unknown[]) => {
      if (slowNextReads) {
        await new Promise((resolve) => setTimeout(resolve, 30))
      }
      return (originalReadGroup as never as (...a: never[]) => never)(
        ...(args as never[]),
      ) as never
    })
    mocks.useStorage.mockReturnValue(makeStorage(repository))
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
      schemaVersion: 1,
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
    const repository = makeRepository({
      catalog: usdCatalog,
      groups: new Map([
        ['g-usd', usdRecord],
        ['g-eur', eurRecord],
      ]),
    })
    mocks.useStorage.mockReturnValue(makeStorage(repository))
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
    const repository = makeRepository({
      catalog,
      groups: new Map([['g1', record]]),
    })
    mocks.useStorage.mockReturnValue(makeStorage(repository))
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
    const repository = {
      readCatalog: vi.fn(async () => ({
        status: 'ready' as const,
        record: catalog,
      })),
      readGroup: vi.fn(async () => ({
        status: 'ready' as const,
        record: groupRecord('g1', ['a'], {
          storedAt: new Date('2026-03-09T00:00:00.000Z'),
          commitNonce: nonce,
        }),
      })),
    }
    mocks.useStorage.mockReturnValue(makeStorage(repository))
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
      expect(repository.readGroup.mock.calls.length).toBeGreaterThan(1)
    })
    void client
  })

  it('maps group download records to network list items for shared UI', async () => {
    const catalog = catalogWith(['g1'])
    const record = groupRecord('g1', ['a'])
    const repository = makeRepository({
      catalog,
      groups: new Map([['g1', record]]),
    })
    mocks.useStorage.mockReturnValue(makeStorage(repository))
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

  it('maps global download records to list items with group context', async () => {
    const catalog = catalogWith(['g1'])
    const record = groupRecord('g1', ['a'])
    const repository = makeRepository({
      catalog,
      groups: new Map([['g1', record]]),
    })
    mocks.useStorage.mockReturnValue(makeStorage(repository))
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
      readGroupImpl: async () =>
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
})
