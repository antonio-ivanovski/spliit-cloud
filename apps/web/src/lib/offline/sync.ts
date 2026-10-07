import { createTRPCClient, httpLink } from '@trpc/client'
import superjson from 'superjson'

import { getApiBaseUrl } from '@/lib/api-url'
import { trackedFetch } from '@/lib/connectivity'
import { isNetworkError } from '@/lib/network-error'
import type {
  OfflineCatalogOutput,
  OfflineSnapshotOutput,
} from '@spliit/api/offline-contract'
import type { AppRouter } from '@spliit/api/router'

import { catalogGroupIds, isSameOfflineRevision } from './contract'
import { isOfflineStorageError, isQuotaError } from './errors'
import type { OfflineRepository } from './repository'

/**
 * Predictable complete-group downloads.
 *
 * No service-worker sync queue: downloads run only in an open visible document.
 * An in-flight request finishes when hidden, but the next group does not start
 * until visible. A closed/suspended app makes no refresh guarantee.
 *
 * Lease: IDB-backed per-namespace, random tab owner, 30s expiry, renewed every
 * 10s during work; owner/generation compared inside the same control
 * transaction (repository). Loser tabs read committed results. A crashed owner
 * becomes replaceable after expiry. Generation fencing is still required on
 * every commit.
 *
 * Pass order: verify session -> fetch catalog -> commit/reconcile catalog ->
 * current group first -> missing -> dirty -> remaining by overview recency,
 * groupId tie-breaker.
 *
 * Triggers coalesce into one active pass + one pending rerun, never overlapping
 * account passes. Launch/reconnect/foreground passes download all catalog
 * groups once (complete expense history each). Mutation passes refresh catalog +
 * affected groups; mutations without a resolvable groupId request a full pass.
 * The 5min rule applies only to foreground return, never to polling while
 * active.
 *
 * Status exposes counts of complete groups (never byte progress) plus the
 * current group name with indeterminate activity for status UI. No UI is built
 * here.
 */

export const OFFLINE_SYNC_LEASE_TTL_MS = 30_000
export const OFFLINE_SYNC_LEASE_RENEW_MS = 10_000
export const OFFLINE_SYNC_SNAPSHOT_TIMEOUT_MS = 60_000
export const OFFLINE_SYNC_CATALOG_TIMEOUT_MS = 60_000
export const OFFLINE_SYNC_GROUP_RETRY_DELAY_MS = 5_000
export const OFFLINE_SYNC_MAX_RETRY_AFTER_MS = 60_000
export const OFFLINE_SYNC_FOREGROUND_STALE_MS = 5 * 60 * 1000

export type SyncTriggerKind =
  | 'launch'
  | 'reconnect'
  | 'foreground'
  | 'mutation'
  | 'unknown-outcome'

export type SyncPassKind = 'full' | 'targeted'

export type SyncPassRequest = {
  kind: SyncPassKind
  groupIds?: string[]
  triggerKind: SyncTriggerKind
}

export type SyncPhase =
  | 'idle'
  | 'verifying'
  | 'catalog'
  | 'downloading'
  | 'paused-connectivity'
  | 'rate-limited'
  | 'quota-error'
  | 'disabled'
  | 'cleared'
  | 'done'
  | 'failed'
  | 'cancelled'

export type SyncStatusSnapshot = {
  phase: SyncPhase
  isOwner: boolean
  totalGroups: number
  readyGroups: number
  currentGroupId: string | null
  currentGroupName: string | null
  activity: 'indeterminate' | null
  errors: Record<string, string>
  lastCompletedFullPassAt: number | null
  earliestRetryAt: number | null
  lastCatalogAt: number | null
}

export type SyncVerifyFn = (signal: AbortSignal) => Promise<boolean>
export type SyncFetchCatalogFn = (
  signal: AbortSignal,
) => Promise<OfflineCatalogOutput>
export type SyncFetchSnapshotFn = (
  groupId: string,
  signal: AbortSignal,
) => Promise<OfflineSnapshotOutput>

export type SyncBroadcastEvent = {
  type: 'committed' | 'catalog-changed' | 'dirty' | 'cleared'
  namespace: string
  generation: number
  groupId?: string
}

export type OfflineSyncOptions = {
  namespace: string
  repository: OfflineRepository
  verifySession: SyncVerifyFn
  fetchCatalog: SyncFetchCatalogFn
  fetchSnapshot: SyncFetchSnapshotFn
  getCurrentGroupId?: () => string | null
  isVisible?: () => boolean
  waitForVisible?: (signal: AbortSignal) => Promise<void>
  now?: () => number
  randomUUID?: () => string
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
  broadcast?: (event: SyncBroadcastEvent) => void
  onConnectivityFailure?: (error: unknown) => void
  isConnectivityError?: (error: unknown) => boolean
}

/** Shared with the Effect download service (services/offline-downloads.ts). */
export type SyncErrorClassification =
  | { kind: 'cancelled' }
  | { kind: 'revision' }
  | { kind: 'lease' }
  | { kind: 'disabled' }
  | { kind: 'quota' }
  | { kind: 'schema'; code: string }
  | { kind: 'auth' }
  | { kind: 'access'; code: string }
  | { kind: 'rate-limited'; delayMs: number }
  | { kind: 'connectivity' }
  | { kind: 'transient'; code: string }

function defaultNow(): number {
  return Date.now()
}

function defaultRandomUUID(): string {
  try {
    const fn = globalThis.crypto?.randomUUID?.bind(globalThis.crypto)
    if (fn) return fn()
  } catch {
    // Fall through to Math.random fallback.
  }
  return `sync-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

function defaultIsVisible(): boolean {
  if (typeof document === 'undefined') return true
  return document.visibilityState === 'visible'
}

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'))
      return
    }
    const id = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    if (typeof id === 'object' && id !== null && 'unref' in id) {
      ;(id as { unref?: () => void }).unref?.()
    }
    const onAbort = () => {
      clearTimeout(id)
      reject(new DOMException('Aborted', 'AbortError'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

async function defaultWaitForVisible(
  signal: AbortSignal,
  isVisible: () => boolean,
  sleepFn: (ms: number, signal?: AbortSignal) => Promise<void>,
): Promise<void> {
  while (!isVisible()) {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
    await sleepFn(500, signal)
  }
}

function getErrorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null
  const record = error as Record<string, unknown>
  const data = record.data as Record<string, unknown> | undefined
  const direct = data?.code
  if (typeof direct === 'string') return direct
  const cause = record.cause as Record<string, unknown> | undefined
  const causeData = cause?.data as Record<string, unknown> | undefined
  const nested = causeData?.code
  if (typeof nested === 'string') return nested
  return null
}

function getErrorStatus(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null
  const record = error as Record<string, unknown>
  const candidates: unknown[] = [
    record.status,
    record.statusCode,
    (record.data as Record<string, unknown> | undefined)?.httpStatus,
  ]
  const cause = record.cause as Record<string, unknown> | undefined
  if (cause) {
    candidates.push(
      cause.status,
      cause.statusCode,
      (cause.data as Record<string, unknown> | undefined)?.httpStatus,
    )
  }
  for (const candidate of candidates) {
    if (typeof candidate === 'number' && Number.isInteger(candidate)) {
      return candidate
    }
  }
  return null
}

function getRetryAfterRaw(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null
  const record = error as Record<string, unknown>
  const direct = record.retryAfter
  if (typeof direct === 'string' && direct.length > 0) return direct
  const dataRetry = (record.data as Record<string, unknown> | undefined)
    ?.retryAfter
  if (typeof dataRetry === 'string' && dataRetry.length > 0) return dataRetry
  const headerSources: unknown[] = [
    record.headers,
    record.response,
    record.cause,
  ]
  for (const source of headerSources) {
    if (!source || typeof source !== 'object') continue
    const container = source as Record<string, unknown>
    const headers =
      container.headers ??
      (container.response as Record<string, unknown> | undefined)?.headers
    if (
      headers &&
      typeof headers === 'object' &&
      'get' in headers &&
      typeof (headers as { get: unknown }).get === 'function'
    ) {
      try {
        const value = (headers as { get: (k: string) => unknown }).get(
          'retry-after',
        )
        if (typeof value === 'string' && value.length > 0) return value
      } catch {
        // Ignore header access failures.
      }
    }
  }
  return null
}

/**
 * Parse a Retry-After value (delay-seconds or HTTP-date) into milliseconds.
 * Missing/invalid values use 60s per contract. Past dates yield 0 (already
 * elapsed), never a negative wait.
 */
export function parseRetryAfterMs(
  value: string | null | undefined,
  now: number,
): number {
  if (value == null || value.trim() === '') {
    return OFFLINE_SYNC_MAX_RETRY_AFTER_MS
  }
  const trimmed = value.trim()
  if (/^\d+$/.test(trimmed)) {
    const seconds = Number.parseInt(trimmed, 10)
    if (Number.isSafeInteger(seconds) && seconds >= 0) {
      return seconds * 1000
    }
    return OFFLINE_SYNC_MAX_RETRY_AFTER_MS
  }
  const parsed = Date.parse(trimmed)
  if (!Number.isNaN(parsed)) {
    return Math.max(0, parsed - now)
  }
  return OFFLINE_SYNC_MAX_RETRY_AFTER_MS
}

function isAbortLike(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const name = 'name' in error ? String((error as { name: unknown }).name) : ''
  return name === 'AbortError' || name === 'TimeoutError'
}

export function classifySyncError(
  error: unknown,
  now: number,
  isConnectivityError?: (cause: unknown) => boolean,
): SyncErrorClassification {
  if (isOfflineStorageError(error)) {
    switch (error.code) {
      case 'generation-mismatch':
      case 'namespace-revoked':
        return { kind: 'disabled' }
      case 'revision-changed':
        return { kind: 'revision' }
      case 'lease-conflict':
        return { kind: 'lease' }
      case 'quota-exceeded':
        return { kind: 'quota' }
      case 'schema-unsupported':
      case 'invalid-payload':
      case 'corrupt-record':
        return { kind: 'schema', code: error.code }
      default:
        // storage-unavailable / storage-blocked (and any future storage
        // code): preserve the specific code so the per-group errors map
        // never leaks the internal 'cancelled' lifecycle word. The
        // schema kind carries the code through to errors + persisted
        // status via toPersistedCode below.
        return { kind: 'schema', code: error.code }
    }
  }
  if (isQuotaError(error)) return { kind: 'quota' }
  if (isAbortLike(error)) {
    const name =
      error && typeof error === 'object' && 'name' in error
        ? String((error as { name: unknown }).name)
        : ''
    // TimeoutError comes from the per-request 60s bound: transient, retryable
    // once. AbortError comes from lifecycle cancellation: stop the pass.
    if (name === 'TimeoutError') return { kind: 'transient', code: 'timeout' }
    return { kind: 'cancelled' }
  }
  const code = getErrorCode(error)
  const status = getErrorStatus(error)
  if (code === 'UNAUTHORIZED' || status === 401) return { kind: 'auth' }
  if (
    code === 'FORBIDDEN' ||
    code === 'NOT_FOUND' ||
    status === 403 ||
    status === 404
  ) {
    return { kind: 'access', code: code ?? `http-${status ?? 'unknown'}` }
  }
  if (code === 'TOO_MANY_REQUESTS' || status === 429) {
    const delayMs = parseRetryAfterMs(getRetryAfterRaw(error), now)
    return { kind: 'rate-limited', delayMs }
  }
  const connectivityCheck =
    isConnectivityError ?? ((cause: unknown) => isNetworkError(cause))
  try {
    if (connectivityCheck(error)) return { kind: 'connectivity' }
  } catch {
    // A throwing predicate never marks the error as connectivity loss.
  }
  if (code === 'BAD_REQUEST' || code === 'METHOD_NOT_SUPPORTED') {
    return { kind: 'schema', code }
  }
  if (status !== null && status >= 400 && status < 500) {
    return { kind: 'schema', code: code ?? `http-${status}` }
  }
  return { kind: 'transient', code: code ?? `http-${status ?? 'unknown'}` }
}

function overviewRecencyMs(
  entry: OfflineCatalogOutput['groups'][number],
): number {
  const raw = entry.overview.financialSummary.latestExpenseCreatedAt
  if (!raw) return 0
  const parsed = Date.parse(raw)
  return Number.isNaN(parsed) ? 0 : parsed
}

/**
 * Deterministic download order: current group first, then missing, then dirty,
 * then remaining by overview recency (newest first) with groupId tie-breaker.
 * Unsupported groups are excluded (callers surface an app-update request), as
 * are unchanged groups (their tokens matched: confirmed, not downloaded).
 */
export function orderSyncGroups(input: {
  catalog: OfflineCatalogOutput
  currentGroupId: string | null
  missingGroupIds: Set<string>
  dirtyGroupIds: Set<string>
  unsupportedGroupIds?: Set<string>
  skipGroupIds?: Set<string>
}): string[] {
  const unsupported = input.unsupportedGroupIds ?? new Set<string>()
  const skip = input.skipGroupIds ?? new Set<string>()
  const byId = new Map(
    input.catalog.groups.map((entry) => [entry.overview.id, entry]),
  )
  const recency = new Map<string, number>()
  for (const entry of input.catalog.groups) {
    recency.set(entry.overview.id, overviewRecencyMs(entry))
  }
  const byRecency = (a: string, b: string): number => {
    const diff = (recency.get(b) ?? 0) - (recency.get(a) ?? 0)
    if (diff !== 0) return diff
    return a.localeCompare(b)
  }
  const current =
    input.currentGroupId &&
    byId.has(input.currentGroupId) &&
    !unsupported.has(input.currentGroupId) &&
    !skip.has(input.currentGroupId)
      ? [input.currentGroupId]
      : []
  const currentSet = new Set(current)
  const missing = [...input.missingGroupIds]
    .filter(
      (id) =>
        byId.has(id) &&
        !unsupported.has(id) &&
        !skip.has(id) &&
        !currentSet.has(id),
    )
    .sort(byRecency)
  const missingSet = new Set([...current, ...missing])
  const dirty = [...input.dirtyGroupIds]
    .filter(
      (id) =>
        byId.has(id) &&
        !unsupported.has(id) &&
        !skip.has(id) &&
        !missingSet.has(id),
    )
    .sort(byRecency)
  const doneSet = new Set([...missingSet, ...dirty])
  const remaining = catalogGroupIds(input.catalog.groups)
    .filter((id) => !unsupported.has(id) && !skip.has(id) && !doneSet.has(id))
    .sort(byRecency)
  return [...current, ...missing, ...dirty, ...remaining]
}

/**
 * Map a pass classification to the persisted per-group status code. Shared with
 * the Effect download service (services/offline-downloads.ts).
 */
export function toPersistedCode(
  kind: SyncErrorClassification,
):
  | 'storage-unavailable'
  | 'storage-blocked'
  | 'quota-exceeded'
  | 'schema-unsupported'
  | 'invalid-payload' {
  if (kind.kind === 'quota') return 'quota-exceeded'
  if (kind.kind === 'schema') {
    if (kind.code === 'invalid-payload') return 'invalid-payload'
    if (kind.code === 'storage-blocked') return 'storage-blocked'
    if (kind.code === 'storage-unavailable') return 'storage-unavailable'
    return 'schema-unsupported'
  }
  return 'storage-unavailable'
}

/** Shared with the Effect download service (services/offline-downloads.ts). */
export function mergePassRequests(
  existing: SyncPassRequest | null,
  next: SyncPassRequest,
): SyncPassRequest {
  if (!existing) return next
  if (existing.kind === 'full' || next.kind === 'full') {
    return { kind: 'full', triggerKind: next.triggerKind }
  }
  return {
    kind: 'targeted',
    groupIds: [
      ...new Set([...(existing.groupIds ?? []), ...(next.groupIds ?? [])]),
    ].sort(),
    triggerKind: next.triggerKind,
  }
}

/**
 * Dedicated unbatched download client.
 *
 * A large snapshot must not block UI request batches, so downloads use
 * `httpLink` (never `httpBatchLink`) with SuperJSON. Callers combine the
 * returned 60s timeout with lifecycle cancellation and capture `dataRevision`
 * before starting so a late commit cannot resurrect deletes.
 */
export function createOfflineDownloadFetchers(options?: {
  baseUrl?: string
  fetchFn?: typeof fetch
}): {
  fetchCatalog: SyncFetchCatalogFn
  fetchSnapshot: SyncFetchSnapshotFn
} {
  const baseUrl = options?.baseUrl ?? getApiBaseUrl()
  const customFetch = options?.fetchFn ?? trackedFetch
  const client = createTRPCClient<AppRouter>({
    links: [
      httpLink({
        url: `${baseUrl.replace(/\/+$/, '')}/trpc`,
        transformer: superjson,
        fetch(url, init) {
          return customFetch(url, {
            ...init,
            credentials: 'include',
            cache: 'no-store',
          })
        },
      }),
    ],
  })
  return {
    fetchCatalog: (signal: AbortSignal) =>
      client.groups.offlineCatalog.query(undefined, { signal }),
    fetchSnapshot: (groupId: string, signal: AbortSignal) =>
      client.groups.offlineSnapshot.query({ groupId }, { signal }),
  }
}

export type OfflineSync = ReturnType<typeof createOfflineSync>

export function createOfflineSync(options: OfflineSyncOptions) {
  const namespace = options.namespace
  const repository = options.repository
  const verifySession = options.verifySession
  const fetchCatalog = options.fetchCatalog
  const fetchSnapshot = options.fetchSnapshot
  const getCurrentGroupId = options.getCurrentGroupId ?? (() => null)
  const isVisible = options.isVisible ?? defaultIsVisible
  const sleepFn = options.sleep ?? defaultSleep
  const waitForVisible =
    options.waitForVisible ??
    ((signal: AbortSignal) => defaultWaitForVisible(signal, isVisible, sleepFn))
  const now = options.now ?? defaultNow
  const randomUUID = options.randomUUID ?? defaultRandomUUID
  const broadcast = options.broadcast ?? (() => undefined)
  const onConnectivityFailure =
    options.onConnectivityFailure ?? (() => undefined)
  const isConnectivityError = options.isConnectivityError

  const owner = randomUUID()
  const listeners = new Set<() => void>()
  let disposed = false
  let active: Promise<void> | null = null
  let activeController: AbortController | null = null
  let pending: SyncPassRequest | null = null
  let idleWaiters: Array<() => void> = []
  let rateLimitedUntil: number | null = null
  let rateLimitedGroups = new Set<string>()
  let lastCompletedFullPassAt: number | null = null

  let status: SyncStatusSnapshot = {
    phase: 'idle',
    isOwner: false,
    totalGroups: 0,
    readyGroups: 0,
    currentGroupId: null,
    currentGroupName: null,
    activity: null,
    errors: {},
    lastCompletedFullPassAt: null,
    earliestRetryAt: null,
    lastCatalogAt: null,
  }

  function emit() {
    for (const listener of listeners) listener()
  }

  function setStatus(patch: Partial<SyncStatusSnapshot>) {
    status = { ...status, ...patch }
    emit()
  }

  function resolveIdle() {
    const waiters = idleWaiters
    idleWaiters = []
    for (const resolve of waiters) {
      try {
        resolve()
      } catch {
        // Ignore waiter failures.
      }
    }
  }

  function waitForIdle(): Promise<void> {
    if (!active && !pending) return Promise.resolve()
    return new Promise<void>((resolve) => {
      idleWaiters.push(resolve)
    })
  }

  function combineWithTimeout(
    outer: AbortSignal,
    timeoutMs: number,
  ): { signal: AbortSignal; cleanup: () => void } {
    const inner = new AbortController()
    const onOuterAbort = () => {
      inner.abort(new DOMException('Aborted', 'AbortError'))
    }
    if (outer.aborted) {
      onOuterAbort()
      return { signal: inner.signal, cleanup: () => undefined }
    }
    outer.addEventListener('abort', onOuterAbort, { once: true })
    const id = setTimeout(() => {
      inner.abort(new DOMException('Snapshot timeout', 'TimeoutError'))
    }, timeoutMs)
    if (typeof id === 'object' && id !== null && 'unref' in id) {
      ;(id as { unref?: () => void }).unref?.()
    }
    return {
      signal: inner.signal,
      cleanup: () => {
        clearTimeout(id)
        outer.removeEventListener('abort', onOuterAbort)
      },
    }
  }

  async function readControlFresh() {
    const control = await repository.readControl(namespace)
    return control
  }

  async function acquireOwnerLease(
    generation: number,
    signal: AbortSignal,
  ): Promise<{ ok: true } | { ok: false; reason: 'lease' | 'disabled' }> {
    if (signal.aborted) return { ok: false, reason: 'disabled' }
    try {
      await repository.acquireLease({
        namespace,
        generation,
        owner,
        ttlMs: OFFLINE_SYNC_LEASE_TTL_MS,
        now: now(),
      })
      setStatus({ isOwner: true })
      return { ok: true }
    } catch (error) {
      const classified = classifySyncError(error, now(), isConnectivityError)
      if (classified.kind === 'lease') {
        // Loser tabs read committed results instead of downloading.
        setStatus({ isOwner: false })
        return { ok: false, reason: 'lease' }
      }
      return { ok: false, reason: 'disabled' }
    }
  }

  function startRenewLoop(
    getGeneration: () => number,
    signal: AbortSignal,
  ): () => void {
    const id = setInterval(() => {
      if (signal.aborted || disposed) return
      void repository
        .renewLease({
          namespace,
          generation: getGeneration(),
          owner,
          ttlMs: OFFLINE_SYNC_LEASE_TTL_MS,
          now: now(),
        })
        .catch((error: unknown) => {
          const classified = classifySyncError(
            error,
            now(),
            isConnectivityError,
          )
          // Renewal loss cancels the pass; generation/lease fencing in the
          // repository already blocks further commits from this owner.
          if (
            classified.kind === 'lease' ||
            classified.kind === 'disabled' ||
            classified.kind === 'revision'
          ) {
            try {
              activeController?.abort(
                new DOMException('Lease lost', 'AbortError'),
              )
            } catch {
              // Ignore abort failures.
            }
          }
        })
    }, OFFLINE_SYNC_LEASE_RENEW_MS)
    if (typeof id === 'object' && id !== null && 'unref' in id) {
      ;(id as { unref?: () => void }).unref?.()
    }
    return () => clearInterval(id)
  }

  async function releaseOwnerLeaseQuietly(generation: number) {
    try {
      await repository.releaseLease({ namespace, generation, owner })
    } catch {
      // Best effort: expiry fences a crashed owner; generation fencing blocks
      // stale commits even when release fails.
    }
    if (!disposed) setStatus({ isOwner: false, activity: null })
  }

  async function recordGroupResult(
    generation: number,
    groupId: string,
    ok: boolean,
    classification?: SyncErrorClassification,
  ) {
    try {
      if (ok) {
        await repository.recordAttempt({
          namespace,
          generation,
          groupId,
          result: 'ok',
        })
      } else if (classification) {
        await repository.recordAttempt({
          namespace,
          generation,
          groupId,
          result: 'error',
          errorCode: toPersistedCode(classification),
        })
      }
    } catch {
      // Status writes are informational: a fenced generation already blocks
      // late commits, and readiness comes only from committed snapshots.
    }
  }

  async function runPass(request: SyncPassRequest): Promise<void> {
    const passController = new AbortController()
    activeController = passController
    const signal = passController.signal
    let generation = 0
    let stopRenew: (() => void) | null = null
    const getGeneration = () => generation
    // Per-pass transient retry bookkeeping: one auto retry per group.
    const retriedTransient = new Set<string>()
    const rerunForRevision = new Set<string>()
    let needsRerunForRevision = false

    try {
      if (disposed || signal.aborted) return
      // Revoked namespaces cannot begin work, even with a verified session.
      const ensured = await repository.ensureControl(namespace)
      generation = ensured.generation
      if (ensured.revoked) {
        setStatus({ phase: 'cancelled', activity: null })
        return
      }
      // Retry-After blocks full and targeted passes. Clear elapsed deadlines
      // or deadlines with no remaining groups so earliestRetryAt never sticks.
      if (rateLimitedUntil !== null && now() >= rateLimitedUntil) {
        rateLimitedUntil = null
        rateLimitedGroups.clear()
      }
      if (rateLimitedGroups.size === 0 && rateLimitedUntil !== null) {
        rateLimitedUntil = null
      }
      if (rateLimitedUntil === null && status.earliestRetryAt !== null) {
        setStatus({ earliestRetryAt: null })
      }
      if (rateLimitedUntil !== null && now() < rateLimitedUntil) {
        setStatus({
          phase: 'rate-limited',
          activity: null,
          earliestRetryAt: rateLimitedUntil,
        })
        return
      }

      setStatus({ phase: 'verifying', activity: null, errors: {} })
      let verified = false
      try {
        verified = await verifySession(signal)
      } catch {
        verified = false
      }
      if (disposed || signal.aborted) {
        setStatus({ phase: 'cancelled', activity: null })
        return
      }
      if (!verified) {
        // UNAUTHORIZED is not a generic offline error: verification decides.
        // Unverified passes stop without fetching or evicting.
        setStatus({ phase: 'cancelled', activity: null })
        return
      }

      // Verified sessions cache automatically; revocation remains the only
      // lifecycle gate. The retired download preference is gone.
      if (disposed || signal.aborted) return
      const lease = await acquireOwnerLease(generation, signal)
      if (!lease.ok) {
        // Loser tabs keep committed results; disabled/cleared tabs stop.
        setStatus({
          phase: lease.reason === 'lease' ? 'idle' : 'disabled',
          activity: null,
        })
        return
      }
      stopRenew = startRenewLoop(getGeneration, signal)

      // Catalog: capture dataRevision before starting; reject the commit if
      // a concurrent markDirty (e.g. a confirmed delete) changed it.
      // Downloads run only in an open visible document: the catalog fetch
      // waits like group downloads do.
      setStatus({ phase: 'catalog', activity: null })
      try {
        if (!isVisible()) {
          await waitForVisible(signal)
        }
      } catch {
        setStatus({ phase: 'cancelled', activity: null })
        return
      }
      if (disposed || signal.aborted) {
        setStatus({ phase: 'cancelled', activity: null })
        return
      }
      const controlBeforeCatalog = await readControlFresh()
      if (!controlBeforeCatalog || signal.aborted || disposed) {
        setStatus({ phase: 'cancelled', activity: null })
        return
      }
      generation = controlBeforeCatalog.generation
      if (controlBeforeCatalog.revoked) {
        setStatus({ phase: 'cancelled', activity: null })
        return
      }
      const catalogRevision = controlBeforeCatalog.dataRevision

      let catalog: OfflineCatalogOutput | null = null
      let catalogAttempts = 0
      while (catalog === null) {
        catalogAttempts += 1
        const combined = combineWithTimeout(
          signal,
          OFFLINE_SYNC_CATALOG_TIMEOUT_MS,
        )
        try {
          catalog = await fetchCatalog(combined.signal)
        } catch (error) {
          if (signal.aborted || disposed) {
            setStatus({ phase: 'cancelled', activity: null })
            return
          }
          const classified = classifySyncError(
            error,
            now(),
            isConnectivityError,
          )
          if (classified.kind === 'connectivity') {
            setStatus({ phase: 'paused-connectivity', activity: null })
            onConnectivityFailure(error)
            return
          }
          if (classified.kind === 'auth') {
            setStatus({ phase: 'cancelled', activity: null })
            return
          }
          if (classified.kind === 'rate-limited') {
            if (classified.delayMs > OFFLINE_SYNC_MAX_RETRY_AFTER_MS) {
              rateLimitedUntil = now() + classified.delayMs
              setStatus({
                phase: 'rate-limited',
                activity: null,
                earliestRetryAt: rateLimitedUntil,
              })
              return
            }
            if (catalogAttempts > 1) {
              setStatus({ phase: 'failed', activity: null })
              return
            }
            await sleepFn(classified.delayMs, signal).catch(() => {
              throw new DOMException('Aborted', 'AbortError')
            })
            if (signal.aborted) {
              setStatus({ phase: 'cancelled', activity: null })
              return
            }
            continue
          }
          if (classified.kind === 'transient' && catalogAttempts === 1) {
            await sleepFn(OFFLINE_SYNC_GROUP_RETRY_DELAY_MS, signal).catch(
              () => {
                throw new DOMException('Aborted', 'AbortError')
              },
            )
            if (signal.aborted) {
              setStatus({ phase: 'cancelled', activity: null })
              return
            }

            continue
          }
          // Catalog failure retains prior catalog/snapshots; never evict on
          // error or partial responses.
          setStatus({ phase: 'failed', activity: null })
          return
        } finally {
          combined.cleanup()
        }
      }
      if (!catalog) {
        setStatus({ phase: 'failed', activity: null })
        return
      }

      // Commit/reconcile the catalog atomically; absent memberships are
      // evicted and fenced by generation so older downloads cannot resurrect.
      try {
        const reconciled = await repository.replaceCatalog({
          namespace,
          generation,
          expectedDataRevision: catalogRevision,
          leaseOwner: owner,
          catalog,
        })
        generation = reconciled.generation
      } catch (error) {
        const classified = classifySyncError(error, now(), isConnectivityError)
        if (classified.kind === 'revision') {
          // A mutation fenced the catalog commit: restart affected work via
          // one pending rerun instead of resurrecting deletes.
          pending = mergePassRequests(pending, {
            kind: request.kind,
            groupIds: request.groupIds,
            triggerKind: request.triggerKind,
          })
          setStatus({ phase: 'cancelled', activity: null })
          return
        }
        if (
          classified.kind === 'disabled' ||
          classified.kind === 'lease' ||
          classified.kind === 'cancelled'
        ) {
          setStatus({
            phase: classified.kind === 'lease' ? 'cancelled' : 'disabled',
            activity: null,
          })
          return
        }
        setStatus({ phase: 'failed', activity: null })
        return
      }
      try {
        broadcast({
          type: 'catalog-changed',
          namespace,
          generation,
        })
      } catch {
        // Broadcast failures never block fencing.
      }
      setStatus({ lastCatalogAt: now() })

      const catalogIds = catalogGroupIds(catalog.groups)
      setStatus({ totalGroups: catalogIds.length })
      if (catalogIds.length === 0) {
        // Valid empty state after reconciling to zero.
        setStatus({ readyGroups: 0, phase: 'done', activity: null })
        if (request.kind === 'full') {
          lastCompletedFullPassAt = now()
          setStatus({ lastCompletedFullPassAt })
        }
        return
      }

      // Metadata inventory for ordering: missing / dirty / unchanged /
      // remaining. Reads metadata only (never histories): a stored token
      // equal to the published catalog token proves the history unchanged,
      // so those groups confirm freshness below instead of downloading.
      // Unsupported schemas are never interpreted or overwritten.
      const missing = new Set<string>()
      const dirty = new Set<string>()
      const unchanged = new Set<string>()
      const unchangedTokens = new Map<string, string>()
      const unsupported = new Set<string>()
      const names = new Map<string, string>()
      let initialReady = 0
      for (const entry of catalog.groups) {
        const id = entry.overview.id
        names.set(id, entry.overview.displayName ?? entry.overview.name)
        const read = await repository.readGroupMeta(namespace, id)
        if (signal.aborted || disposed) {
          setStatus({ phase: 'cancelled', activity: null })
          return
        }
        if (read.status === 'ready') {
          initialReady += 1
          if (read.record.dirtySince !== null) {
            dirty.add(id)
          } else if (
            isSameOfflineRevision(read.record.serverRevision, entry.revision)
          ) {
            unchanged.add(id)
            unchangedTokens.set(id, entry.revision)
          }
        } else if (read.status === 'unsupported') {
          unsupported.add(id)
        } else {
          missing.add(id)
        }
      }
      setStatus({ readyGroups: initialReady })
      // Confirm unchanged tokens without expense rewrites: only
      // `lastConfirmedAt` advances, the original capture stays pinned.
      // Best-effort freshness (a failed confirmation retries next pass);
      // it never fails the download pass.
      for (const groupId of unchanged) {
        if (disposed || signal.aborted) {
          setStatus({ phase: 'cancelled', activity: null })
          return
        }
        try {
          await repository.confirmGroup({
            namespace,
            generation,
            groupId,
            serverRevision: unchangedTokens.get(groupId) ?? '',
            now: new Date(now()),
          })
        } catch {
          // Confirmation is advisory; the token match observed this pass
          // already proves the data current.
        }
      }
      const currentGroupId = getCurrentGroupId()

      let ordered: string[]
      if (request.kind === 'targeted') {
        const wanted = new Set(
          (request.groupIds ?? []).filter((id) => catalogIds.includes(id)),
        )
        // Mutations without a resolvable groupId request a full pass; callers
        // map that to kind full before reaching here.
        const targetedMissing = new Set(
          [...wanted].filter((id) => missing.has(id)),
        )
        const targetedDirty = new Set([...wanted].filter((id) => dirty.has(id)))
        ordered = orderSyncGroups({
          catalog: {
            ...catalog,
            groups: catalog.groups.filter((entry) =>
              wanted.has(entry.overview.id),
            ),
          },
          currentGroupId,
          missingGroupIds: targetedMissing,
          dirtyGroupIds: targetedDirty,
          unsupportedGroupIds: unsupported,
          skipGroupIds: unchanged,
        })
      } else {
        ordered = orderSyncGroups({
          catalog,
          currentGroupId,
          missingGroupIds: missing,
          dirtyGroupIds: dirty,
          unsupportedGroupIds: unsupported,
          skipGroupIds: unchanged,
        })
      }

      const errors: Record<string, string> = { ...status.errors }
      let ready = initialReady
      let completedAll = true

      for (const groupId of ordered) {
        if (disposed || signal.aborted) {
          completedAll = false
          break
        }
        // Downloads run only in an open visible document. In-flight work
        // finishes when hidden; the next group waits until visible.
        try {
          if (!isVisible()) {
            await waitForVisible(signal)
          }
        } catch {
          completedAll = false
          break
        }
        if (disposed || signal.aborted) {
          completedAll = false
          break
        }
        // Retry-After deadline is never bypassed, by reconnect or foreground triggers.
        if (
          rateLimitedGroups.has(groupId) &&
          rateLimitedUntil !== null &&
          now() < rateLimitedUntil
        ) {
          errors[groupId] = 'rate-limited'
          continue
        }
        const wasMissing = missing.has(groupId)
        setStatus({
          phase: 'downloading',
          currentGroupId: groupId,
          currentGroupName: names.get(groupId) ?? groupId,
          activity: 'indeterminate',
        })

        const controlBefore = await readControlFresh()
        if (!controlBefore || signal.aborted || disposed) {
          completedAll = false
          break
        }
        if (controlBefore.generation !== generation) {
          // Disabled/cleared/signed-out mid-pass: cancel, fence commits.
          generation = controlBefore.generation
          completedAll = false
          setStatus({ phase: 'cancelled', activity: null })
          break
        }
        if (controlBefore.revoked) {
          completedAll = false
          setStatus({ phase: 'cancelled', activity: null })
          break
        }
        const expectedDataRevision = controlBefore.dataRevision

        let snapshot: OfflineSnapshotOutput | null = null
        let attempts = 0
        let groupDone = false
        while (!groupDone) {
          attempts += 1
          const combined = combineWithTimeout(
            signal,
            OFFLINE_SYNC_SNAPSHOT_TIMEOUT_MS,
          )
          try {
            snapshot = await fetchSnapshot(groupId, combined.signal)
            groupDone = true
          } catch (error) {
            if (signal.aborted || disposed) {
              completedAll = false
              groupDone = true
              snapshot = null
              break
            }
            const classified = classifySyncError(
              error,
              now(),
              isConnectivityError,
            )
            if (classified.kind === 'connectivity') {
              // Global failure pauses the pass and hands to recovery probes.
              completedAll = false
              groupDone = true
              snapshot = null
              setStatus({ phase: 'paused-connectivity', activity: null })
              onConnectivityFailure(error)
              break
            }
            if (classified.kind === 'auth') {
              errors[groupId] = 'auth'
              await recordGroupResult(generation, groupId, false, classified)
              groupDone = true
              snapshot = null
              break
            }
            if (classified.kind === 'access') {
              // Confirmed FORBIDDEN/NOT_FOUND evicts the local copy so
              // aggregates invalidate immediately. No retry.
              try {
                const evicted = await repository.evictGroup({
                  namespace,
                  generation,
                  groupId,
                })
                void evicted
                const fresh = await readControlFresh()
                if (fresh) generation = fresh.generation
              } catch {
                // Eviction fencing failures cancel the pass below.
              }
              errors[groupId] = classified.code
              await recordGroupResult(generation, groupId, false, classified)
              groupDone = true
              snapshot = null
              break
            }
            if (classified.kind === 'rate-limited') {
              if (classified.delayMs > OFFLINE_SYNC_MAX_RETRY_AFTER_MS) {
                // End automatic work for the pass, retain error/readiness,
                // store the deadline; later triggers retry only after it.
                rateLimitedUntil = now() + classified.delayMs
                rateLimitedGroups.add(groupId)
                errors[groupId] = 'rate-limited'
                await recordGroupResult(generation, groupId, false, classified)
                setStatus({
                  phase: 'rate-limited',
                  activity: null,
                  earliestRetryAt: rateLimitedUntil,
                  errors: { ...errors },
                })
                completedAll = false
                groupDone = true
                snapshot = null
                break
              }
              if (attempts > 1) {
                errors[groupId] = 'rate-limited'
                await recordGroupResult(generation, groupId, false, classified)
                groupDone = true
                snapshot = null
                break
              }
              try {
                await sleepFn(classified.delayMs, signal)
              } catch {
                completedAll = false
                groupDone = true
                snapshot = null
                break
              }
              continue
            }
            if (
              classified.kind === 'schema' ||
              classified.kind === 'quota' ||
              classified.kind === 'disabled' ||
              classified.kind === 'lease' ||
              classified.kind === 'revision'
            ) {
              if (classified.kind === 'quota') {
                // Quota abort preserves old data; stop new writes for the
                // pass; future automatic passes remain suspended.
                errors[groupId] = 'quota-exceeded'
                await recordGroupResult(generation, groupId, false, classified)
                setStatus({
                  phase: 'quota-error',
                  activity: null,
                  errors: { ...errors },
                })
                completedAll = false
                groupDone = true
                snapshot = null
                break
              }
              if (classified.kind === 'revision') {
                // Concurrent mutation fenced this capture: restart affected
                // work via a pending rerun instead of resurrecting deletes.
                needsRerunForRevision = true
                groupDone = true
                snapshot = null
                break
              }
              errors[groupId] =
                classified.kind === 'schema' ? classified.code : classified.kind
              await recordGroupResult(generation, groupId, false, classified)
              if (
                classified.kind === 'disabled' ||
                classified.kind === 'lease'
              ) {
                completedAll = false
              }
              groupDone = true
              snapshot = null
              break
            }
            // Transient: one auto retry after 5s per group per pass, then
            // continue to other groups so a failed large group never starves.
            if (
              classified.kind === 'transient' &&
              attempts === 1 &&
              !retriedTransient.has(groupId)
            ) {
              retriedTransient.add(groupId)

              try {
                await sleepFn(OFFLINE_SYNC_GROUP_RETRY_DELAY_MS, signal)
              } catch {
                completedAll = false
                groupDone = true
                snapshot = null
                break
              }
              if (signal.aborted || disposed) {
                completedAll = false
                groupDone = true
                snapshot = null
                break
              }

              continue
            }
            errors[groupId] =
              classified.kind === 'transient'
                ? classified.code
                : classified.kind
            await recordGroupResult(generation, groupId, false, classified)
            groupDone = true
            snapshot = null
            break
          } finally {
            combined.cleanup()
          }
        }

        if (!snapshot) {
          // Failed groups retain prior readiness; continue to others unless
          // the pass was paused/cancelled above.
          if (
            status.phase === 'paused-connectivity' ||
            status.phase === 'quota-error' ||
            status.phase === 'rate-limited'
          ) {
            completedAll = false
            break
          }
          if (signal.aborted || disposed) {
            completedAll = false
            break
          }
          // Revision-fenced captures leave the group dirty for the rerun.
          if (
            needsRerunForRevision &&
            rerunForRevision.has(groupId) === false
          ) {
            rerunForRevision.add(groupId)
          }
          setStatus({ errors: { ...errors } })
          continue
        }

        // Commit: validate outside the tx, fence generation/dataRevision/lease
        // inside the same control tx. A concurrent delete bumps dataRevision
        // so this older capture is rejected entirely (never resurrected).
        try {
          await repository.commitGroup({
            namespace,
            generation,
            expectedDataRevision,
            snapshot,
            leaseOwner: owner,
          })
          if (wasMissing) ready += 1
          delete errors[groupId]
          rateLimitedGroups.delete(groupId)
          if (rateLimitedGroups.size === 0 && rateLimitedUntil !== null) {
            rateLimitedUntil = null
            setStatus({
              readyGroups: ready,
              errors: { ...errors },
              earliestRetryAt: null,
            })
          } else {
            setStatus({ readyGroups: ready, errors: { ...errors } })
          }
          await recordGroupResult(generation, groupId, true)
          try {
            broadcast({ type: 'committed', namespace, generation, groupId })
          } catch {
            // Ignore broadcast failures.
          }
        } catch (error) {
          const classified = classifySyncError(
            error,
            now(),
            isConnectivityError,
          )
          if (classified.kind === 'revision') {
            // Mutation during capture: retain the old complete snapshot with
            // its dirty marker; restart affected work via pending rerun.
            needsRerunForRevision = true
            rerunForRevision.add(groupId)
            setStatus({ errors: { ...errors } })
            continue
          }
          if (
            classified.kind === 'disabled' ||
            classified.kind === 'lease' ||
            classified.kind === 'cancelled'
          ) {
            // Disable/clear/renewal-loss fences all further commits.
            completedAll = false
            setStatus({
              phase: classified.kind === 'lease' ? 'cancelled' : status.phase,
              activity: null,
              errors: { ...errors },
            })
            break
          }
          errors[groupId] =
            classified.kind === 'schema' ? classified.code : classified.kind
          await recordGroupResult(generation, groupId, false, classified)
          if (classified.kind === 'quota') {
            completedAll = false
            setStatus({
              phase: 'quota-error',
              activity: null,
              errors: { ...errors },
            })
            break
          }
          setStatus({ errors: { ...errors } })
          continue
        }
      }

      if (disposed || signal.aborted) {
        setStatus({ phase: 'cancelled', activity: null })
        return
      }
      if (
        status.phase === 'paused-connectivity' ||
        status.phase === 'quota-error' ||
        status.phase === 'rate-limited'
      ) {
        setStatus({ activity: null, errors: { ...errors } })
        return
      }
      if (needsRerunForRevision) {
        pending = mergePassRequests(pending, {
          kind: request.kind,
          groupIds: [...rerunForRevision],
          triggerKind: request.triggerKind,
        })
      }
      if (rateLimitedGroups.size === 0 && rateLimitedUntil !== null) {
        rateLimitedUntil = null
      }
      if (rateLimitedUntil !== null && now() >= rateLimitedUntil) {
        rateLimitedUntil = null
        rateLimitedGroups.clear()
      }
      const clearedEarliest =
        rateLimitedUntil === null && status.earliestRetryAt !== null
          ? { earliestRetryAt: null as number | null }
          : {}
      const hasErrors = Object.keys(errors).length > 0
      setStatus({
        phase: completedAll ? (hasErrors ? 'failed' : 'done') : 'cancelled',
        activity: null,
        currentGroupId: null,
        currentGroupName: null,
        errors,
        ...clearedEarliest,
      })
      if (completedAll && request.kind === 'full') {
        lastCompletedFullPassAt = now()
        setStatus({ lastCompletedFullPassAt })
      }
    } catch (error) {
      if (signal.aborted || disposed) {
        setStatus({ phase: 'cancelled', activity: null })
      } else {
        setStatus({
          phase:
            classifySyncError(error, now(), isConnectivityError).kind ===
            'quota'
              ? 'quota-error'
              : 'failed',
          activity: null,
        })
      }
    } finally {
      stopRenew?.()
      try {
        await releaseOwnerLeaseQuietly(generation)
      } catch {
        // Ignore release failures.
      }
      setStatus({
        activity: null,
        currentGroupId: null,
        currentGroupName: null,
      })
      activeController = null
    }
  }

  async function pump(): Promise<void> {
    if (active || disposed) return
    if (status.phase === 'quota-error') {
      pending = null
      resolveIdle()
      return
    }
    const next = pending
    if (!next) {
      resolveIdle()
      return
    }
    pending = null
    active = runPass(next).finally(() => {
      active = null
      if (disposed) {
        pending = null
        resolveIdle()
        return
      }
      // One pending rerun coalesces triggers that arrived mid-pass; never
      // overlapping account passes.
      if (pending) {
        void pump()
      } else {
        resolveIdle()
      }
    })
    try {
      await active
    } catch {
      // runPass never rejects with actionable errors; phase carries state.
    }
  }

  function requestSync(request: SyncPassRequest): Promise<void> {
    // Storage pressure cannot be repaired by more network traffic. Keep the
    // last snapshots and retry only in a new app lifecycle.
    if (disposed || status.phase === 'quota-error') return Promise.resolve()
    pending = mergePassRequests(pending, request)
    const idle = waitForIdle()
    void pump()
    return idle
  }

  function requestFull(triggerKind: SyncTriggerKind): Promise<void> {
    return requestSync({ kind: 'full', triggerKind })
  }

  return {
    /** Coalesced trigger entry point. Never runs overlapping account passes. */
    requestSync,
    /** Authenticated launch: verify, then download all catalog groups once. */
    handleLaunch: () => requestFull('launch'),
    /**
     * Successful reconnect auto path. Call after the recovery probe reports
     * reachable and session verification succeeds; the pass verifies again
     * (idempotent) then downloads all groups.
     */
    handleReconnect: () => requestFull('reconnect'),
    /** Foreground return: full pass only when the last one is older than 5min. */
    handleForeground: () => {
      if (disposed) return Promise.resolve()
      if (
        lastCompletedFullPassAt !== null &&
        now() - lastCompletedFullPassAt <= OFFLINE_SYNC_FOREGROUND_STALE_MS
      ) {
        return Promise.resolve()
      }
      return requestFull('foreground')
    },
    /**
     * Successful online mutation: existing success stays immediate; this
     * schedules an offline refresh asynchronously without delaying success.
     * Callers must not await this before resolving the mutation. Mutations
     * without a resolvable groupId request a full pass.
     */
    handleMutationSuccess: async (input?: { groupIds?: string[] }) => {
      if (disposed) return Promise.resolve()
      const ids = [...new Set(input?.groupIds ?? [])].sort()
      if (ids.length === 0) return requestFull('mutation')
      const control = await repository.readControl(namespace)
      if (!control) return
      await repository.markDirty({
        namespace,
        generation: control.generation,
        dirtyGroupIds: ids,
      })
      for (const groupId of ids)
        broadcast({
          type: 'dirty',
          namespace,
          generation: control.generation,
          groupId,
        })
      return requestSync({
        kind: 'targeted',
        groupIds: ids,
        triggerKind: 'mutation',
      })
    },
    /**
     * Write with unknown outcome (response lost): never auto-replays the write.
     * Retains the idempotency flow and refreshes reads when possible.
     */
    handleWriteUnknownOutcome: (input?: { groupIds?: string[] }) => {
      if (disposed) return Promise.resolve()
      const ids = [...new Set(input?.groupIds ?? [])].sort()
      if (ids.length === 0) return requestFull('unknown-outcome')
      return requestSync({
        kind: 'targeted',
        groupIds: ids,
        triggerKind: 'unknown-outcome',
      })
    },
    /**
     * Successful online expense delete: atomically removes the expense from
     * local list/detail and marks balances/overview stale (dirtySince). Totals
     * are never hand-recalculated; a targeted refresh follows.
     */
    handleExpenseDeleted: async (input: {
      groupId: string
      expenseId: string
    }) => {
      const control = await repository.readControl(namespace).catch(() => null)
      if (!control) return
      try {
        await repository.deleteExpenseLocally({
          namespace,
          generation: control.generation,
          groupId: input.groupId,
          expenseId: input.expenseId,
        })
        try {
          broadcast({
            type: 'dirty',
            namespace,
            generation: control.generation,
            groupId: input.groupId,
          })
        } catch {
          // Ignore broadcast failures.
        }
      } catch {
        // Local deletion failures leave the old snapshot dirty via markDirty
        // below; the refresh still runs.
        try {
          await repository.markDirty({
            namespace,
            generation: control.generation,
            dirtyGroupIds: [input.groupId],
          })
        } catch {
          // Ignore fencing failures (disabled/cleared races cancel refresh).
          return
        }
      }
      void requestSync({
        kind: 'targeted',
        groupIds: [input.groupId],
        triggerKind: 'mutation',
      }).catch(() => undefined)
    },
    /**
     * Successful online group delete/leave: immediately evicts the group and
     * its catalog entry. No fetch runs for the removed group.
     */
    handleGroupRemoved: async (input: { groupId: string }) => {
      const control = await repository.readControl(namespace).catch(() => null)
      if (!control) return
      try {
        await repository.deleteGroupLocally({
          namespace,
          generation: control.generation,
          groupId: input.groupId,
        })
        try {
          broadcast({
            type: 'catalog-changed',
            namespace,
            generation: control.generation,
          })
        } catch {
          // Ignore broadcast failures.
        }
      } catch {
        // Fencing failures (cleared races) need no further work.
      }
    },
    /** Other successful writes: retain old snapshot dirty until refreshed. */
    markGroupsDirty: async (groupIds: string[]) => {
      const ids = [...new Set(groupIds)].sort()
      if (ids.length === 0) return
      const control = await repository.readControl(namespace).catch(() => null)
      if (!control) return
      try {
        await repository.markDirty({
          namespace,
          generation: control.generation,
          dirtyGroupIds: ids,
        })
        try {
          for (const groupId of ids) {
            broadcast({
              type: 'dirty',
              namespace,
              generation: control.generation,
              groupId,
            })
          }
        } catch {
          // Ignore broadcast failures.
        }
      } catch {
        // Ignore fencing failures.
      }
      await requestSync({
        kind: 'targeted',
        groupIds: ids,
        triggerKind: 'mutation',
      })
    },
    getStatus: (): SyncStatusSnapshot => status,
    subscribe: (listener: () => void): (() => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    /** Test hook: last completed full-pass timestamp (5min foreground rule). */
    getLastCompletedFullPassAt: (): number | null => lastCompletedFullPassAt,
    /** Test hook: earliest Retry-After deadline blocking rate-limited groups. */
    getEarliestRetryAt: (): number | null => rateLimitedUntil,
    /** Test hook: per-tab download owner for lease assertions. */
    getOwnerId: (): string => owner,
    dispose: () => {
      disposed = true
      try {
        activeController?.abort(new DOMException('Disposed', 'AbortError'))
      } catch {
        // Ignore abort failures.
      }
      listeners.clear()
      idleWaiters = []
      pending = null
    },
  }
}
