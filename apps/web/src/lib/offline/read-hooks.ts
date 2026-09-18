import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'

import { useActiveUser } from '@/lib/hooks'
import { useCurrentAccount } from '@/lib/use-current-account'
import { useOnlineStatus } from '@/lib/use-online-status'
import { trpc } from '@/trpc/client'

import type { CatalogRecord, GroupRecord } from './contract'
import { useOfflineSession, useOptionalOfflineStorage } from './provider'
import { getDefaultOfflineQueryClient } from './query-worker'
import { offlineQueryKey, snapshotVersion } from './read-model'
import {
  OFFLINE_LOCAL_PAGE_SIZE,
  getOfflineBalances,
  getOfflineExpense,
  toOfflineGroupView,
  type GlobalQueryInput,
  type GroupExpenseFilter,
  type GroupExpenseSortBy,
  type GroupExpenseSortDir,
  type OfflineAvailability,
  type OfflineReadMeta,
  type OfflineSource,
} from './read-model'
import type {
  buildOfflineFilterOptions,
  buildOfflineOverview,
} from './read-model'
import type { OfflineRepository } from './repository'

/**
 * Read adapters.
 *
 * Each `useOffline*` hook describes an adapter including online behavior: a
 * matching complete live network result wins; otherwise a complete local
 * snapshot renders immediately. Failed revalidation retains readable data with
 * a stale/download indicator. Network and local query keys stay disjoint (local
 * prefix `['offline', namespace, generation, version, ...]` with `storedAt +
 * commitNonce` as the version, never the server timestamp alone). Whole
 * downloaded histories are never inserted into live tRPC infinite pages; server
 * pages are never appended onto local pages.
 *
 * Errors/absence are never empty arrays: `availability` distinguishes `loading
 * | ready | missing | error` and `data` stays `undefined` when not readable.
 */

export type OfflineHookResult<T> = {
  data: T | undefined
  meta: OfflineReadMeta
}

/**
 * Worker rows are download records (`{list, detail[, group]}`); network list
 * pages carry bare list items. Shared consumers (timeline, cards) expect the
 * network list shape, so map records to their `list` item at this boundary
 * (global rows keep their `group` context). Rows that are already list items
 * pass through untouched.
 */
export function toOfflineListRow(row: unknown): unknown {
  if (!row || typeof row !== 'object' || !('list' in row)) return row
  const { list, group } = row as { list?: unknown; group?: unknown }
  if (!list || typeof list !== 'object') return row
  if (group !== undefined) {
    return { ...(list as Record<string, unknown>), group }
  }
  return list
}

export function toOfflineListRows(rows: unknown[]): unknown[] {
  return rows.map(toOfflineListRow)
}

function metaFor(args: {
  networkData: boolean
  networkError: boolean
  networkFetching: boolean
  localReady: boolean
  localMissing: boolean
  capturedAt: Date | null
  incompleteGroupCount?: number
  hasMore?: boolean
  totalCount?: number
}): {
  source: OfflineSource
  availability: OfflineAvailability
  refreshing: boolean
} & Pick<
  OfflineReadMeta,
  'capturedAt' | 'incompleteGroupCount' | 'hasMore' | 'totalCount'
> {
  const incompleteGroupCount = args.incompleteGroupCount ?? 0
  if (args.networkData) {
    return {
      source: 'network',
      availability: 'ready',
      refreshing: args.networkFetching,
      capturedAt: args.capturedAt,
      incompleteGroupCount,
      hasMore: args.hasMore,
      totalCount: args.totalCount,
    }
  }
  if (args.localReady) {
    return {
      source: 'download',
      availability: 'ready',
      // Failed revalidation retains readable data with a stale indicator:
      // `refreshing` stays true while the network retries.
      refreshing: args.networkFetching,
      capturedAt: args.capturedAt,
      incompleteGroupCount,
      hasMore: args.hasMore,
      totalCount: args.totalCount,
    }
  }
  if (args.networkError && !args.localMissing) {
    return {
      source: 'download',
      availability: 'loading',
      refreshing: true,
      capturedAt: args.capturedAt,
      incompleteGroupCount,
    }
  }
  if (args.localMissing && args.networkError) {
    return {
      source: 'download',
      availability: 'missing',
      refreshing: false,
      capturedAt: null,
      incompleteGroupCount,
    }
  }
  if (args.networkError) {
    return {
      source: 'network',
      availability: 'error',
      refreshing: false,
      capturedAt: null,
      incompleteGroupCount,
    }
  }
  return {
    source: 'download',
    availability: 'loading',
    refreshing: args.networkFetching,
    capturedAt: args.capturedAt,
    incompleteGroupCount,
  }
}

function useOfflineRepository(): OfflineRepository | null {
  const storage = useOptionalOfflineStorage()
  const [version, setVersion] = useState(0)
  useEffect(() => {
    if (!storage) return
    const unsubscribe = storage.subscribe(() =>
      setVersion((value) => value + 1),
    )
    return unsubscribe
  }, [storage])
  void version
  try {
    return storage?.getRepository() ?? null
  } catch {
    return null
  }
}

function useOfflineCatalog(): {
  catalog: CatalogRecord | null
  catalogStatus:
    | 'loading'
    | 'ready'
    | 'missing'
    | 'error'
    | 'unsupported'
    | 'corrupt'
  capturedAt: Date | null
} {
  const { namespace, generation } = useOfflineSession()
  const repository = useOfflineRepository()
  const query = useQuery({
    queryKey: offlineQueryKey(namespace ?? '', generation, 'catalog'),
    queryFn: async () => {
      if (!repository || !namespace) return { status: 'missing' as const }
      return repository.readCatalog(namespace)
    },
    enabled: !!repository && !!namespace,
    networkMode: 'always',
    staleTime: 5_000,
    retry: false,
  })
  const result = query.data
  if (!namespace || !repository) {
    return { catalog: null, catalogStatus: 'loading', capturedAt: null }
  }
  if (query.isLoading || !result) {
    return { catalog: null, catalogStatus: 'loading', capturedAt: null }
  }
  if (result.status === 'ready') {
    return {
      catalog: result.record,
      catalogStatus: 'ready',
      capturedAt: result.record.capturedAt,
    }
  }
  if (result.status === 'missing') {
    return { catalog: null, catalogStatus: 'missing', capturedAt: null }
  }
  return { catalog: null, catalogStatus: result.status, capturedAt: null }
}

function useOfflineGroupRecord(groupId: string): {
  record: GroupRecord | null
  status: 'loading' | 'ready' | 'missing' | 'error' | 'unsupported'
  version: string | null
} {
  const { namespace, generation } = useOfflineSession()
  const repository = useOfflineRepository()
  const groupQueryKey = offlineQueryKey(
    namespace ?? '',
    generation,
    'group',
    groupId,
  )
  useInvalidateOnCommit([groupQueryKey])
  const query = useQuery({
    queryKey: groupQueryKey,
    queryFn: async () => {
      if (!repository || !namespace) return { status: 'missing' as const }
      const result = await repository.readGroup(namespace, groupId)
      if (result.status === 'ready')
        return { status: 'ready' as const, record: result.record }
      if (result.status === 'missing') return { status: 'missing' as const }
      if (result.status === 'unsupported')
        return {
          status: 'unsupported' as const,
          schemaVersion: result.schemaVersion,
        }
      // Corrupt entries evict to missing (repository layer owns eviction on
      // next sync). Unsupported schemas propagate distinctly so callers show
      // "Update app" instead of a dead Retry. Never synthesize readiness.
      return { status: 'missing' as const }
    },
    enabled: !!repository && !!namespace && !!groupId,
    networkMode: 'always',
    staleTime: 5_000,
    retry: false,
  })
  if (query.isLoading || !query.data) {
    return { record: null, status: 'loading', version: null }
  }
  if (query.data.status === 'ready') {
    const record = query.data.record
    return { record, status: 'ready', version: snapshotVersion(record) }
  }
  if (query.data.status === 'unsupported') {
    return { record: null, status: 'unsupported', version: null }
  }
  return { record: null, status: 'missing', version: null }
}

function useInvalidateOnCommit(keys: unknown[][]): void {
  const queryClient = useQueryClient()
  useEffect(() => {
    const handler = (event: StorageEvent) => {
      if (event.key !== 'spliit:offline:event' || !event.newValue) return
      try {
        const parsed = JSON.parse(event.newValue) as { type?: string }
        if (
          parsed.type === 'committed' ||
          parsed.type === 'catalog-changed' ||
          parsed.type === 'dirty' ||
          parsed.type === 'cleared'
        ) {
          for (const key of keys) {
            void queryClient.invalidateQueries({ queryKey: key as string[] })
          }
        }
      } catch {
        // Ignore malformed fallback events.
      }
    }
    window.addEventListener('storage', handler)
    return () => window.removeEventListener('storage', handler)
  }, [queryClient, keys])
}

// --- Overview ---------------------------------------------------------------

export function useOfflineOverview(): OfflineHookResult<{
  groups: ReturnType<typeof buildOfflineOverview>['groups']
  stats: { balanceSummaries: unknown; peopleBalances: unknown }
  totalsAvailable: boolean
  oldestCapturedAt: Date | null
  dirtyGroupCount: number
}> {
  const network = trpc.overview.get.useQuery(undefined, { retry: false })
  const { namespace, generation } = useOfflineSession()
  const repository = useOfflineRepository()
  const { catalog } = useOfflineCatalog()
  const overviewQueryKey = offlineQueryKey(
    namespace ?? '',
    generation,
    'overview',
  )
  const local = useQuery({
    queryKey: overviewQueryKey,
    queryFn: async () => {
      if (!repository || !namespace || !catalog) return null
      const snapshots: GroupRecord[] = []
      for (const entry of catalog.groups) {
        const result = await repository.readGroup(namespace, entry.overview.id)
        if (result.status === 'ready') snapshots.push(result.record)
      }
      const client = getDefaultOfflineQueryClient()
      const result = (await client.query({
        generation,
        namespace,
        kind: 'overview',
        catalog,
        snapshots,
      })) as ReturnType<typeof buildOfflineOverview>
      return result
    },
    enabled: !!repository && !!namespace && !!catalog,
    networkMode: 'always',
    staleTime: 5_000,
    retry: false,
  })
  useInvalidateOnCommit([overviewQueryKey])

  const localOverview = local.data ?? null
  const networkReady = !!network.data && !network.error
  if (networkReady) {
    return {
      data: {
        groups: (
          network.data.groups as unknown as ReturnType<
            typeof buildOfflineOverview
          >['groups']
        ).map((group) => ({
          ...group,
          availability: 'ready' as const,
          capturedAt: null,
          dirtySince: null,
        })),
        stats: network.data.stats as unknown as {
          balanceSummaries: unknown
          peopleBalances: unknown
        },
        totalsAvailable: true,
        oldestCapturedAt: null,
        dirtyGroupCount: 0,
      },
      meta: {
        source: 'network',
        capturedAt: null,
        availability: 'ready',
        refreshing: network.isFetching,
        incompleteGroupCount: 0,
      },
    }
  }
  if (localOverview) {
    return {
      data: {
        groups: localOverview.groups,
        stats: {
          balanceSummaries: localOverview.balanceSummaries,
          peopleBalances: localOverview.peopleBalances,
        },
        totalsAvailable: localOverview.totalsAvailable,
        oldestCapturedAt: localOverview.oldestCapturedAt,
        dirtyGroupCount: localOverview.dirtyGroupCount,
      },
      meta: {
        source: 'download',
        capturedAt: localOverview.oldestCapturedAt,
        availability: 'ready',
        refreshing: network.isFetching,
        incompleteGroupCount: localOverview.incompleteGroupCount,
      },
    }
  }
  const selection = metaFor({
    networkData: false,
    networkError: !!network.error,
    networkFetching: network.isFetching,
    localReady: false,
    localMissing: !local.isLoading,
    capturedAt: null,
    incompleteGroupCount: 0,
  })
  return { data: undefined, meta: selection }
}

// --- Group ------------------------------------------------------------------

export function useOfflineGroup(groupId: string): OfflineHookResult<{
  group: unknown
  displayName: string
  view: ReturnType<typeof toOfflineGroupView> | null
}> {
  const network = trpc.groups.get.useQuery(
    { groupId },
    { retry: false, enabled: !!groupId },
  )
  const { record, status } = useOfflineGroupRecord(groupId)
  const view = record ? toOfflineGroupView(record) : null
  const networkReady = !!network.data?.group && !network.error
  if (networkReady && network.data) {
    return {
      data: {
        group: network.data.group,
        displayName: network.data.displayName ?? '',
        view,
      },
      meta: {
        source: 'network',
        capturedAt: view?.capturedAt ?? null,
        availability: 'ready',
        refreshing: network.isFetching,
        incompleteGroupCount: 0,
        hasMore: view?.hasMore,
        totalCount: view?.totalCount,
      },
    }
  }
  if (view) {
    return {
      data: { group: view.group, displayName: view.overview.displayName, view },
      meta: {
        source: 'download',
        capturedAt: view.capturedAt,
        availability: 'ready',
        // Failed revalidation retains readable data; `refreshing` signals the
        // stale/download indicator while the network retries.
        refreshing: network.isFetching,
        incompleteGroupCount: 0,
        hasMore: view.hasMore,
        totalCount: view.totalCount,
      },
    }
  }
  if (status === 'unsupported') {
    return {
      data: undefined,
      meta: {
        source: 'download',
        capturedAt: null,
        availability: 'unsupported',
        refreshing: false,
        incompleteGroupCount: 0,
      },
    }
  }
  if (status === 'missing' && network.error) {
    return {
      data: undefined,
      meta: {
        source: 'download',
        capturedAt: null,
        availability: 'missing',
        refreshing: false,
        incompleteGroupCount: 1,
      },
    }
  }
  const selection = metaFor({
    networkData: false,
    networkError: !!network.error,
    networkFetching: network.isFetching,
    localReady: false,
    localMissing: status === 'missing',
    capturedAt: null,
  })
  return { data: undefined, meta: selection }
}

// --- Group expenses (paginated) ----------------------------------------------

export type OfflineExpensesOptions = {
  groupId: string
  filter?: GroupExpenseFilter
  sortBy?: GroupExpenseSortBy
  sortDir?: GroupExpenseSortDir
  collapseInvolving?: boolean
  limit?: number
}

export function useOfflineExpenses(
  options: OfflineExpensesOptions,
): OfflineHookResult<{
  pages: Array<{
    expenses: unknown[]
    hasMore: boolean
    nextOffset: number | null
  }>
  totalFiltered?: number
  involvingReturned?: number
  hiddenPending?: boolean
}> & {
  fetchNextPage: () => Promise<void>
  hasMore: boolean
  isLoading: boolean
} {
  const { groupId, filter, sortBy, sortDir, collapseInvolving, limit } = options
  const { namespace, generation, account } = useOfflineSession()
  const participantId = useActiveUser(groupId)
  const accountId = account?.id ?? null
  const isOnline = useOnlineStatus()

  // Network source: keep the existing tRPC infinite query keys disjoint from
  // local `['offline', ...]` keys. Never insert a downloaded history into a
  // live page and never append server pages onto local pages.
  const networkInput = useMemo(
    () => ({
      groupId,
      limit: limit ?? OFFLINE_LOCAL_PAGE_SIZE,
      filter: filter?.search,
      locale: filter?.locale,
      hideSettlements: filter?.hideSettlements,
      categories: filter?.categories,
      paidBy: filter?.paidBy,
      paidByMatch: filter?.paidByMatch,
      paidFor: filter?.paidFor,
      paidForMatch: filter?.paidForMatch,
      dateFrom: filter?.dateFrom,
      dateTo: filter?.dateTo,
      minAmount: filter?.minAmount,
      maxAmount: filter?.maxAmount,
      currencies: filter?.currencies,
      sortBy,
      sortDir,
      hideNotInvolving: collapseInvolving ? true : undefined,
    }),
    [groupId, limit, filter, sortBy, sortDir, collapseInvolving],
  )
  const network = trpc.groups.expenses.list.useInfiniteQuery(networkInput, {
    getNextPageParam: (page) =>
      (page as unknown as { nextCursor?: number | string }).nextCursor ??
      undefined,
    retry: false,
  })

  const {
    record,
    version,
    status: groupStatus,
  } = useOfflineGroupRecord(groupId)
  // Pagination key includes storedAt+nonce so a same-second recommit with a
  // new nonce resets pagination even when the server timestamp is unchanged.
  const filterKey = useMemo(
    () =>
      JSON.stringify({
        filter,
        sortBy,
        sortDir,
        collapseInvolving,
        limit,
        version,
      }),
    [filter, sortBy, sortDir, collapseInvolving, limit, version],
  )
  // Disjoint local pagination key (never the server timestamp alone).
  const paginationKey = useMemo(
    () =>
      offlineQueryKey(namespace ?? '', generation, version ?? 'pending', [
        filterKey,
        groupId,
      ]),
    [namespace, generation, version, filterKey, groupId],
  )
  void paginationKey
  const [localPages, setLocalPages] = useState<unknown[][]>([])
  const [localMeta, setLocalMeta] = useState<{
    nextOffset: number | null
    hasMore: boolean
  }>({
    nextOffset: null,
    hasMore: false,
  })
  const [localLoading, setLocalLoading] = useState(false)
  const [localError, setLocalError] = useState(false)
  const requestIdRef = useRef(0)
  const sourceRef = useRef<OfflineSource>('download')
  const [source, setSource] = useState<OfflineSource>('download')

  // Reset pagination when query/filter/sort/source version changes.
  useEffect(() => {
    requestIdRef.current += 1
    setLocalPages([])
    setLocalMeta({ nextOffset: null, hasMore: false })
    setLocalError(false)
    // Local stays active for the current list until the first network page
    // succeeds, then atomically reset source/pages to network.
    if (sourceRef.current === 'download' && network.data?.pages?.length) {
      sourceRef.current = 'network'
      setSource('network')
    }
  }, [filterKey, version, namespace, generation, network.data?.pages?.length])

  // Cancel obsolete loads on account/source/filter changes.
  useEffect(() => {
    const requestId = (requestIdRef.current += 1)
    const activeNamespace = namespace
    const activeRecord = record
    if (!activeRecord || !activeNamespace) return
    let cancelled = false
    const loadFirstPage = async () => {
      // While the network has a complete first page, it wins; otherwise use
      // the local snapshot immediately (cold direct routes included).
      if (network.data?.pages?.length) return
      setLocalLoading(true)
      setLocalError(false)
      try {
        const client = getDefaultOfflineQueryClient()
        const result = (await client.query({
          generation,
          namespace: activeNamespace,
          kind: 'group-expenses',
          groupId,
          filter,
          sortBy,
          sortDir,
          offset: 0,
          limit: limit ?? OFFLINE_LOCAL_PAGE_SIZE,
          collapseInvolving,
          participantId,
          accountId,
          snapshot: activeRecord,
        })) as { rows: unknown[]; nextOffset: number | null; hasMore: boolean }
        if (cancelled || requestId !== requestIdRef.current) return
        setLocalPages([toOfflineListRows(result.rows)])
        setLocalMeta({ nextOffset: result.nextOffset, hasMore: result.hasMore })
        setLocalError(false)
      } catch {
        if (!cancelled && requestId === requestIdRef.current) {
          // Worker is mandatory: a rejection (missing worker or unreadable
          // snapshot) surfaces an honest error state. Never synthesize a
          // ready-empty page from a failure.
          setLocalPages([])
          setLocalMeta({ nextOffset: null, hasMore: false })
          setLocalError(true)
        }
      } finally {
        if (!cancelled && requestId === requestIdRef.current)
          setLocalLoading(false)
      }
    }
    void loadFirstPage()
    return () => {
      cancelled = true
    }
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- depend on the serialized `filterKey` (plus record/version identity), never on the raw `filter`/`sortBy`/`sortDir`/`collapseInvolving`/`limit` values: callers pass inline objects, and depending on their identity re-fires this effect every render. Each run bumps the request id and posts a worker query, so identity deps spin an infinite query loop offline (state update -> new filter identity -> rerun).
  }, [
    record,
    namespace,
    generation,
    filterKey,
    groupId,
    network.data?.pages?.length,
    participantId,
    accountId,
  ])

  const fetchNextPage = async (): Promise<void> => {
    if (source === 'network') {
      await network.fetchNextPage()
      return
    }
    if (!record || !namespace || localMeta.nextOffset == null) return
    const requestId = requestIdRef.current
    try {
      const client = getDefaultOfflineQueryClient()
      const result = (await client.query({
        generation,
        namespace,
        kind: 'group-expenses',
        groupId,
        filter,
        sortBy,
        sortDir,
        offset: localMeta.nextOffset ?? 0,
        limit: limit ?? OFFLINE_LOCAL_PAGE_SIZE,
        collapseInvolving,
        participantId,
        accountId,
        snapshot: record,
      })) as { rows: unknown[]; nextOffset: number | null; hasMore: boolean }
      if (requestId !== requestIdRef.current) return
      setLocalPages((pages) => [...pages, toOfflineListRows(result.rows)])
      setLocalMeta({ nextOffset: result.nextOffset, hasMore: result.hasMore })
    } catch {
      // Ignore page failures; the current pages stay readable.
    }
  }

  const networkReady = !!network.data?.pages?.length && !network.error
  if (networkReady && network.data) {
    const pages = network.data.pages.map((page) => ({
      expenses: (page as unknown as { expenses: unknown[] }).expenses,
      hasMore: (page as unknown as { hasMore: boolean }).hasMore,
      nextOffset: null,
    }))
    return {
      data: { pages },
      meta: {
        source: 'network',
        capturedAt: record?.capturedAt ?? null,
        availability: 'ready',
        refreshing: network.isFetching,
        incompleteGroupCount: 0,
        hasMore:
          (
            network.data.pages.at(-1) as unknown as
              | { hasMore?: boolean }
              | undefined
          )?.hasMore ?? false,
        totalCount: record?.payload.totalCount,
      },
      fetchNextPage,
      hasMore:
        (
          network.data.pages.at(-1) as unknown as
            | { hasMore?: boolean }
            | undefined
        )?.hasMore ?? false,
      isLoading: false,
    }
  }
  if (record && localError && localPages.length === 0) {
    return {
      data: undefined,
      meta: {
        source: 'download',
        capturedAt: record.capturedAt,
        availability: 'error',
        refreshing: network.isFetching || localLoading,
        incompleteGroupCount: 0,
      },
      fetchNextPage,
      hasMore: false,
      isLoading: localLoading,
    }
  }
  if (record && (localPages.length > 0 || !localLoading)) {
    const pages = localPages.map((expenses, index) => ({
      expenses,
      hasMore: index === localPages.length - 1 ? localMeta.hasMore : true,
      nextOffset: index === localPages.length - 1 ? localMeta.nextOffset : null,
    }))
    return {
      data: {
        pages:
          pages.length > 0
            ? pages
            : [{ expenses: [], hasMore: false, nextOffset: null }],
      },
      meta: {
        source: 'download',
        capturedAt: record.capturedAt,
        availability: 'ready',
        refreshing: network.isFetching || (isOnline && localLoading),
        incompleteGroupCount: 0,
        hasMore: record.payload.hasMore,
        totalCount: record.payload.totalCount,
      },
      fetchNextPage,
      hasMore: localMeta.hasMore,
      isLoading: localLoading,
    }
  }
  if (!record && groupStatus === 'unsupported') {
    return {
      data: undefined,
      meta: {
        source: 'download',
        capturedAt: null,
        availability: 'unsupported',
        refreshing: false,
        incompleteGroupCount: 0,
      },
      fetchNextPage,
      hasMore: false,
      isLoading: false,
    }
  }
  if (!record && network.error) {
    return {
      data: undefined,
      meta: {
        source: 'download',
        capturedAt: null,
        availability: 'missing',
        refreshing: false,
        incompleteGroupCount: 1,
      },
      fetchNextPage,
      hasMore: false,
      isLoading: network.isLoading || localLoading,
    }
  }
  return {
    data: undefined,
    meta: {
      source: 'download',
      capturedAt: null,
      availability: network.error ? 'error' : 'loading',
      refreshing: network.isFetching || localLoading,
      incompleteGroupCount: 0,
    },
    fetchNextPage,
    hasMore: false,
    isLoading: true,
  }
}

// --- Expense detail ----------------------------------------------------------

export function useOfflineExpense(
  groupId: string,
  expenseId: string,
): OfflineHookResult<{
  expense: unknown
  list?: unknown
  previousExpenseId?: string | null
  nextExpenseId?: string | null
  previousAvailable?: boolean
  nextAvailable?: boolean
}> {
  const network = trpc.groups.expenses.get.useQuery(
    { groupId, expenseId },
    { retry: false },
  )
  const { record, status: expenseGroupStatus } = useOfflineGroupRecord(groupId)
  const networkReady = !!network.data?.expense && !network.error
  if (networkReady && network.data) {
    return {
      data: { expense: network.data.expense },
      meta: {
        source: 'network',
        capturedAt: record?.capturedAt ?? null,
        availability: 'ready',
        refreshing: network.isFetching,
        incompleteGroupCount: 0,
      },
    }
  }
  if (expenseGroupStatus === 'unsupported') {
    return {
      data: undefined,
      meta: {
        source: 'download',
        capturedAt: null,
        availability: 'unsupported',
        refreshing: false,
        incompleteGroupCount: 0,
      },
    }
  }
  if (record) {
    const lookup = getOfflineExpense(record.payload, expenseId)
    if (lookup.status === 'found') {
      // Attachment-metadata variant: stored detail carries id/fileName/
      // contentType/width/height without a URL. Consumers render filename +
      // "Connect to view attachments" and never issue empty-src requests.
      return {
        data: {
          expense: lookup.detail,
          list: lookup.list,
          previousExpenseId: lookup.previousExpenseId,
          nextExpenseId: lookup.nextExpenseId,
          previousAvailable: lookup.previousAvailable,
          nextAvailable: lookup.nextAvailable,
        },
        meta: {
          source: 'download',
          capturedAt: record.capturedAt,
          availability: 'ready',
          refreshing: network.isFetching,
          incompleteGroupCount: 0,
        },
      }
    }
    return {
      data: undefined,
      meta: {
        source: 'download',
        capturedAt: record.capturedAt,
        availability: 'missing',
        refreshing: network.isFetching,
        incompleteGroupCount: 0,
        hasMore: record.payload.hasMore,
        totalCount: record.payload.totalCount,
      },
    }
  }
  const selection = metaFor({
    networkData: false,
    networkError: !!network.error,
    networkFetching: network.isFetching,
    localReady: false,
    localMissing: true,
    capturedAt: null,
  })
  return { data: undefined, meta: selection }
}

// --- Balances ----------------------------------------------------------------

export function useOfflineBalances(groupId: string): OfflineHookResult<{
  balances: unknown
  participants?: unknown
  dirtySince: Date | null
}> {
  const network = trpc.groups.balances.list.useQuery(
    { groupId },
    { retry: false },
  )
  const { record, status: balancesGroupStatus } = useOfflineGroupRecord(groupId)
  const networkReady = !!network.data && !network.error
  if (networkReady) {
    return {
      data: { balances: network.data, dirtySince: record?.dirtySince ?? null },
      meta: {
        source: 'network',
        capturedAt: record?.capturedAt ?? null,
        availability: 'ready',
        refreshing: network.isFetching,
        incompleteGroupCount: 0,
      },
    }
  }
  if (balancesGroupStatus === 'unsupported') {
    return {
      data: undefined,
      meta: {
        source: 'download',
        capturedAt: null,
        availability: 'unsupported',
        refreshing: false,
        incompleteGroupCount: 0,
      },
    }
  }
  if (record) {
    // Stored server response (full-ledger correct, not capped). Totals are
    // never inferred from filtered/list pages.
    const view = getOfflineBalances(record)
    return {
      data: { balances: view.balances, dirtySince: view.dirtySince },
      meta: {
        source: 'download',
        capturedAt: view.capturedAt,
        availability: 'ready',
        refreshing: network.isFetching,
        incompleteGroupCount: 0,
      },
    }
  }
  const selection = metaFor({
    networkData: false,
    networkError: !!network.error,
    networkFetching: network.isFetching,
    localReady: false,
    localMissing: true,
    capturedAt: null,
  })
  return { data: undefined, meta: selection }
}

// --- Global expenses ----------------------------------------------------------

export type OfflineGlobalOptions = GlobalQueryInput & { limit?: number }

export function useOfflineGlobalExpenses(
  input: OfflineGlobalOptions,
): OfflineHookResult<{
  pages: Array<{ expenses: unknown[]; hasMore: boolean }>
  currencyError: 'currency-required' | null
  dirtyGroupCount: number
}> & {
  fetchNextPage: () => Promise<void>
  hasMore: boolean
  isLoading: boolean
} {
  const { namespace, generation } = useOfflineSession()
  const repository = useOfflineRepository()
  const { catalog } = useOfflineCatalog()
  const network = trpc.expenses.list.useInfiniteQuery(
    {
      limit: input.limit ?? OFFLINE_LOCAL_PAGE_SIZE,
      query:
        (input as { search?: string }).search ??
        (input as { query?: string }).query,
      groupIds: input.groupIds,
      includeArchived: input.includeArchived ?? false,
      categories: input.categories,
      paidBy: input.paidBy as never,
      paidByMatch: input.paidByMatch,
      paidFor: input.paidFor as never,
      paidForMatch: input.paidForMatch,
      hideSettlements: input.hideSettlements,
      dateFrom: input.dateFrom,
      dateTo: input.dateTo,
      minAmount: input.minAmount,
      maxAmount: input.maxAmount,
      currencies: input.currencies,
      sortBy: input.sortBy ?? 'expenseDate',
      sortDir: input.sortDir ?? 'desc',
    },
    {
      getNextPageParam: (page) =>
        (page as { nextCursor?: string | null }).nextCursor ?? undefined,
      retry: false,
    },
  )
  const inputKey = useMemo(() => JSON.stringify(input), [input])
  const [localPages, setLocalPages] = useState<unknown[][]>([])
  const [localState, setLocalState] = useState<{
    nextOffset: number | null
    hasMore: boolean
    incompleteGroupCount: number
    dirtyGroupCount: number
    currencyError: 'currency-required' | null
    truncatedGroupCount: number
    truncatedTotalCount: number | null
  }>({
    nextOffset: null,
    hasMore: false,
    incompleteGroupCount: 0,
    dirtyGroupCount: 0,
    currencyError: null,
    truncatedGroupCount: 0,
    truncatedTotalCount: null,
  })
  const [localLoading, setLocalLoading] = useState(false)
  const requestIdRef = useRef(0)
  // Recommit tick: a new commitNonce (same-second recommit included) must
  // reload global pagination even though the catalog is unchanged.
  const [commitTick, setCommitTick] = useState(0)
  useEffect(() => {
    const handler = (event: StorageEvent) => {
      if (event.key !== 'spliit:offline:event' || !event.newValue) return
      try {
        const parsed = JSON.parse(event.newValue) as { type?: string }
        if (
          parsed.type === 'committed' ||
          parsed.type === 'catalog-changed' ||
          parsed.type === 'dirty' ||
          parsed.type === 'cleared'
        ) {
          setCommitTick((value) => value + 1)
        }
      } catch {
        // Ignore malformed fallback events.
      }
    }
    window.addEventListener('storage', handler)
    return () => window.removeEventListener('storage', handler)
  }, [])

  useEffect(() => {
    const requestId = (requestIdRef.current += 1)
    if (!repository || !namespace || !catalog) return
    let cancelled = false
    if (network.data?.pages?.length) return
    const run = async () => {
      setLocalLoading(true)
      try {
        const snapshots: GroupRecord[] = []
        for (const entry of catalog.groups) {
          const result = await repository.readGroup(
            namespace,
            entry.overview.id,
          )
          if (cancelled || requestId !== requestIdRef.current) return
          if (result.status === 'ready') snapshots.push(result.record)
        }
        if (cancelled || requestId !== requestIdRef.current) return
        const parsed = JSON.parse(inputKey) as GlobalQueryInput
        const client = getDefaultOfflineQueryClient()
        const result = (await client.query({
          generation,
          namespace,
          kind: 'global-expenses',
          catalog,
          snapshots,
          filter: parsed,
          offset: 0,
          limit: parsed.limit ?? OFFLINE_LOCAL_PAGE_SIZE,
        })) as {
          rows: unknown[]
          nextOffset: number | null
          hasMore: boolean
          incompleteGroupCount: number
          dirtyGroupCount: number
          currencyError: 'currency-required' | null
          truncatedGroupCount: number
          truncatedTotalCount: number | null
        }
        if (cancelled || requestId !== requestIdRef.current) return
        setLocalPages([toOfflineListRows(result.rows)])
        setLocalState({
          nextOffset: result.nextOffset,
          hasMore: result.hasMore,
          incompleteGroupCount: result.incompleteGroupCount,
          dirtyGroupCount: result.dirtyGroupCount,
          currencyError: result.currencyError,
          truncatedGroupCount: result.truncatedGroupCount ?? 0,
          truncatedTotalCount: result.truncatedTotalCount ?? null,
        })
      } finally {
        if (!cancelled && requestId === requestIdRef.current)
          setLocalLoading(false)
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [
    repository,
    namespace,
    generation,
    catalog,
    inputKey,
    commitTick,
    network.data?.pages?.length,
  ])

  const fetchNextPage = async (): Promise<void> => {
    if (network.data?.pages?.length) {
      await network.fetchNextPage()
      return
    }
    if (!repository || !namespace || !catalog || localState.nextOffset == null)
      return
    const requestId = requestIdRef.current
    try {
      const parsed = JSON.parse(inputKey) as GlobalQueryInput
      const snapshots: GroupRecord[] = []
      for (const entry of catalog.groups) {
        const result = await repository.readGroup(namespace, entry.overview.id)
        if (requestId !== requestIdRef.current) return
        if (result.status === 'ready') snapshots.push(result.record)
      }
      if (requestId !== requestIdRef.current) return
      const client = getDefaultOfflineQueryClient()
      const result = (await client.query({
        generation,
        namespace,
        kind: 'global-expenses',
        catalog,
        snapshots,
        filter: parsed,
        offset: localState.nextOffset,
        limit: parsed.limit ?? OFFLINE_LOCAL_PAGE_SIZE,
      })) as {
        rows: unknown[]
        nextOffset: number | null
        hasMore: boolean
        incompleteGroupCount: number
        dirtyGroupCount: number
        currencyError: 'currency-required' | null
        truncatedGroupCount: number
        truncatedTotalCount: number | null
      }
      if (requestId !== requestIdRef.current) return
      setLocalPages((pages) => [...pages, toOfflineListRows(result.rows)])
      setLocalState({
        nextOffset: result.nextOffset,
        hasMore: result.hasMore,
        incompleteGroupCount: result.incompleteGroupCount,
        dirtyGroupCount: result.dirtyGroupCount,
        currencyError: result.currencyError,
        truncatedGroupCount: result.truncatedGroupCount ?? 0,
        truncatedTotalCount: result.truncatedTotalCount ?? null,
      })
    } catch {
      // Ignore page failures; the current pages stay readable.
    }
  }

  const networkReady = !!network.data?.pages?.length && !network.error
  if (networkReady && network.data) {
    return {
      data: {
        pages: network.data.pages.map((page) => ({
          expenses: (page as unknown as { expenses: unknown[] }).expenses,
          hasMore: (page as unknown as { hasMore: boolean }).hasMore,
        })),
        currencyError: null,
        dirtyGroupCount: 0,
      },
      meta: {
        source: 'network',
        capturedAt: null,
        availability: 'ready',
        refreshing: network.isFetching,
        incompleteGroupCount: 0,
      },
      fetchNextPage,
      hasMore:
        (
          network.data.pages.at(-1) as unknown as
            | { hasMore?: boolean }
            | undefined
        )?.hasMore ?? false,
      isLoading: false,
    }
  }
  if (catalog && (localPages.length > 0 || !localLoading)) {
    const truncated = localState.truncatedGroupCount > 0
    return {
      data: {
        pages: localPages.map((expenses) => ({
          expenses,
          hasMore: localState.hasMore,
        })),
        currencyError: localState.currencyError,
        dirtyGroupCount: localState.dirtyGroupCount,
      },
      meta: {
        source: 'download',
        capturedAt: catalog.capturedAt,
        availability: 'ready',
        refreshing: network.isFetching,
        incompleteGroupCount: localState.incompleteGroupCount,
        hasMore: truncated,
        totalCount: localState.truncatedTotalCount ?? undefined,
        truncatedGroupCount: localState.truncatedGroupCount,
      },
      fetchNextPage,
      hasMore: localState.hasMore,
      isLoading: localLoading,
    }
  }
  return {
    data: undefined,
    meta: {
      source: 'download',
      capturedAt: null,
      availability: network.error ? 'error' : 'loading',
      refreshing: network.isFetching || localLoading,
      incompleteGroupCount: 0,
    },
    fetchNextPage,
    hasMore: false,
    isLoading: true,
  }
}

// --- Filter options -----------------------------------------------------------

export function useOfflineFilterOptions(): OfflineHookResult<
  ReturnType<typeof buildOfflineFilterOptions>
> {
  const network = trpc.expenses.filterOptions.useQuery(undefined, {
    retry: false,
  })
  const { namespace, generation } = useOfflineSession()
  const repository = useOfflineRepository()
  const { catalog } = useOfflineCatalog()
  const filterOptionsQueryKey = offlineQueryKey(
    namespace ?? '',
    generation,
    'filter-options',
  )
  const local = useQuery({
    queryKey: filterOptionsQueryKey,
    queryFn: async () => {
      if (!repository || !namespace || !catalog) return null
      const snapshots: GroupRecord[] = []
      for (const entry of catalog.groups) {
        const result = await repository.readGroup(namespace, entry.overview.id)
        if (result.status === 'ready') snapshots.push(result.record)
      }
      // No remote prerequisite before offline list rendering: derive from
      // complete downloaded records/group context via the Worker.
      const client = getDefaultOfflineQueryClient()
      const result = (await client.query({
        generation,
        namespace,
        kind: 'filter-options',
        catalog,
        snapshots,
      })) as ReturnType<typeof buildOfflineFilterOptions>
      return result
    },
    enabled: !!repository && !!namespace && !!catalog,
    networkMode: 'always',
    staleTime: 5_000,
    retry: false,
  })
  useInvalidateOnCommit([filterOptionsQueryKey])
  const networkReady = !!network.data && !network.error
  if (networkReady) {
    return {
      data: network.data as unknown as ReturnType<
        typeof buildOfflineFilterOptions
      >,
      meta: {
        source: 'network',
        capturedAt: null,
        availability: 'ready',
        refreshing: network.isFetching,
        incompleteGroupCount: 0,
      },
    }
  }
  if (local.data) {
    return {
      data: local.data,
      meta: {
        source: 'download',
        capturedAt: catalog?.capturedAt ?? null,
        availability: 'ready',
        refreshing: network.isFetching,
        incompleteGroupCount: local.data.incompleteGroupCount,
      },
    }
  }
  const selection = metaFor({
    networkData: false,
    networkError: !!network.error,
    networkFetching: network.isFetching,
    localReady: false,
    localMissing: !local.isLoading,
    capturedAt: null,
  })
  return { data: undefined, meta: selection }
}

export type { OfflineReadMeta, OfflineSource, OfflineAvailability }
export { useCurrentAccount }
