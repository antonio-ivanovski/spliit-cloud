import type { OfflineSnapshotOutput } from '@spliit/api/offline-contract'
import { expandCategorySelection } from '@spliit/domain'

import type {
  CatalogRecord,
  ExpenseListRow,
  GroupRecord,
  OfflineCatalogEntry,
} from './contract'
import { parseNamespace } from './contract'
import { openOfflineDatabase, type OfflineDexieDatabase } from './database'
import {
  OFFLINE_FALLBACK_CHUNK_ROWS,
  OFFLINE_LOCAL_PAGE_SIZE,
  applyGlobalFilters,
  applyGroupFilters,
  buildOfflineFilterOptions,
  buildOfflineOverview,
  listShellFromRow,
  liteGroupRecord,
  getOfflineFreshnessState,
  paginateInvolvementLocal,
  paginateLocal,
  queryGlobalExpensesOfflineChunked,
  revisionDigest,
  sortGlobalRecords,
  sortGroupRecords,
  yieldToEventLoop,
  type GlobalQueryInput,
  type GlobalQueryResult,
  type GroupExpenseFilter,
  type GroupExpenseSortBy,
  type GroupExpenseSortDir,
  type GroupQueryResult,
  type OfflineExpenseLookup,
  type OfflineFreshness,
  type OfflineExpenseRecord,
  type OfflineFilterOptions,
  type OfflineOverview,
} from './read-model'

/**
 * Local query engine worker.
 *
 * Filtering/sorting/pagination run in a dedicated Web Worker so large accounts
 * (acceptance: 20 groups / 10k expenses, one group with 8k) never block
 * scroll/search. The worker opens Dexie itself and is stateless across queries:
 * requests carry query args + namespace/generation only, never histories, and
 * results are bounded pages plus the publication identity (`serverRevision` /
 * `revisionDigest`) so callers pin pagination and reset on revision change.
 * Every reply carries `requestId` + `generation`; late account/source responses
 * are discarded AND settled.
 *
 * Worker use is mandatory: when no Worker can be created (CSP block,
 * unsupported runtime), `query()` rejects with `OfflineWorkerUnavailableError`
 * instead of silently running heavy filtering on the main thread, which would
 * violate the no-continuous-main-thread-task budget. The chunked `fallback()`
 * entry stays available for unit tests and benchmarks only; production read
 * paths never call it implicitly.
 *
 * Precaching: this module is loaded via `new Worker(new
 * URL('./query-worker-entry.ts', import.meta.url), { type: 'module' })` so Vite
 * emits a separate JS chunk. `apps/web/vite.config.ts` precaches
 * `**\/*.{html,js,css,svg,png,ico,webp,woff2,json,webmanifest}`, which includes
 * that chunk — no config change needed. Verified by inspecting the emitted SW
 * manifest for the worker chunk.
 */

export type OfflineWorkerQueryKind =
  | 'group-expenses'
  | 'global-expenses'
  | 'expense-detail'
  | 'overview'
  | 'filter-options'

export type OfflineWorkerRequest = {
  requestId: string
  generation: number
  namespace: string
  kind: OfflineWorkerQueryKind
  groupId?: string
  expenseId?: string
  filter?: GroupExpenseFilter | GlobalQueryInput
  sortBy?: GroupExpenseSortBy
  sortDir?: GroupExpenseSortDir
  offset?: number
  limit?: number
  collapseInvolving?: boolean
  participantId?: string | null
  accountId?: string | null
  locale?: string
  // Working set: validated snapshots supplied by the main thread (read via
  // read-only IDB before posting). The worker never retains more than the
  // latest request's working set.
  catalog?: CatalogRecord | null
  snapshots?: GroupRecord[]
  snapshot?: GroupRecord | null
}

export type OfflineWorkerResponse = {
  requestId: string
  generation: number
  ok: boolean
  result?: unknown
  error?: string
}

/** Control message: abort an in-flight worker query. Never a query itself. */
export type OfflineWorkerCancelMessage = {
  type: 'cancel'
  requestId: string
}

export const OFFLINE_WORKER_REQUEST_TIMEOUT_MS = 30_000

const WORKER_SCAN_CHUNK_ROWS = 500
const MIN_INDEX_KEY = 0
const MAX_INDEX_KEY = Number.MAX_SAFE_INTEGER
const MAX_TEXT_KEY = '\uffff'

let workerDb: OfflineDexieDatabase | null = null

async function getWorkerDatabase(): Promise<OfflineDexieDatabase> {
  if (workerDb) return workerDb
  const db = await openOfflineDatabase({
    onVersionChange: () => {
      if (workerDb === db) {
        try {
          db.close()
        } catch {}
        workerDb = null
      }
    },
  })
  workerDb = db
  return db
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
}

async function yieldToWorkerLoop(signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal)
  await yieldToEventLoop()
}

export type GroupEntitiesQueryResult = GroupQueryResult & {
  serverRevision: string | null
  capturedAt: Date | null
  dirtySince: Date | null
}

export type GlobalEntitiesQueryResult = GlobalQueryResult & {
  revisionDigest: string
}

export type OverviewEntitiesResult = OfflineOverview & {
  revisionDigest: string
  totalsFreshness: OfflineFreshness
}

export type FilterOptionsEntitiesResult = OfflineFilterOptions & {
  revisionDigest: string
}

async function fetchGroupListRows(
  db: OfflineDexieDatabase,
  namespace: string,
  groupId: string,
  options: {
    sortBy?: GroupExpenseSortBy
    sortDir?: GroupExpenseSortDir
    categories?: string[]
    minAmount?: number
    maxAmount?: number
  },
  signal?: AbortSignal,
): Promise<ExpenseListRow[]> {
  throwIfAborted(signal)
  if (options.categories && options.categories.length > 0) {
    const expanded = expandCategorySelection(options.categories)
    if (expanded.length === 1) {
      const category = expanded[0] as string
      return db.expenseList
        .where('[namespace+groupId+categoryId+id]')
        .between(
          [namespace, groupId, category, ''],
          [namespace, groupId, category, MAX_TEXT_KEY],
        )
        .toArray()
    }
  }
  if (options.minAmount !== undefined || options.maxAmount !== undefined) {
    return db.expenseList
      .where('[namespace+groupId+amount+id]')
      .between(
        [namespace, groupId, options.minAmount ?? MIN_INDEX_KEY],
        [namespace, groupId, options.maxAmount ?? MAX_INDEX_KEY],
      )
      .toArray()
  }
  const collection = db.expenseList
    .where('[namespace+groupId+expenseDateMs+createdAtMs+id]')
    .between(
      [namespace, groupId, MIN_INDEX_KEY, MIN_INDEX_KEY, ''],
      [namespace, groupId, MAX_INDEX_KEY, MAX_INDEX_KEY, MAX_TEXT_KEY],
    )
  if (
    (options.sortBy ?? 'expenseDate') === 'expenseDate' &&
    (options.sortDir ?? 'desc') === 'desc'
  ) {
    return collection.reverse().toArray()
  }
  return collection.toArray()
}

async function fetchDetailsForIds(
  db: OfflineDexieDatabase,
  namespace: string,
  groupId: string,
  ids: string[],
  signal?: AbortSignal,
): Promise<Map<string, OfflineExpenseRecord['detail']>> {
  const out = new Map<string, OfflineExpenseRecord['detail']>()
  if (ids.length === 0) return out
  const keys = ids.map(
    (id) => [namespace, groupId, id] as [string, string, string],
  )
  for (let index = 0; index < keys.length; index += WORKER_SCAN_CHUNK_ROWS) {
    throwIfAborted(signal)
    const chunk = keys.slice(index, index + WORKER_SCAN_CHUNK_ROWS)
    const rows = await db.expenseDetail
      .where('[namespace+groupId+id]')
      .anyOf(chunk)
      .toArray()
    for (const row of rows) out.set(row.id, row.record)
    if (index + WORKER_SCAN_CHUNK_ROWS < keys.length) {
      await yieldToEventLoop()
    }
  }
  return out
}

async function runGroupExpenses(
  db: OfflineDexieDatabase,
  request: OfflineWorkerRequest,
  signal?: AbortSignal,
): Promise<GroupEntitiesQueryResult> {
  const namespace = request.namespace
  const groupId = request.groupId ?? ''
  const empty: GroupEntitiesQueryResult = {
    rows: [],
    totalFiltered: 0,
    nextOffset: null,
    hasMore: false,
    serverRevision: null,
    capturedAt: null,
    dirtySince: null,
  }
  if (!groupId) return empty
  const meta = await db.groupMeta.get([namespace, groupId])
  if (!meta) return empty
  throwIfAborted(signal)
  const filter = (request.filter as GroupExpenseFilter | undefined) ?? {}
  const listRows = await fetchGroupListRows(
    db,
    namespace,
    groupId,
    {
      sortBy: request.sortBy,
      sortDir: request.sortDir,
      categories: filter.categories,
      minAmount: filter.minAmount,
      maxAmount: filter.maxAmount,
    },
    signal,
  )
  const shells: OfflineExpenseRecord[] = []
  for (let index = 0; index < listRows.length; index += 1) {
    shells.push(listShellFromRow(listRows[index] as ExpenseListRow))
    if (index % WORKER_SCAN_CHUNK_ROWS === WORKER_SCAN_CHUNK_ROWS - 1) {
      await yieldToWorkerLoop(signal)
    }
  }
  const filtered = applyGroupFilters(shells, filter)
  const sorted = sortGroupRecords(filtered, request.sortBy, request.sortDir)
  const limit = request.limit ?? OFFLINE_LOCAL_PAGE_SIZE
  const involvement = request.collapseInvolving
    ? paginateInvolvementLocal(
        sorted,
        request.offset ?? 0,
        request.participantId ?? null,
        request.accountId ?? null,
        limit,
      )
    : null
  const page = involvement ?? paginateLocal(sorted, request.offset ?? 0, limit)
  const details = await fetchDetailsForIds(
    db,
    namespace,
    groupId,
    page.rows.map((row) => row.list.id),
    signal,
  )
  const rows: OfflineExpenseRecord[] = []
  for (const shell of page.rows) {
    const detail = details.get(shell.list.id)
    if (!detail) continue
    rows.push({ list: shell.list, detail })
  }
  return {
    rows,
    totalFiltered: filtered.length,
    nextOffset: page.nextOffset,
    hasMore: page.hasMore,
    involvingReturned: involvement?.involvingReturned,
    hiddenPending: involvement?.hiddenPending,
    serverRevision: meta.serverRevision,
    capturedAt: meta.capturedAt,
    dirtySince: meta.dirtySince,
  }
}

async function runGlobalExpenses(
  db: OfflineDexieDatabase,
  request: OfflineWorkerRequest,
  signal?: AbortSignal,
): Promise<GlobalEntitiesQueryResult> {
  const namespace = request.namespace
  const input = (request.filter as GlobalQueryInput | undefined) ?? {}
  const empty: GlobalEntitiesQueryResult = {
    rows: [],
    totalFiltered: 0,
    nextOffset: null,
    hasMore: false,
    incompleteGroupCount: 0,
    dirtyGroupCount: 0,
    truncatedGroupCount: 0,
    truncatedTotalCount: null,
    totalsAuthoritative: false,
    currencyError: null,
    revisionDigest: '',
  }
  if (
    (input.minAmount !== undefined ||
      input.maxAmount !== undefined ||
      input.sortBy === 'amount') &&
    input.currencies?.length !== 1
  ) {
    return { ...empty, currencyError: 'currency-required' }
  }
  const catalog = await db.catalogs.get(namespace)
  if (!catalog) return empty
  throwIfAborted(signal)
  const metas = await db.groupMeta
    .where('namespace')
    .equals(namespace)
    .toArray()
  const metaByGroupId = new Map(metas.map((meta) => [meta.groupId, meta]))
  const explicitIds =
    input.groupIds && input.groupIds.length > 0 ? new Set(input.groupIds) : null
  const includeArchived = input.includeArchived ?? false
  let incompleteGroupCount = 0
  let dirtyGroupCount = 0
  const selected: Array<{
    groupId: string
    global: OfflineCatalogEntry['global']
    revision: string
  }> = []
  for (const entry of catalog.groups) {
    const groupId = entry.overview.id
    const global = entry.global
    const explicitlySelected = explicitIds?.has(groupId) ?? false
    if (!explicitIds) {
      if (global.hidden) continue
      if (global.archived && !includeArchived) continue
    } else if (!explicitlySelected) {
      continue
    }
    if (input.currencies && input.currencies.length > 0) {
      const key = (global.currencyCode ?? '') + ':' + global.currency
      if (!input.currencies.includes(key)) continue
    }
    const meta = metaByGroupId.get(groupId)
    if (!meta) {
      incompleteGroupCount += 1
      continue
    }
    if (meta.dirtySince !== null) dirtyGroupCount += 1
    selected.push({ groupId, global, revision: meta.serverRevision })
  }
  const needsDetails =
    typeof input.search === 'string' && input.search.trim() !== ''
  const candidates: Array<{
    record: OfflineExpenseRecord
    global: OfflineCatalogEntry['global']
  }> = []
  for (const selectedGroup of selected) {
    const listRows = await db.expenseList
      .where('[namespace+groupId]')
      .equals([namespace, selectedGroup.groupId])
      .toArray()
    const detailById = needsDetails
      ? await fetchDetailsForIds(
          db,
          namespace,
          selectedGroup.groupId,
          listRows.map((row) => row.id),
          signal,
        )
      : new Map<string, OfflineExpenseRecord['detail']>()
    for (let index = 0; index < listRows.length; index += 1) {
      const row = listRows[index] as ExpenseListRow
      const detail = detailById.get(row.id) ?? null
      candidates.push({
        record: {
          list: row.record,
          detail: detail as OfflineExpenseRecord['detail'],
        },
        global: selectedGroup.global,
      })
      if (index % WORKER_SCAN_CHUNK_ROWS === WORKER_SCAN_CHUNK_ROWS - 1) {
        await yieldToWorkerLoop(signal)
      }
    }
  }
  const filtered = applyGlobalFilters(candidates, input)
  const combined = filtered.map(({ record, global }) => ({
    ...record,
    group: global,
    groupId: global.id,
  }))
  const sorted = sortGlobalRecords(
    combined as Array<OfflineExpenseRecord & { groupId: string }>,
    input.sortBy,
    input.sortDir,
  )
  const page = paginateLocal(
    sorted,
    input.offset ?? 0,
    input.limit ?? OFFLINE_LOCAL_PAGE_SIZE,
  )
  let rows: GlobalEntitiesQueryResult['rows'] = page.rows.map((row) => ({
    ...(row as unknown as OfflineExpenseRecord),
    group: (row as unknown as { group: OfflineCatalogEntry['global'] }).group,
  }))
  if (!needsDetails) {
    const idsByGroup = new Map<string, string[]>()
    for (const row of page.rows) {
      const group = (row as unknown as { group: { id: string } }).group
      const ids = idsByGroup.get(group.id) ?? []
      ids.push((row as unknown as OfflineExpenseRecord).list.id)
      idsByGroup.set(group.id, ids)
    }
    const detailByKey = new Map<string, OfflineExpenseRecord['detail']>()
    for (const [groupId, ids] of idsByGroup) {
      const details = await fetchDetailsForIds(
        db,
        namespace,
        groupId,
        ids,
        signal,
      )
      for (const [id, detail] of details) {
        detailByKey.set(groupId + ':' + id, detail)
      }
    }
    rows = page.rows.map((row) => {
      const typed = row as unknown as OfflineExpenseRecord & {
        group: OfflineCatalogEntry['global']
      }
      return {
        ...typed,
        detail:
          detailByKey.get(typed.group.id + ':' + typed.list.id) ?? typed.detail,
      }
    })
  }
  let truncatedGroupCount = 0
  let truncatedTotal = 0
  for (const selectedGroup of selected) {
    const meta = metaByGroupId.get(selectedGroup.groupId)
    if (meta?.hasMore) {
      truncatedGroupCount += 1
      truncatedTotal += meta.totalCount ?? 0
    }
  }
  return {
    rows,
    totalFiltered: sorted.length,
    nextOffset: page.nextOffset,
    hasMore: page.hasMore,
    incompleteGroupCount,
    dirtyGroupCount,
    truncatedGroupCount,
    truncatedTotalCount: truncatedGroupCount > 0 ? truncatedTotal : null,
    totalsAuthoritative: false,
    currencyError: null,
    revisionDigest: revisionDigest(
      selected.map((entry) => ({
        groupId: entry.groupId,
        revision: entry.revision,
      })),
    ),
  }
}

async function runOverview(
  db: OfflineDexieDatabase,
  request: OfflineWorkerRequest,
  signal?: AbortSignal,
): Promise<OverviewEntitiesResult> {
  const namespace = request.namespace
  const catalog = await db.catalogs.get(namespace)
  const accountId = parseNamespace(namespace)?.accountId ?? ''
  if (!catalog) {
    return {
      ...buildOfflineOverview(null, new Map()),
      revisionDigest: '',
      totalsFreshness: 'fresh' as const,
    }
  }
  throwIfAborted(signal)
  const metas = await db.groupMeta
    .where('namespace')
    .equals(namespace)
    .toArray()
  const datas = await db.groupData
    .where('namespace')
    .equals(namespace)
    .toArray()
  const dataByGroupId = new Map(datas.map((data) => [data.groupId, data]))
  const lite = new Map<string, GroupRecord>()
  const revisions: Array<{ groupId: string; revision: string }> = []
  for (const meta of metas) {
    const data = dataByGroupId.get(meta.groupId)
    if (!data) continue
    lite.set(meta.groupId, liteGroupRecord(meta, data, accountId))
    revisions.push({ groupId: meta.groupId, revision: meta.serverRevision })
  }
  const overview = buildOfflineOverview(catalog, lite)
  const now = Date.now()
  const freshnessByGroupId = new Map(
    metas.map((meta) => [
      meta.groupId,
      getOfflineFreshnessState({
        dirtySince: meta.dirtySince,
        lastConfirmedAt: meta.lastConfirmedAt,
        capturedAt: meta.capturedAt,
        now,
      }),
    ]),
  )
  const groups = overview.groups.map((group) => ({
    ...group,
    // Missing groups stay unstaled: their availability drives separate UI.
    stale:
      group.availability === 'ready' &&
      (freshnessByGroupId.get(group.id) ?? 'stale') !== 'fresh',
  }))
  // Aggregate freshness = oldest contributor over ready groups.
  let totalsFreshness: OfflineFreshness = 'fresh'
  for (const meta of metas) {
    if (!dataByGroupId.has(meta.groupId)) continue
    const state = freshnessByGroupId.get(meta.groupId) ?? 'stale'
    if (state === 'dirty') {
      totalsFreshness = 'dirty'
      break
    }
    if (state === 'stale') totalsFreshness = 'stale'
  }
  return {
    ...overview,
    groups,
    revisionDigest: revisionDigest(revisions),
    totalsFreshness,
  }
}

async function runFilterOptions(
  db: OfflineDexieDatabase,
  request: OfflineWorkerRequest,
  signal?: AbortSignal,
): Promise<FilterOptionsEntitiesResult> {
  const namespace = request.namespace
  const catalog = await db.catalogs.get(namespace)
  const accountId = parseNamespace(namespace)?.accountId ?? ''
  if (!catalog) {
    return {
      ...buildOfflineFilterOptions(null, new Map()),
      revisionDigest: '',
    }
  }
  throwIfAborted(signal)
  const metas = await db.groupMeta
    .where('namespace')
    .equals(namespace)
    .toArray()
  const datas = await db.groupData
    .where('namespace')
    .equals(namespace)
    .toArray()
  const dataByGroupId = new Map(datas.map((data) => [data.groupId, data]))
  const lite = new Map<string, GroupRecord>()
  const revisions: Array<{ groupId: string; revision: string }> = []
  for (const meta of metas) {
    const data = dataByGroupId.get(meta.groupId)
    if (!data) continue
    const record = liteGroupRecord(meta, data, accountId)
    const listRows = await db.expenseList
      .where('[namespace+groupId]')
      .equals([namespace, meta.groupId])
      .toArray()
    const shells: OfflineExpenseRecord[] = []
    for (let index = 0; index < listRows.length; index += 1) {
      shells.push(listShellFromRow(listRows[index] as ExpenseListRow))
      if (index % WORKER_SCAN_CHUNK_ROWS === WORKER_SCAN_CHUNK_ROWS - 1) {
        await yieldToWorkerLoop(signal)
      }
    }
    record.payload.expenses = shells
    lite.set(meta.groupId, record)
    revisions.push({ groupId: meta.groupId, revision: meta.serverRevision })
  }
  return {
    ...buildOfflineFilterOptions(catalog, lite),
    revisionDigest: revisionDigest(revisions),
  }
}

async function runExpenseDetail(
  db: OfflineDexieDatabase,
  request: OfflineWorkerRequest,
  signal?: AbortSignal,
): Promise<OfflineExpenseLookup> {
  const namespace = request.namespace
  const groupId = request.groupId ?? ''
  const expenseId = request.expenseId ?? ''
  if (!groupId || !expenseId) return { status: 'missing' }
  const [listRow, detailRow] = await Promise.all([
    db.expenseList.get([namespace, groupId, expenseId]),
    db.expenseDetail.get([namespace, groupId, expenseId]),
  ])
  if (!listRow || !detailRow) return { status: 'missing' }
  throwIfAborted(signal)
  const detail = detailRow.record
  const previousExpenseId = detail.previousExpenseId ?? null
  const nextExpenseId = detail.nextExpenseId ?? null
  const [previousRow, nextRow] = await Promise.all([
    previousExpenseId
      ? db.expenseList.get([namespace, groupId, previousExpenseId])
      : null,
    nextExpenseId
      ? db.expenseList.get([namespace, groupId, nextExpenseId])
      : null,
  ])
  let seriesExpenseIds: string[] | undefined
  const seriesId =
    detail.recurringSeriesId ?? listRow.record.recurringSeriesId ?? null
  if (seriesId) {
    const rows = await db.expenseList
      .where('[namespace+groupId]')
      .equals([namespace, groupId])
      .toArray()
    const siblings: Array<{ id: string; sequence: number }> = []
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index] as ExpenseListRow
      if ((row.record.recurringSeriesId ?? null) === seriesId) {
        siblings.push({
          id: row.id,
          sequence: row.record.recurrenceSequence ?? Number.MAX_SAFE_INTEGER,
        })
      }
      if (index % WORKER_SCAN_CHUNK_ROWS === WORKER_SCAN_CHUNK_ROWS - 1) {
        await yieldToWorkerLoop(signal)
      }
    }
    siblings.sort((a, b) => a.sequence - b.sequence)
    seriesExpenseIds = siblings.map((sibling) => sibling.id)
  }
  return {
    status: 'found',
    list: listRow.record,
    detail,
    previousExpenseId,
    nextExpenseId,
    previousAvailable: previousExpenseId ? !!previousRow : undefined,
    nextAvailable: nextExpenseId ? !!nextRow : undefined,
    seriesExpenseIds,
  }
}

export type OfflineWorkerQueryOptions = {
  signal?: AbortSignal
}

export async function runOfflineWorkerQuery(
  request: OfflineWorkerRequest,
  options?: OfflineWorkerQueryOptions,
): Promise<unknown> {
  const db = await getWorkerDatabase()
  throwIfAborted(options?.signal)
  switch (request.kind) {
    case 'group-expenses':
      return runGroupExpenses(db, request, options?.signal)
    case 'global-expenses':
      return runGlobalExpenses(db, request, options?.signal)
    case 'expense-detail':
      return runExpenseDetail(db, request, options?.signal)
    case 'overview':
      return runOverview(db, request, options?.signal)
    case 'filter-options':
      return runFilterOptions(db, request, options?.signal)
    default:
      throw new Error(
        'unknown offline worker query: ' + (request as { kind: string }).kind,
      )
  }
}

export function dropWorkerWorkingSet(): void {
  // Stateless engine: no cached rows. Reset the worker connection so tests
  // reopen fresh databases (and versionchange recovery starts clean).
  const db = workerDb
  workerDb = null
  try {
    db?.close()
  } catch {}
}

export type OfflineQueryClientOptions = {
  createWorker?: () => Worker | null
  chunkRows?: number
}

/**
 * Rejection reason when local queries cannot run because no Web Worker is
 * available. Callers surface an honest unavailable state; they must not
 * silently fall back to main-thread filtering in production.
 */
export class OfflineWorkerUnavailableError extends Error {
  constructor(message = 'offline query worker unavailable') {
    super(message)
    this.name = 'OfflineWorkerUnavailableError'
  }
}

export type OfflineQueryRequestOptions = {
  signal?: AbortSignal
  timeoutMs?: number
}

const WORKER_FAIL_WINDOW_MS = 10_000
const WORKER_MAX_RAPID_FAILURES = 3
const WORKER_FAIL_COOLDOWN_MS = 30_000

type PendingRequest = {
  resolve: (value: unknown) => void
  reject: (error: unknown) => void
  generation: number
  timer: ReturnType<typeof setTimeout> | null
  cleanupSignal: (() => void) | null
  settled: boolean
}

function newRequestId(): string {
  try {
    const fn = globalThis.crypto?.randomUUID?.bind(globalThis.crypto)
    if (fn) return fn()
  } catch {
    // Fall through.
  }
  return `q-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

/**
 * Main-thread client for the local query engine. Requires a dedicated Worker
 * (mandatory); when none is available the query rejects with
 * {@link OfflineWorkerUnavailableError}. Callers pass `requestId`/`generation`
 * and discard obsolete replies when account/source/filter changes.
 */
export function createOfflineQueryClient(options?: OfflineQueryClientOptions) {
  const chunkRows = options?.chunkRows ?? OFFLINE_FALLBACK_CHUNK_ROWS
  let worker: Worker | null = null
  let consecutiveFailures = 0
  let lastFailureAt = 0
  const pending = new Map<string, PendingRequest>()

  function settlePending(
    requestId: string,
    action: (entry: PendingRequest) => void,
  ): void {
    const entry = pending.get(requestId)
    if (!entry || entry.settled) return
    entry.settled = true
    if (entry.timer !== null) clearTimeout(entry.timer)
    entry.cleanupSignal?.()
    pending.delete(requestId)
    action(entry)
  }

  function noteWorkerFailure(): void {
    const now = Date.now()
    consecutiveFailures =
      now - lastFailureAt < WORKER_FAIL_WINDOW_MS ? consecutiveFailures + 1 : 1
    lastFailureAt = now
  }

  function workerCoolingDown(): boolean {
    return (
      consecutiveFailures >= WORKER_MAX_RAPID_FAILURES &&
      Date.now() - lastFailureAt < WORKER_FAIL_COOLDOWN_MS
    )
  }

  function recreate(): void {
    consecutiveFailures = 0
    try {
      worker?.terminate()
    } catch {}
    worker = null
  }

  function recreateIfFailed(): void {
    if (consecutiveFailures > 0) recreate()
  }

  function ensureWorker(): Worker | null {
    if (worker) return worker
    if (workerCoolingDown()) return null
    try {
      if (options?.createWorker) {
        worker = options.createWorker()
      } else if (typeof Worker !== 'undefined') {
        worker = new Worker(
          new URL('./query-worker-entry.ts', import.meta.url),
          {
            type: 'module',
          },
        )
      } else {
        return null
      }
      if (!worker) return null
      worker.onmessage = (event: MessageEvent<OfflineWorkerResponse>) => {
        const response = event.data
        const entry = pending.get(response.requestId)
        if (!entry || entry.settled) return
        // Late account/source responses are discarded AND settled: a
        // generation mismatch means the account or source changed while the
        // worker was computing, so the caller must not hang.
        if (response.generation !== entry.generation) {
          settlePending(response.requestId, (stale) =>
            stale.reject(new DOMException('Aborted', 'AbortError')),
          )
          return
        }
        settlePending(response.requestId, (settled) => {
          if (response.ok) settled.resolve(response.result)
          else if (response.error === 'Aborted')
            settled.reject(new DOMException('Aborted', 'AbortError'))
          else
            settled.reject(new Error(response.error ?? 'offline query failed'))
        })
      }
      worker.onerror = () => {
        noteWorkerFailure()
        for (const [id] of pending) {
          settlePending(id, (entry) =>
            entry.reject(
              new OfflineWorkerUnavailableError('offline worker failed'),
            ),
          )
        }
        try {
          worker?.terminate()
        } catch {
          // Ignore.
        }
        worker = null
      }
      return worker
    } catch {
      noteWorkerFailure()
      return null
    }
  }

  async function chunked<T>(rows: T[], fn: (row: T) => boolean): Promise<T[]> {
    const out: T[] = []
    for (let index = 0; index < rows.length; index += 1) {
      if (fn(rows[index]!)) out.push(rows[index]!)
      if (index % chunkRows === 0 && index > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
      }
    }
    return out
  }

  async function fallback(request: OfflineWorkerRequest): Promise<unknown> {
    // Test/benchmark-only entry: the same pure functions as the worker,
    // chunked to keep the calling thread responsive. Filtering yields every
    // `chunkRows`; sorting/pagination are O(n log n) over the
    // already-filtered set. Production read paths must not call this
    // implicitly; a missing worker rejects via OfflineWorkerUnavailableError.
    if (request.kind === 'group-expenses') {
      const snapshotPayload = request.snapshot?.payload as
        | OfflineSnapshotOutput
        | undefined
      const inline = request.snapshots?.find(
        (entry) => entry.groupId === request.groupId,
      )?.payload
      const payload = snapshotPayload ?? inline
      if (!payload)
        return { rows: [], totalFiltered: 0, nextOffset: null, hasMore: false }
      const filter = (request.filter as GroupExpenseFilter | undefined) ?? {}
      const filtered = await chunked(
        payload.expenses,
        (record) => applyGroupFilters([record], filter).length > 0,
      )
      const sorted = sortGroupRecords(filtered, request.sortBy, request.sortDir)
      if (request.collapseInvolving) {
        const page = paginateInvolvementLocal(
          sorted,
          request.offset ?? 0,
          request.participantId ?? null,
          request.accountId ?? null,
          request.limit ?? OFFLINE_LOCAL_PAGE_SIZE,
        )
        return {
          rows: page.rows,
          totalFiltered: filtered.length,
          nextOffset: page.nextOffset,
          hasMore: page.hasMore,
          involvingReturned: page.involvingReturned,
          hiddenPending: page.hiddenPending,
        }
      }
      const page = paginateLocal(
        sorted,
        request.offset ?? 0,
        request.limit ?? OFFLINE_LOCAL_PAGE_SIZE,
      )
      return {
        rows: page.rows,
        totalFiltered: filtered.length,
        nextOffset: page.nextOffset,
        hasMore: page.hasMore,
      }
    }
    if (request.kind === 'global-expenses') {
      const catalog = request.catalog ?? null
      const byGroupId = new Map(
        (request.snapshots ?? []).map((entry) => [entry.groupId, entry]),
      )
      if (request.snapshot)
        byGroupId.set(request.snapshot.groupId, request.snapshot)
      const baseFilter: GlobalQueryInput =
        (request.filter as GlobalQueryInput | undefined) ?? {}
      // Chunked like the group path, yielding every `chunkRows` rows.
      return queryGlobalExpensesOfflineChunked(
        catalog,
        byGroupId,
        {
          ...baseFilter,
          offset: request.offset ?? 0,
          limit: request.limit ?? OFFLINE_LOCAL_PAGE_SIZE,
        },
        chunkRows,
      )
    }
    throw new OfflineWorkerUnavailableError(
      'fallback supports snapshot group/global queries only',
    )
  }

  async function query(
    request: Omit<OfflineWorkerRequest, 'requestId'> & { requestId?: string },
    requestOptions?: OfflineQueryRequestOptions,
  ): Promise<unknown> {
    const full: OfflineWorkerRequest = {
      ...request,
      requestId: request.requestId ?? newRequestId(),
    }
    if (requestOptions?.signal?.aborted) {
      return Promise.reject(new DOMException('Aborted', 'AbortError'))
    }
    const active = ensureWorker()
    if (!active)
      return Promise.reject(
        new OfflineWorkerUnavailableError(
          'offline query worker unavailable: local filtering requires a Web Worker',
        ),
      )
    return new Promise<unknown>((resolve, reject) => {
      const timeoutMs =
        requestOptions?.timeoutMs ?? OFFLINE_WORKER_REQUEST_TIMEOUT_MS
      const entry: PendingRequest = {
        resolve,
        reject,
        generation: full.generation,
        timer: null,
        cleanupSignal: null,
        settled: false,
      }
      pending.set(full.requestId, entry)
      const onAbort = () => {
        try {
          active.postMessage({ type: 'cancel', requestId: full.requestId })
        } catch {}
        settlePending(full.requestId, (aborted) =>
          aborted.reject(new DOMException('Aborted', 'AbortError')),
        )
      }
      const signal = requestOptions?.signal
      if (signal) {
        entry.cleanupSignal = () => signal.removeEventListener('abort', onAbort)
        signal.addEventListener('abort', onAbort, { once: true })
      }
      entry.timer = setTimeout(() => {
        try {
          active.postMessage({ type: 'cancel', requestId: full.requestId })
        } catch {}
        settlePending(full.requestId, (timedOut) =>
          timedOut.reject(
            new DOMException('offline query timed out', 'TimeoutError'),
          ),
        )
        noteWorkerFailure()
      }, timeoutMs)
      try {
        // Histories never cross into the worker: strip any test-only
        // snapshot working set before posting; the engine reads Dexie.
        const { catalog, snapshots, snapshot, ...postable } = full
        void catalog
        void snapshots
        void snapshot
        active.postMessage(postable)
      } catch (error) {
        settlePending(full.requestId, () => {})
        noteWorkerFailure()
        try {
          active.terminate()
        } catch {
          // Ignore.
        }
        worker = null
        reject(
          error instanceof OfflineWorkerUnavailableError
            ? error
            : new OfflineWorkerUnavailableError(
                'offline query worker post failed',
              ),
        )
      }
    })
  }

  function discardGeneration(generation: number): void {
    for (const [id, entry] of pending) {
      if (entry.generation !== generation) {
        settlePending(id, (stale) =>
          stale.reject(new DOMException('Aborted', 'AbortError')),
        )
      }
    }
    dropWorkerWorkingSet()
  }

  function dispose(): void {
    for (const [id] of pending) {
      settlePending(id, (entry) =>
        entry.reject(new DOMException('Aborted', 'AbortError')),
      )
    }
    try {
      worker?.terminate()
    } catch {
      // Ignore.
    }
    worker = null
    dropWorkerWorkingSet()
  }

  return {
    query,
    discardGeneration,
    dispose,
    fallback,
    recreate,
    recreateIfFailed,
  }
}

export type OfflineQueryClient = ReturnType<typeof createOfflineQueryClient>

let defaultClient: OfflineQueryClient | null = null
export function getDefaultOfflineQueryClient(): OfflineQueryClient {
  if (!defaultClient) defaultClient = createOfflineQueryClient()
  return defaultClient
}

/**
 * One controlled worker recreation after a failure (foreground return or
 * explicit retry). No-op when the worker is healthy; clears a rapid-failure
 * cooldown so the next query attempts a fresh worker instead of rejecting.
 */
export function recreateOfflineWorkerIfFailed(): void {
  try {
    getDefaultOfflineQueryClient().recreateIfFailed()
  } catch {}
}

export function clearOfflineQueryClient(): void {
  try {
    defaultClient?.dispose()
  } catch {
    // Ignore.
  }
  defaultClient = null
  dropWorkerWorkingSet()
}

/**
 * Inline Worker stand-in for unit tests (happy-dom/node have no real `Worker`).
 * It speaks the same postMessage/onmessage protocol as the worker entry by
 * running {@link runOfflineWorkerQuery} and delivering the reply on a microtask.
 * Production code never uses this: the worker stays mandatory and a missing
 * worker rejects with {@link OfflineWorkerUnavailableError}.
 */
export function createInlineOfflineWorkerForTests(): Worker {
  const controllers = new Map<string, AbortController>()
  const worker = {
    onmessage: null as ((event: { data: unknown }) => void) | null,
    onerror: null as ((event: unknown) => void) | null,
    postMessage(message: OfflineWorkerRequest | OfflineWorkerCancelMessage) {
      if (
        typeof (message as OfflineWorkerCancelMessage).type === 'string' &&
        (message as OfflineWorkerCancelMessage).type === 'cancel'
      ) {
        controllers
          .get((message as OfflineWorkerCancelMessage).requestId)
          ?.abort()
        return
      }
      const query = message as OfflineWorkerRequest
      const controller = new AbortController()
      controllers.set(query.requestId, controller)
      queueMicrotask(() => {
        const reply = (data: OfflineWorkerResponse) =>
          worker.onmessage?.({ data } as MessageEvent)
        runOfflineWorkerQuery(query, { signal: controller.signal }).then(
          (result) => {
            controllers.delete(query.requestId)
            reply({
              requestId: query.requestId,
              generation: query.generation,
              ok: true,
              result,
            })
          },
          (error: unknown) => {
            controllers.delete(query.requestId)
            reply({
              requestId: query.requestId,
              generation: query.generation,
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            })
          },
        )
      })
    },
    terminate() {},
  } as unknown as Worker
  return worker
}

// Re-export pure helpers for unit tests and benchmarks.
export { sortGlobalRecords }

export const resetDefaultOfflineQueryClientForTests = clearOfflineQueryClient
