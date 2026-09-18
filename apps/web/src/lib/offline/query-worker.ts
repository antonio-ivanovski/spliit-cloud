import type { OfflineSnapshotOutput } from '@spliit/api/offline-contract'

import type { CatalogRecord, GroupRecord } from './contract'
import {
  OFFLINE_FALLBACK_CHUNK_ROWS,
  OFFLINE_LOCAL_PAGE_SIZE,
  buildOfflineFilterOptions,
  buildOfflineOverview,
  getOfflineExpense,
  paginateInvolvementLocal,
  paginateLocal,
  queryGlobalExpensesOffline,
  queryGlobalExpensesOfflineChunked,
  queryGroupExpensesOffline,
  sortGlobalRecords,
  sortGroupRecords,
  applyGroupFilters,
  type GlobalQueryInput,
  type GroupExpenseFilter,
  type GroupExpenseSortBy,
  type GroupExpenseSortDir,
} from './read-model'

/**
 * Local query engine worker.
 *
 * Filtering/sorting/pagination run in a dedicated Web Worker so large accounts
 * (acceptance: 20 groups / 10k expenses, one group with 8k) never block
 * scroll/search. The worker caches only the current query working set
 * (snapshots passed with the request) and drops account data on generation
 * events. Every reply carries `requestId` + `generation`; callers discard
 * obsolete responses.
 *
 * Worker use is mandatory: when no Worker can be created (CSP block,
 * unsupported runtime), `query()` rejects with `OfflineWorkerUnavailableError`
 * instead of silently running heavy filtering on the main thread, which would
 * violate the no-continuous-main-thread-task budget. The chunked `fallback()`
 * entry stays available for unit tests and benchmarks only; production read
 * paths never call it implicitly.
 *
 * Precaching: this module is loaded via `new Worker(new
 * URL('./query-worker.ts', import.meta.url), { type: 'module' })` so Vite emits
 * a separate JS chunk. `apps/web/vite.config.ts` precaches
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

type CachedWorkingSet = {
  namespace: string
  generation: number
  catalog: CatalogRecord | null
  byGroupId: Map<string, GroupRecord>
}

let cachedWorkingSet: CachedWorkingSet | null = null

function updateWorkingSet(request: OfflineWorkerRequest): {
  catalog: CatalogRecord | null
  byGroupId: Map<string, GroupRecord>
} {
  // Drop account data on generation events: a newer generation replaces the
  // cache wholesale; a different namespace replaces it too.
  if (
    !cachedWorkingSet ||
    cachedWorkingSet.namespace !== request.namespace ||
    cachedWorkingSet.generation !== request.generation
  ) {
    cachedWorkingSet = {
      namespace: request.namespace,
      generation: request.generation,
      catalog: request.catalog ?? null,
      byGroupId: new Map(),
    }
  }
  if (request.catalog !== undefined) {
    cachedWorkingSet.catalog = request.catalog
  }
  const byGroupId =
    cachedWorkingSet.byGroupId ??
    (cachedWorkingSet.byGroupId = new Map<string, GroupRecord>())
  if (request.snapshots) {
    for (const snapshot of request.snapshots) {
      byGroupId.set(snapshot.groupId, snapshot)
    }
  }
  if (request.snapshot) {
    byGroupId.set(request.snapshot.groupId, request.snapshot)
  }
  // Cache only the current query working set: when the request carries an
  // explicit snapshot list, drop groups not in the list so a large account
  // never accumulates every group in worker memory.
  if (request.kind === 'group-expenses') {
    const wanted = new Set<string>()
    if (request.groupId) wanted.add(request.groupId)
    if (request.snapshot) wanted.add(request.snapshot.groupId)
    if (request.snapshots) {
      for (const snapshot of request.snapshots) wanted.add(snapshot.groupId)
    }
    if (wanted.size > 0) {
      for (const key of Array.from(byGroupId.keys())) {
        if (!wanted.has(key)) byGroupId.delete(key)
      }
    }
  }
  if (request.snapshots && request.kind === 'global-expenses') {
    const wanted = new Set(
      request.snapshots.map((snapshot) => snapshot.groupId),
    )
    for (const key of Array.from(byGroupId.keys())) {
      if (!wanted.has(key)) byGroupId.delete(key)
    }
  }
  return { catalog: cachedWorkingSet.catalog, byGroupId }
}

export function dropWorkerWorkingSet(): void {
  cachedWorkingSet = null
}

export function runOfflineWorkerQuery(request: OfflineWorkerRequest): unknown {
  const { catalog, byGroupId } = updateWorkingSet(request)
  switch (request.kind) {
    case 'group-expenses': {
      const snapshot =
        request.snapshot ??
        (request.groupId ? byGroupId.get(request.groupId) : undefined)
      if (!snapshot)
        return { rows: [], totalFiltered: 0, nextOffset: null, hasMore: false }
      return queryGroupExpensesOffline(snapshot.payload, {
        filter: (request.filter as GroupExpenseFilter | undefined) ?? {},
        sortBy: request.sortBy,
        sortDir: request.sortDir,
        offset: request.offset ?? 0,
        limit: request.limit ?? OFFLINE_LOCAL_PAGE_SIZE,
        collapseInvolving: request.collapseInvolving,
        participantId: request.participantId ?? null,
        accountId: request.accountId ?? null,
      })
    }
    case 'global-expenses': {
      const baseFilter: GlobalQueryInput =
        (request.filter as GlobalQueryInput | undefined) ?? {}
      return queryGlobalExpensesOffline(catalog, byGroupId, {
        ...baseFilter,
        offset: request.offset ?? 0,
        limit: request.limit ?? OFFLINE_LOCAL_PAGE_SIZE,
      })
    }
    case 'expense-detail': {
      const snapshot =
        request.snapshot ??
        (request.groupId ? byGroupId.get(request.groupId) : undefined)
      if (!snapshot || !request.expenseId) return { status: 'missing' }
      return getOfflineExpense(snapshot.payload, request.expenseId)
    }
    case 'overview': {
      return buildOfflineOverview(catalog, byGroupId)
    }
    case 'filter-options': {
      return buildOfflineFilterOptions(catalog, byGroupId)
    }
    default:
      throw new Error(
        `unknown offline worker query: ${(request as { kind: string }).kind}`,
      )
  }
}

// Worker entry: `self.onmessage` handles `{...request}` and posts back
// `{requestId, generation, ok, result}`. Stale generations are still answered
// (callers discard by requestId/generation); the cache itself is fenced above.
if (
  typeof self !== 'undefined' &&
  typeof (self as { postMessage?: unknown }).postMessage === 'function'
) {
  const scope = self as unknown as {
    onmessage: ((event: MessageEvent<OfflineWorkerRequest>) => void) | null
  }
  scope.onmessage = (event: MessageEvent<OfflineWorkerRequest>) => {
    const request = event.data
    try {
      const result = runOfflineWorkerQuery(request)
      ;(
        self as unknown as {
          postMessage: (message: OfflineWorkerResponse) => void
        }
      ).postMessage({
        requestId: request.requestId,
        generation: request.generation,
        ok: true,
        result,
      })
    } catch (error) {
      ;(
        self as unknown as {
          postMessage: (message: OfflineWorkerResponse) => void
        }
      ).postMessage({
        requestId: request.requestId,
        generation: request.generation,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
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

type PendingRequest = {
  resolve: (value: unknown) => void
  reject: (error: unknown) => void
  generation: number
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
  let workerFailed = false
  const pending = new Map<string, PendingRequest>()

  function ensureWorker(): Worker | null {
    if (workerFailed) return null
    if (worker) return worker
    try {
      if (options?.createWorker) {
        worker = options.createWorker()
      } else if (typeof Worker !== 'undefined') {
        worker = new Worker(new URL('./query-worker.ts', import.meta.url), {
          type: 'module',
        })
      } else {
        return null
      }
      if (!worker) return null
      worker.onmessage = (event: MessageEvent<OfflineWorkerResponse>) => {
        const response = event.data
        const entry = pending.get(response.requestId)
        if (!entry) return
        // Discard obsolete replies: generation mismatch means the account or
        // source changed while the worker was computing.
        if (response.generation !== entry.generation) {
          pending.delete(response.requestId)
          return
        }
        pending.delete(response.requestId)
        if (response.ok) entry.resolve(response.result)
        else entry.reject(new Error(response.error ?? 'offline query failed'))
      }
      worker.onerror = () => {
        workerFailed = true
        for (const [id, entry] of pending) {
          pending.delete(id)
          entry.reject(
            new OfflineWorkerUnavailableError('offline worker failed'),
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
      workerFailed = true
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
    return runOfflineWorkerQuery(request)
  }

  async function query(
    request: Omit<OfflineWorkerRequest, 'requestId'> & { requestId?: string },
  ): Promise<unknown> {
    const full: OfflineWorkerRequest = {
      ...request,
      requestId: request.requestId ?? newRequestId(),
    }
    const active = ensureWorker()
    if (!active)
      return Promise.reject(
        new OfflineWorkerUnavailableError(
          'offline query worker unavailable: local filtering requires a Web Worker',
        ),
      )
    return new Promise<unknown>((resolve, reject) => {
      pending.set(full.requestId, {
        resolve,
        reject,
        generation: full.generation,
      })
      try {
        active.postMessage(full)
      } catch (error) {
        pending.delete(full.requestId)
        workerFailed = true
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
      // If the worker never answers (terminated/CSP), the caller cancels via
      // its own AbortSignal/requestId tracking; pending entries are cleared
      // on `dispose()` and on generation changes via `discardGeneration`.
    })
  }

  function discardGeneration(generation: number): void {
    for (const [id, entry] of pending) {
      if (entry.generation !== generation) {
        pending.delete(id)
        entry.reject(new DOMException('Aborted', 'AbortError'))
      }
    }
    dropWorkerWorkingSet()
  }

  function dispose(): void {
    for (const [id, entry] of pending) {
      pending.delete(id)
      entry.reject(new DOMException('Aborted', 'AbortError'))
    }
    try {
      worker?.terminate()
    } catch {
      // Ignore.
    }
    worker = null
    dropWorkerWorkingSet()
  }

  return { query, discardGeneration, dispose, fallback }
}

export type OfflineQueryClient = ReturnType<typeof createOfflineQueryClient>

let defaultClient: OfflineQueryClient | null = null
export function getDefaultOfflineQueryClient(): OfflineQueryClient {
  if (!defaultClient) defaultClient = createOfflineQueryClient()
  return defaultClient
}

export function resetDefaultOfflineQueryClientForTests(): void {
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
  const worker = {
    onmessage: null as ((event: { data: unknown }) => void) | null,
    onerror: null as ((event: unknown) => void) | null,
    postMessage(message: OfflineWorkerRequest) {
      queueMicrotask(() => {
        const reply = (data: OfflineWorkerResponse) =>
          worker.onmessage?.({ data } as MessageEvent)
        try {
          const result = runOfflineWorkerQuery(message)
          reply({
            requestId: message.requestId,
            generation: message.generation,
            ok: true,
            result,
          })
        } catch (error) {
          reply({
            requestId: message.requestId,
            generation: message.generation,
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      })
    },
    terminate() {},
  } as unknown as Worker
  return worker
}

// Re-export pure helpers for unit tests and benchmarks.
export { sortGlobalRecords }
