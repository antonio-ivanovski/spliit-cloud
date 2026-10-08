import { Context, Effect, Ref } from 'effect'

import { isAbortError } from '@/lib/offline/connectivity'
import {
  catalogGroupIds,
  isSameOfflineRevision,
  newCommitNonce,
} from '@/lib/offline/contract'
import type { OfflineErrorCode } from '@/lib/offline/errors'
import {
  OFFLINE_SYNC_CATALOG_TIMEOUT_MS,
  OFFLINE_SYNC_FOREGROUND_STALE_MS,
  OFFLINE_SYNC_GROUP_RETRY_DELAY_MS,
  OFFLINE_SYNC_LEASE_RENEW_MS,
  OFFLINE_SYNC_LEASE_TTL_MS,
  OFFLINE_SYNC_MAX_RETRY_AFTER_MS,
  OFFLINE_SYNC_SNAPSHOT_TIMEOUT_MS,
  classifySyncError,
  mergePassRequests,
  orderSyncGroups,
  toPersistedCode,
  type SyncBroadcastEvent,
  type SyncFetchCatalogFn,
  type SyncFetchSnapshotFn,
  type SyncPassRequest,
  type SyncStatusSnapshot,
  type SyncTriggerKind,
  type SyncVerifyFn,
} from '@/lib/offline/sync'
import type {
  OfflineCatalogOutput,
  OfflineSnapshotOutput,
} from '@spliit/api/offline-contract'

import { TimeoutError } from './errors'
import type { OfflineStorage, StorageServiceError } from './offline-storage'

/**
 * Revision-aware download coordination (Task 5).
 *
 * Account-scoped Effect command processor replacing the legacy
 * createOfflineSync coordinator. Pure policy (ordering, classification,
 * Retry-After parsing, request merging, persisted codes) is REUSED from sync.ts
 * — this service owns Effect composition, not policy:
 *
 * - One active pass + one merged pending request (single Ref holding both, so
 *   merge/decide transitions are atomic): full requests supersede targeted
 *   ones, targeted unions merge. Refresh intent is never dropped lossily — a
 *   trigger arriving mid-pass is picked up by the same runner.
 * - Catalog first; only missing/dirty/changed/replacement-required groups
 *   download. Unchanged histories (stored token equals the catalog token) only
 *   advance lastConfirmedAt via confirmGroup — never expense rewrites. Revision
 *   skipping trusts the server token coverage proven (statically) in
 *   handoff/2026-10-07-revision-coverage-audit.md with the G1 viewer fix in
 *   tree (migration 20261006224252_offline_viewer_revision_insert); DB-backed
 *   proof of that migration is still unverified.
 * - Order: current group -> missing -> dirty -> remaining changed, history
 *   concurrency 1, catalog/snapshot timeout 60s each.
 * - Lease: IDB 30s TTL, renewal as a CHILD of the active pass via
 *   Effect.raceFirst — loss interrupts the pass promptly, and the transactional
 *   owner/generation fence still guards every commit. Release is best-effort in
 *   an ensuring finalizer; no long lease is held across a Retry-After
 *   deferral.
 * - Retries: transient HTTP 5xx/request timeout max 3 attempts per resource (5s,
 *   10s delays + positive jitter <= 20%). Genuine connectivity loss pauses for
 *   recovery. Auth re-verifies (never signs out here); group forbidden
 *   reconciles via evictGroup (never signs out). Schema, quota, revocation, and
 *   access failures are never retried as transient.
 * - Rate limit: the Retry-After minimum is honored (invalid/missing -> 60s);
 *   short delays sleep once and retry once, long delays record the earliest
 *   eligible time, release the lease, and resume via the scheduler — no early
 *   retry, refresh intent preserved across the deferral.
 * - Hidden documents finish the in-flight group and start no next group until
 *   visible; no closed-app guarantee.
 *
 * Freshness (dirty or >5min-since-confirmation warnings, oldest-contributor
 * aggregation) stays a read-model projection over lastConfirmedAt/capturedAt;
 * this service only maintains those markers. Dexie remains the sole IDB wrapper
 * behind the OfflineStorage service; Zod validation stays outside transactions
 * in the repository.
 *
 * FUTURE-WRITE BOUNDARY (Task 8; read-only offline is a hard constraint):
 *
 * - This service separates three concerns that must stay separate: server
 *   snapshots (catalog/snapshot fetchers), local projections (read-model over
 *   committed Dexie state), and pull orchestration (this command processor).
 * - Current snapshot replacement (commitGroup wholesale replace) is safe ONLY
 *   because there are no local financial writes: nothing owned by the user can
 *   be clobbered by an incoming snapshot.
 * - Later offline writes REQUIRE, at minimum: an atomic local change paired with
 *   a DURABLE operation/idempotency record (IndexedDB, never an in-memory Queue
 *   or fiber — process death must not lose or duplicate money), a
 *   push/ack/conflict service, merging pending operations BEFORE snapshot
 *   replacement, plus pending-write cleanup and update blockers that hold
 *   activation while writes are unacknowledged.
 * - Deliberately NOT built now: no outbox table, schema, protocol, or placeholder
 *   for any of the above. Internal interfaces may change freely; external
 *   contracts (wire, Zod, DB names) are preserved.
 */

export interface OfflineDownloadDeps {
  readonly namespace: string
  /** Task-4 storage service (live layer bound per account scope in Task 8). */
  readonly storage: OfflineStorage
  readonly verifySession: SyncVerifyFn
  readonly fetchCatalog: SyncFetchCatalogFn
  readonly fetchSnapshot: SyncFetchSnapshotFn
  readonly getCurrentGroupId?: () => string | null
  /**
   * Required: downloads run only while visible. No DOM default on purpose — the
   * provider passes the document check; tests pass a stub.
   */
  readonly isVisible: () => boolean
  /**
   * Optional custom waiter; the default polls isVisible every 500ms and
   * observes the fiber signal.
   */
  readonly waitForVisible?: (signal: AbortSignal) => Promise<void>
  readonly now?: () => number
  readonly randomUUID?: () => string
  /** Uniform [0,1) source for positive retry jitter. Defaults to Math.random. */
  readonly random01?: () => number
  /**
   * Current account generation (supervisor snapshot). Completions publish only
   * while it still matches the pass generation.
   */
  readonly readGeneration?: () => number
  readonly broadcast?: (event: SyncBroadcastEvent) => void
  readonly onConnectivityFailure?: (error: unknown) => void
  readonly isConnectivityError?: (error: unknown) => boolean
}

export interface OfflineDownloads {
  /** Merged trigger entry point. Never runs overlapping passes. */
  readonly requestDownload: (request: SyncPassRequest) => Effect.Effect<void>
  /** Authenticated launch: verify, then download all catalog groups once. */
  readonly handleLaunch: Effect.Effect<void>
  /** Reconnect: full pass (the pass verifies again, idempotently). */
  readonly handleReconnect: Effect.Effect<void>
  /** Foreground return: full pass only when the last one is older than 5min. */
  readonly handleForeground: Effect.Effect<void>
  /**
   * Successful online mutation: marks groups dirty (contextual financial
   * warning until refreshed) and schedules a targeted refresh. Mutations
   * without a resolvable groupId request a full pass.
   */
  readonly handleMutation: (input?: {
    readonly groupIds?: string[]
  }) => Effect.Effect<void>
  /** Write with unknown outcome: refresh reads, never replay the write. */
  readonly handleUnknownOutcome: (input?: {
    readonly groupIds?: string[]
  }) => Effect.Effect<void>
  /** Other successful writes: retain old snapshot dirty until refreshed. */
  readonly markGroupsDirty: (groupIds: string[]) => Effect.Effect<void>
  /**
   * Successful online expense delete (ported from the legacy sync coordinator,
   * Task 8): atomically removes the expense from local list/detail and marks
   * balances/overview stale (dirtySince). Totals are never hand-recalculated; a
   * targeted refresh follows.
   */
  readonly handleExpenseDeleted: (input: {
    readonly groupId: string
    readonly expenseId: string
  }) => Effect.Effect<void>
  /**
   * Successful online group delete/leave (ported from the legacy sync
   * coordinator, Task 8): immediately evicts the group and its catalog entry.
   * No fetch runs for the removed group.
   */
  readonly handleGroupRemoved: (input: {
    readonly groupId: string
  }) => Effect.Effect<void>
  /** Current pass snapshot (phase/counts/errors/earliest-retry). */
  readonly snapshot: Effect.Effect<SyncStatusSnapshot>
  /** Last completed full-pass timestamp (5min foreground rule). */
  readonly lastCompletedFullPassAt: Effect.Effect<number | null>
  /** Earliest Retry-After deadline blocking rate-limited groups. */
  readonly earliestRetryAt: Effect.Effect<number | null>
  /** Per-tab download owner for lease assertions. */
  readonly ownerId: string
  /** Stop accepting work; in-flight checks settle between groups. */
  readonly dispose: Effect.Effect<void>
}

export const OfflineDownloads =
  Context.Service<OfflineDownloads>('OfflineDownloads')

type StorageOutcome<A> =
  | { readonly ok: true; readonly value: A }
  | { readonly ok: false; readonly error: StorageServiceError }

type FetchOutcome<A> =
  | { readonly ok: true; readonly value: A }
  | { readonly ok: false; readonly error: unknown }

/** Driver outcome: keep draining, or resign and wait for a scheduler. */
type PassOutcome = 'continue' | 'paused' | 'deferred' | 'quota'

type DriverState = {
  readonly active: boolean
  readonly pending: SyncPassRequest | null
}

/** Transient retry schedule: 3 total attempts per resource (5s, then 10s). */
const TRANSIENT_RETRY_DELAYS_MS = [
  OFFLINE_SYNC_GROUP_RETRY_DELAY_MS,
  2 * OFFLINE_SYNC_GROUP_RETRY_DELAY_MS,
] as const

function isAbortLike(error: unknown): boolean {
  if (isAbortError(error)) return true
  return error instanceof DOMException && error.name === 'AbortError'
}

function defaultWaitForVisible(
  isVisible: () => boolean,
  signal: AbortSignal,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted || isVisible()) {
      if (signal.aborted && !isVisible()) {
        reject(new DOMException('Aborted', 'AbortError'))
        return
      }
      resolve()
      return
    }
    const id = setInterval(() => {
      if (signal.aborted) {
        clearInterval(id)
        reject(new DOMException('Aborted', 'AbortError'))
        return
      }
      if (isVisible()) {
        clearInterval(id)
        resolve()
      }
    }, 500)
  })
}

export function makeOfflineDownloads(
  deps: OfflineDownloadDeps,
): OfflineDownloads {
  const namespace = deps.namespace
  const storage = deps.storage
  const verifySession = deps.verifySession
  const fetchCatalog = deps.fetchCatalog
  const fetchSnapshot = deps.fetchSnapshot
  const getCurrentGroupId = deps.getCurrentGroupId ?? (() => null)
  const isVisible = deps.isVisible
  const waitForVisible =
    deps.waitForVisible ??
    ((signal: AbortSignal) => defaultWaitForVisible(isVisible, signal))
  const now = deps.now ?? (() => Date.now())
  const randomUUID = deps.randomUUID ?? (() => newCommitNonce())
  const random01 = deps.random01 ?? (() => Math.random())
  const readGeneration = deps.readGeneration ?? (() => 0)
  const broadcast = deps.broadcast ?? (() => undefined)
  const onConnectivityFailure = deps.onConnectivityFailure ?? (() => undefined)
  const isConnectivityError = deps.isConnectivityError

  const owner = randomUUID()

  const initialSnapshot: SyncStatusSnapshot = {
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

  // Single Ref for the driver state so merge/decide transitions are atomic:
  // a trigger can never strand intent between "pending set" and "saw active".
  const driverRef = Effect.runSync(
    Ref.make<DriverState>({ active: false, pending: null }),
  )
  const snapshotRef = Effect.runSync(
    Ref.make<SyncStatusSnapshot>(initialSnapshot),
  )
  const rateRef = Effect.runSync(
    Ref.make<{ until: number | null; groups: Set<string> }>({
      until: null,
      groups: new Set<string>(),
    }),
  )
  const lastFullRef = Effect.runSync(Ref.make<number | null>(null))
  const disposedRef = Effect.runSync(Ref.make<boolean>(false))

  const setStatus = (patch: Partial<SyncStatusSnapshot>): Effect.Effect<void> =>
    Ref.update(snapshotRef, (snapshot) => ({ ...snapshot, ...patch }))

  /** Best-effort notification: listener failures never fail a pass. */
  const notify = (fn: () => void): Effect.Effect<void> =>
    Effect.matchEffect(Effect.sync(fn), {
      onFailure: () => Effect.void,
      onSuccess: () => Effect.void,
    })

  const attemptStorage = <A>(
    effect: Effect.Effect<A, StorageServiceError>,
  ): Effect.Effect<StorageOutcome<A>> =>
    Effect.matchEffect(effect, {
      onFailure: (error) => Effect.succeed({ ok: false as const, error }),
      onSuccess: (value) => Effect.succeed({ ok: true as const, value }),
    })

  const attemptFetch = <A>(
    run: (signal: AbortSignal) => Promise<A>,
    timeoutMs: number,
  ): Effect.Effect<FetchOutcome<A>> =>
    Effect.matchEffect(
      Effect.flatMap(
        Effect.timeoutOption(
          Effect.tryPromise({
            try: run,
            catch: (error: unknown) => error,
          }),
          timeoutMs,
        ),
        (option) =>
          option._tag === 'Some'
            ? Effect.succeed(option.value)
            : Effect.fail(
                new TimeoutError({
                  operation: 'offline-download',
                  timeoutMs,
                }),
              ),
      ),
      {
        onFailure: (error: unknown) =>
          Effect.succeed({ ok: false as const, error }),
        onSuccess: (value: A) => Effect.succeed({ ok: true as const, value }),
      },
    )

  // A throwing verify means "not verified" (never a pass failure).
  const attemptVerify: Effect.Effect<boolean> = Effect.matchEffect(
    Effect.tryPromise({
      try: (signal) => verifySession(signal),
      catch: (error: unknown) => error,
    }),
    {
      onFailure: () => Effect.succeed(false),
      onSuccess: (value) => Effect.succeed(value),
    },
  )

  /**
   * Positive jitter (<=20%) for transient retries; Retry-After minima stay
   * exact.
   */
  const withJitter = (delayMs: number): number =>
    delayMs * (1 + random01() * 0.2)

  const gateVisible: Effect.Effect<void> = Effect.matchEffect(
    Effect.tryPromise({
      try: (signal) => waitForVisible(signal),
      catch: (error: unknown) => error,
    }),
    {
      // Aborts (fiber interruption included) settle as interruption, never as
      // download state. Anything else is a provider defect — fail loudly.
      onFailure: (error: unknown) =>
        isAbortLike(error) ? Effect.interrupt : Effect.die(error),
      onSuccess: () => Effect.void,
    },
  )

  /**
   * Storage tags never retry as transient: lease/disabled/revision/quota/schema
   * stop or rerun.
   */
  const classifyStorage = (
    error: StorageServiceError,
  ): 'lease' | 'disabled' | 'revision' | 'quota' | 'schema' | 'cancelled' => {
    switch (error._tag) {
      case 'StaleLeaseError':
        return 'lease'
      case 'StaleGenerationError':
        return 'disabled'
      case 'StaleRevisionError':
        return 'revision'
      case 'StorageQuotaError':
        return 'quota'
      case 'StorageSchemaError':
      case 'StorageCorruptError':
        return 'schema'
      default:
        return 'cancelled'
    }
  }

  const persistedForStorage = (
    error: StorageServiceError,
  ): OfflineErrorCode => {
    switch (error._tag) {
      case 'StorageQuotaError':
        return 'quota-exceeded'
      case 'StorageSchemaError':
        return 'schema-unsupported'
      case 'StorageCorruptError':
        return error.reason === 'invalid-payload'
          ? 'invalid-payload'
          : 'schema-unsupported'
      default:
        return 'storage-unavailable'
    }
  }

  const storageCodeForErrors = (error: StorageServiceError): string => {
    switch (error._tag) {
      case 'StorageSchemaError':
        return 'schema-unsupported'
      case 'StorageCorruptError':
        return error.reason
      case 'StaleLeaseError':
        return 'lease'
      case 'StaleGenerationError':
        return 'generation-mismatch'
      case 'StaleRevisionError':
        return 'revision-changed'
      case 'StorageQuotaError':
        return 'quota-exceeded'
      default:
        return 'storage-unavailable'
    }
  }

  /**
   * Status writes are informational: readiness comes only from committed
   * snapshots.
   */
  const recordGroupAttempt = (
    idbGeneration: number,
    groupId: string,
    ok: boolean,
    errorCode?: OfflineErrorCode | null,
  ): Effect.Effect<void> =>
    Effect.ignore(
      ok
        ? storage.recordAttempt({
            namespace,
            generation: idbGeneration,
            groupId,
            result: 'ok',
          })
        : storage.recordAttempt({
            namespace,
            generation: idbGeneration,
            groupId,
            result: 'error',
            errorCode: errorCode ?? 'storage-unavailable',
          }),
    )

  const requeue = (request: SyncPassRequest): Effect.Effect<void> =>
    Ref.update(driverRef, (state) => ({
      ...state,
      pending: mergePassRequests(state.pending, request),
    }))

  const deferRateLimit = (
    delayMs: number,
    groupId: string | null,
  ): Effect.Effect<void> =>
    Effect.gen(function* () {
      const until = now() + delayMs
      yield* Ref.update(rateRef, (rate) => {
        const groups = new Set(rate.groups)
        if (groupId !== null) groups.add(groupId)
        return { until, groups }
      })
      yield* setStatus({
        phase: 'rate-limited',
        activity: null,
        currentGroupId: null,
        currentGroupName: null,
        earliestRetryAt: until,
      })
    })

  /**
   * Renewal is a CHILD of the active pass: loss fails the race and stops the
   * pass.
   */
  const renewLoop = (
    idbGenRef: Ref.Ref<number>,
  ): Effect.Effect<never, StorageServiceError> =>
    Effect.gen(function* () {
      while (true) {
        yield* Effect.sleep(OFFLINE_SYNC_LEASE_RENEW_MS)
        const renewed = yield* attemptStorage(
          storage.renewLease({
            namespace,
            generation: yield* Ref.get(idbGenRef),
            owner,
            ttlMs: OFFLINE_SYNC_LEASE_TTL_MS,
            now: now(),
          }),
        )
        if (renewed.ok) continue
        if (
          renewed.error._tag === 'StaleLeaseError' ||
          renewed.error._tag === 'StaleGenerationError'
        ) {
          return yield* Effect.fail(renewed.error)
        }
        // Transient storage hiccup: keep renewing; the transactional commit
        // fence still guards every write.
      }
    })

  const runPassBody = (
    request: SyncPassRequest,
    idbGenRef: Ref.Ref<number>,
    expectedSupervisorGen: number,
  ): Effect.Effect<PassOutcome> =>
    Effect.gen(function* () {
      const fenced = (): boolean => readGeneration() !== expectedSupervisorGen
      const finish = (
        phase: 'cancelled' | 'failed' | 'disabled',
      ): Effect.Effect<PassOutcome> =>
        Effect.as(
          setStatus({
            phase,
            activity: null,
            currentGroupId: null,
            currentGroupName: null,
          }),
          'continue' as PassOutcome,
        )

      yield* setStatus({ phase: 'catalog', activity: null })
      if (!isVisible()) {
        yield* gateVisible
      }
      if ((yield* Ref.get(disposedRef)) || fenced()) {
        return yield* finish('cancelled')
      }

      const controlBefore = yield* attemptStorage(
        storage.readControl(namespace),
      )
      if (!controlBefore.ok) {
        const decision = classifyStorage(controlBefore.error)
        return yield* finish(
          decision === 'disabled' || decision === 'lease'
            ? 'cancelled'
            : 'failed',
        )
      }
      if (
        controlBefore.value === null ||
        controlBefore.value.revoked ||
        fenced() ||
        (yield* Ref.get(disposedRef))
      ) {
        return yield* finish('cancelled')
      }
      const catalogRevision = controlBefore.value.dataRevision

      // Catalog fetch: one retry after 5s+jitter for transient failures.
      let catalog: OfflineCatalogOutput | null = null
      let catalogAttempts = 0
      while (catalog === null) {
        catalogAttempts += 1
        const fetched = yield* attemptFetch(
          (signal) => fetchCatalog(signal),
          OFFLINE_SYNC_CATALOG_TIMEOUT_MS,
        )
        if (fetched.ok) {
          catalog = fetched.value
          break
        }
        if ((yield* Ref.get(disposedRef)) || fenced()) {
          return yield* finish('cancelled')
        }
        const classified = classifySyncError(
          fetched.error,
          now(),
          isConnectivityError,
        )
        if (classified.kind === 'connectivity') {
          yield* notify(() => onConnectivityFailure(fetched.error))
          yield* setStatus({ phase: 'paused-connectivity', activity: null })
          return 'paused' as PassOutcome
        }
        if (classified.kind === 'auth') {
          const reverified = yield* attemptVerify
          return yield* finish(reverified ? 'failed' : 'cancelled')
        }
        if (classified.kind === 'rate-limited') {
          if (classified.delayMs > OFFLINE_SYNC_MAX_RETRY_AFTER_MS) {
            yield* deferRateLimit(classified.delayMs, null)
            // The catalog never committed: requeue the whole request.
            yield* requeue(request)
            return 'deferred' as PassOutcome
          }
          if (catalogAttempts > 1) return yield* finish('failed')
          yield* Effect.sleep(classified.delayMs)
          continue
        }
        if (classified.kind === 'transient' && catalogAttempts === 1) {
          yield* Effect.sleep(withJitter(OFFLINE_SYNC_GROUP_RETRY_DELAY_MS))
          continue
        }
        return yield* finish('failed')
      }
      if (catalog === null) return yield* finish('failed')

      // Commit/reconcile atomically; absent memberships evict and fence
      // generation so older downloads cannot resurrect them.
      const catalogGen = yield* Ref.get(idbGenRef)
      const catalogCommitted = yield* attemptStorage(
        storage.replaceCatalog({
          namespace,
          generation: catalogGen,
          expectedDataRevision: catalogRevision,
          catalog,
          leaseOwner: owner,
        }),
      )
      if (!catalogCommitted.ok) {
        const decision = classifyStorage(catalogCommitted.error)
        if (decision === 'revision') {
          // A mutation fenced the catalog commit: restart via one pending
          // rerun instead of resurrecting deletes.
          yield* requeue(request)
          return yield* finish('cancelled')
        }
        if (decision === 'disabled' || decision === 'lease') {
          return yield* finish(decision === 'lease' ? 'cancelled' : 'disabled')
        }
        return yield* finish('failed')
      }
      yield* Ref.set(idbGenRef, catalogCommitted.value.generation)
      const committedGen = catalogCommitted.value.generation
      yield* notify(() =>
        broadcast({
          type: 'catalog-changed',
          namespace,
          generation: committedGen,
        }),
      )
      const catalogIds = catalogGroupIds(catalog.groups)
      yield* setStatus({ totalGroups: catalogIds.length, lastCatalogAt: now() })

      // Metadata inventory: missing / dirty / unchanged / unsupported. Reads
      // metadata only (never histories): a stored token equal to the
      // published catalog token proves the history unchanged.
      const missing = new Set<string>()
      const dirty = new Set<string>()
      const unchanged = new Set<string>()
      const unchangedTokens = new Map<string, string>()
      const unsupported = new Set<string>()
      const names = new Map<string, string>()
      let initialReady = 0
      for (const entry of catalog.groups) {
        if ((yield* Ref.get(disposedRef)) || fenced()) {
          return yield* finish('cancelled')
        }
        const id = entry.overview.id
        names.set(id, entry.overview.displayName ?? entry.overview.name)
        const meta = yield* attemptStorage(storage.readGroupMeta(namespace, id))
        if (!meta.ok) {
          const decision = classifyStorage(meta.error)
          if (decision === 'disabled' || decision === 'lease') {
            return yield* finish('cancelled')
          }
          return yield* finish('failed')
        }
        if (meta.value.status === 'ready') {
          initialReady += 1
          if (meta.value.record.dirtySince !== null) {
            dirty.add(id)
          } else if (
            isSameOfflineRevision(
              meta.value.record.serverRevision,
              entry.revision,
            )
          ) {
            unchanged.add(id)
            unchangedTokens.set(id, entry.revision)
          }
        } else if (meta.value.status === 'unsupported') {
          unsupported.add(id)
        } else {
          missing.add(id)
        }
      }
      yield* setStatus({ readyGroups: initialReady })

      // Confirm unchanged tokens without expense rewrites: only
      // lastConfirmedAt advances, the original capture stays pinned.
      // Best-effort freshness (a failed confirmation retries next pass);
      // it never fails the download pass.
      for (const groupId of unchanged) {
        if ((yield* Ref.get(disposedRef)) || fenced()) {
          return yield* finish('cancelled')
        }
        const gen = yield* Ref.get(idbGenRef)
        yield* Effect.ignore(
          storage.confirmGroup({
            namespace,
            generation: gen,
            groupId,
            serverRevision: unchangedTokens.get(groupId) ?? '',
            now: new Date(now()),
          }),
        )
      }
      const currentGroupId = getCurrentGroupId()

      let ordered: string[]
      if (request.kind === 'targeted') {
        const wanted = new Set(
          (request.groupIds ?? []).filter((id) => catalogIds.includes(id)),
        )
        // Mutations without a resolvable groupId request a full pass;
        // callers map that to kind full before reaching here.
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

      const snapshot = yield* Ref.get(snapshotRef)
      const errors: Record<string, string> = { ...snapshot.errors }
      let ready = initialReady
      let completedAll = true
      const rerunForRevision = new Set<string>()

      for (const [index, groupId] of ordered.entries()) {
        if ((yield* Ref.get(disposedRef)) || fenced()) {
          completedAll = false
          break
        }
        // Downloads run only in an open visible document. In-flight work
        // finishes when hidden; the next group waits until visible.
        if (!isVisible()) {
          yield* gateVisible
        }
        if ((yield* Ref.get(disposedRef)) || fenced()) {
          completedAll = false
          break
        }
        // A Retry-After deadline is never bypassed by later triggers.
        const rate = yield* Ref.get(rateRef)
        if (
          rate.groups.has(groupId) &&
          rate.until !== null &&
          now() < rate.until
        ) {
          errors[groupId] = 'rate-limited'
          continue
        }
        const wasMissing = missing.has(groupId)
        yield* setStatus({
          phase: 'downloading',
          currentGroupId: groupId,
          currentGroupName: names.get(groupId) ?? groupId,
          activity: 'indeterminate',
        })

        const gen = yield* Ref.get(idbGenRef)
        const controlPre = yield* attemptStorage(storage.readControl(namespace))
        if (
          !controlPre.ok ||
          controlPre.value === null ||
          controlPre.value.generation !== gen ||
          controlPre.value.revoked
        ) {
          // Disabled/cleared/signed-out mid-pass: cancel, fence commits.
          completedAll = false
          break
        }
        const expectedDataRevision = controlPre.value.dataRevision

        let groupSnapshot: OfflineSnapshotOutput | null = null
        let attempts = 0
        let groupDone = false
        while (!groupDone) {
          attempts += 1
          const fetched = yield* attemptFetch(
            (signal) => fetchSnapshot(groupId, signal),
            OFFLINE_SYNC_SNAPSHOT_TIMEOUT_MS,
          )
          if (fetched.ok) {
            groupSnapshot = fetched.value
            groupDone = true
            break
          }
          if ((yield* Ref.get(disposedRef)) || fenced()) {
            completedAll = false
            groupDone = true
            groupSnapshot = null
            break
          }
          const classified = classifySyncError(
            fetched.error,
            now(),
            isConnectivityError,
          )
          if (classified.kind === 'connectivity') {
            // Global failure pauses the pass and hands to recovery probes.
            completedAll = false
            yield* notify(() => onConnectivityFailure(fetched.error))
            yield* setStatus({ phase: 'paused-connectivity', activity: null })
            return 'paused' as PassOutcome
          }
          if (classified.kind === 'auth') {
            errors[groupId] = 'auth'
            yield* recordGroupAttempt(
              gen,
              groupId,
              false,
              toPersistedCode(classified),
            )
            // Auth re-verifies (never signs out here): a dead session stops
            // the pass, a live one treats the 401 as a per-group error.
            const reverified = yield* attemptVerify
            if (!reverified) {
              completedAll = false
              return yield* finish('cancelled')
            }
            groupDone = true
            groupSnapshot = null
            break
          }
          if (classified.kind === 'access') {
            // Confirmed FORBIDDEN/NOT_FOUND reconciles by evicting the local
            // copy so aggregates invalidate immediately. No retry, no sign-out.
            yield* Effect.ignore(
              storage.evictGroup({ namespace, generation: gen, groupId }),
            )
            errors[groupId] = classified.code
            yield* recordGroupAttempt(
              gen,
              groupId,
              false,
              toPersistedCode(classified),
            )
            groupDone = true
            groupSnapshot = null
            break
          }
          if (classified.kind === 'rate-limited') {
            if (classified.delayMs > OFFLINE_SYNC_MAX_RETRY_AFTER_MS) {
              // End automatic work for the pass, retain error/readiness,
              // store the deadline; the scheduler retries after it. The
              // lease is released by the pass finalizer — never held long.
              yield* recordGroupAttempt(
                gen,
                groupId,
                false,
                toPersistedCode(classified),
              )
              errors[groupId] = 'rate-limited'
              yield* deferRateLimit(classified.delayMs, groupId)
              yield* setStatus({ errors: { ...errors } })
              // Preserve refresh intent across the deferral: the scheduler
              // resumes the untried remainder after the deadline.
              yield* requeue({
                kind: 'targeted',
                groupIds: ordered.slice(index + 1),
                triggerKind: request.triggerKind,
              })
              completedAll = false
              return 'deferred' as PassOutcome
            }
            if (attempts > 1) {
              errors[groupId] = 'rate-limited'
              yield* recordGroupAttempt(
                gen,
                groupId,
                false,
                toPersistedCode(classified),
              )
              groupDone = true
              groupSnapshot = null
              break
            }
            yield* Effect.sleep(classified.delayMs)
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
              yield* recordGroupAttempt(
                gen,
                groupId,
                false,
                toPersistedCode(classified),
              )
              yield* setStatus({
                phase: 'quota-error',
                activity: null,
                errors: { ...errors },
              })
              completedAll = false
              return 'quota' as PassOutcome
            }
            if (classified.kind === 'revision') {
              // Concurrent mutation fenced this capture: restart affected
              // work via a pending rerun instead of resurrecting deletes.
              rerunForRevision.add(groupId)
              groupDone = true
              groupSnapshot = null
              break
            }
            errors[groupId] =
              classified.kind === 'schema' ? classified.code : classified.kind
            yield* recordGroupAttempt(
              gen,
              groupId,
              false,
              toPersistedCode(classified),
            )
            if (classified.kind === 'disabled' || classified.kind === 'lease') {
              completedAll = false
            }
            groupDone = true
            groupSnapshot = null
            break
          }
          // Transient: bounded retries (5s, then 10s, both +jitter) per
          // group per pass, then continue so a failed large group never
          // starves the rest.
          if (
            classified.kind === 'transient' &&
            attempts <= TRANSIENT_RETRY_DELAYS_MS.length
          ) {
            yield* Effect.sleep(
              withJitter(TRANSIENT_RETRY_DELAYS_MS[attempts - 1]!),
            )
            continue
          }
          errors[groupId] =
            classified.kind === 'transient' ? classified.code : classified.kind
          yield* recordGroupAttempt(
            gen,
            groupId,
            false,
            toPersistedCode(classified),
          )
          groupDone = true
          groupSnapshot = null
          break
        }

        if (groupSnapshot === null) {
          // Failed groups retain prior readiness; terminal phases return
          // directly above. Revision-fenced captures rerun below.
          yield* setStatus({ errors: { ...errors } })
          continue
        }

        // Commit: validation happened outside the tx (fetchers parse via
        // Zod); fencing on generation/dataRevision/lease runs inside the
        // same control tx. A concurrent delete bumps dataRevision so this
        // older capture is rejected entirely (never resurrected).
        const committed = yield* attemptStorage(
          storage.commitGroup({
            namespace,
            generation: gen,
            expectedDataRevision,
            snapshot: groupSnapshot,
            leaseOwner: owner,
          }),
        )
        if (committed.ok) {
          if (wasMissing) ready += 1
          delete errors[groupId]
          const rateState = yield* Ref.get(rateRef)
          if (rateState.groups.has(groupId)) {
            const groups = new Set(rateState.groups)
            groups.delete(groupId)
            const until = groups.size === 0 ? null : rateState.until
            yield* Ref.set(rateRef, { until, groups })
            yield* setStatus({
              readyGroups: ready,
              errors: { ...errors },
              earliestRetryAt: until,
            })
          } else {
            yield* setStatus({ readyGroups: ready, errors: { ...errors } })
          }
          yield* recordGroupAttempt(gen, groupId, true)
          yield* notify(() =>
            broadcast({
              type: 'committed',
              namespace,
              generation: gen,
              groupId,
            }),
          )
          continue
        }
        const decision = classifyStorage(committed.error)
        if (decision === 'revision') {
          // Mutation during capture: retain the old complete snapshot with
          // its dirty marker; restart affected work via pending rerun.
          rerunForRevision.add(groupId)
          yield* setStatus({ errors: { ...errors } })
          continue
        }
        if (decision === 'disabled' || decision === 'lease') {
          // Disable/clear/renewal-loss fences all further commits.
          completedAll = false
          return yield* finish('cancelled')
        }
        errors[groupId] =
          decision === 'schema'
            ? storageCodeForErrors(committed.error)
            : decision
        yield* recordGroupAttempt(
          gen,
          groupId,
          false,
          persistedForStorage(committed.error),
        )
        if (decision === 'quota') {
          completedAll = false
          yield* setStatus({
            phase: 'quota-error',
            activity: null,
            errors: { ...errors },
          })
          return 'quota' as PassOutcome
        }
        yield* setStatus({ errors: { ...errors } })
        continue
      }

      if ((yield* Ref.get(disposedRef)) || fenced()) {
        return yield* finish('cancelled')
      }
      if (rerunForRevision.size > 0) {
        yield* requeue({
          kind: request.kind,
          groupIds: [...rerunForRevision],
          triggerKind: request.triggerKind,
        })
      }
      const rateState = yield* Ref.get(rateRef)
      let clearEarliest = false
      if (rateState.groups.size === 0 && rateState.until !== null) {
        yield* Ref.set(rateRef, { until: null, groups: new Set<string>() })
        clearEarliest = true
      }
      const hasErrors = Object.keys(errors).length > 0
      yield* setStatus({
        phase: completedAll ? (hasErrors ? 'failed' : 'done') : 'cancelled',
        activity: null,
        currentGroupId: null,
        currentGroupName: null,
        errors,
        ...(clearEarliest ? { earliestRetryAt: null as number | null } : {}),
      })
      if (completedAll && request.kind === 'full') {
        const completedAt = now()
        yield* Ref.set(lastFullRef, completedAt)
        yield* setStatus({ lastCompletedFullPassAt: completedAt })
      }
      return 'continue' as PassOutcome
    })

  const runPass = (request: SyncPassRequest): Effect.Effect<PassOutcome> =>
    Effect.gen(function* () {
      const expectedSupervisorGen = readGeneration()

      const ensured = yield* attemptStorage(storage.ensureControl(namespace))
      if (!ensured.ok) {
        const decision = classifyStorage(ensured.error)
        yield* setStatus({
          phase:
            decision === 'disabled' || decision === 'lease'
              ? 'cancelled'
              : 'failed',
          activity: null,
          currentGroupId: null,
          currentGroupName: null,
        })
        return 'continue' as PassOutcome
      }
      if (ensured.value.revoked) {
        yield* setStatus({ phase: 'cancelled', activity: null })
        return 'continue' as PassOutcome
      }

      // Clear elapsed Retry-After state so earliestRetryAt never sticks.
      const rate = yield* Ref.get(rateRef)
      if (
        rate.until !== null &&
        (now() >= rate.until || rate.groups.size === 0)
      ) {
        yield* Ref.set(rateRef, { until: null, groups: new Set<string>() })
      }

      yield* setStatus({ phase: 'verifying', activity: null, errors: {} })
      const verified = yield* attemptVerify
      if (
        (yield* Ref.get(disposedRef)) ||
        readGeneration() !== expectedSupervisorGen
      ) {
        yield* setStatus({ phase: 'cancelled', activity: null })
        return 'continue' as PassOutcome
      }
      if (!verified) {
        // Unverified passes stop without fetching or evicting.
        yield* setStatus({ phase: 'cancelled', activity: null })
        return 'continue' as PassOutcome
      }

      const idbGenRef = yield* Ref.make(ensured.value.generation)
      const acquired = yield* attemptStorage(
        storage.acquireLease({
          namespace,
          generation: ensured.value.generation,
          owner,
          ttlMs: OFFLINE_SYNC_LEASE_TTL_MS,
          now: now(),
        }),
      )
      if (!acquired.ok) {
        const decision = classifyStorage(acquired.error)
        // Loser tabs keep committed results; anything else stops the pass.
        yield* setStatus({
          phase: decision === 'lease' ? 'idle' : 'disabled',
          isOwner: false,
          activity: null,
        })
        return 'continue' as PassOutcome
      }
      yield* setStatus({ isOwner: true })

      const outcome = yield* Effect.ensuring(
        Effect.matchEffect(
          Effect.raceFirst(
            runPassBody(request, idbGenRef, expectedSupervisorGen),
            renewLoop(idbGenRef),
          ),
          {
            // Renewal lost the lease (or the namespace fenced mid-pass):
            // the transactional fence already blocks further commits.
            onFailure: () =>
              Effect.as(
                setStatus({
                  phase: 'cancelled',
                  activity: null,
                  currentGroupId: null,
                  currentGroupName: null,
                }),
                'continue' as PassOutcome,
              ),
            onSuccess: (result: PassOutcome) => Effect.succeed(result),
          },
        ),
        Effect.gen(function* () {
          // Best-effort release: expiry fences a crashed owner and
          // generation fencing blocks stale commits even when release
          // fails. Runs for every exit, including deferral and
          // interruption — no long lease is ever held across a delay.
          const gen = yield* Ref.get(idbGenRef)
          yield* Effect.ignore(
            storage.releaseLease({ namespace, generation: gen, owner }),
          )
          if (!(yield* Ref.get(disposedRef))) {
            yield* setStatus({
              isOwner: false,
              activity: null,
              currentGroupId: null,
              currentGroupName: null,
            })
          }
        }),
      )
      return outcome
    })

  /** True while a Retry-After deadline blocks work; elapsed deadlines clear. */
  const isRateGated = (): Effect.Effect<boolean> =>
    Effect.gen(function* () {
      const rate = yield* Ref.get(rateRef)
      if (rate.until === null) return false
      if (now() >= rate.until) {
        yield* Ref.set(rateRef, { until: null, groups: new Set<string>() })
        const snapshot = yield* Ref.get(snapshotRef)
        if (snapshot.earliestRetryAt !== null) {
          yield* setStatus({ earliestRetryAt: null })
        }
        return false
      }
      return true
    })

  /** Atomic take-or-resign: never strands intent, never double-runs. */
  const takeOrResign = (): Effect.Effect<SyncPassRequest | null> =>
    Ref.modify(driverRef, (state): [SyncPassRequest | null, DriverState] =>
      state.pending === null
        ? [null, { ...state, active: false }]
        : [state.pending, { ...state, pending: null }],
    )

  const resignDriver = (): Effect.Effect<void> =>
    Ref.update(driverRef, (state) => ({ ...state, active: false }))

  const clearDriver = (): Effect.Effect<void> =>
    Ref.update(driverRef, (state) => ({
      ...state,
      active: false,
      pending: null,
    }))

  const requestDownload = (request: SyncPassRequest): Effect.Effect<void> =>
    Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        if (yield* Ref.get(disposedRef)) return
        const snapshot = yield* Ref.get(snapshotRef)
        // Storage pressure cannot be repaired by more network traffic.
        if (snapshot.phase === 'quota-error') return
        const mustRun = yield* Ref.modify(
          driverRef,
          (state): [boolean, DriverState] => {
            const pending = mergePassRequests(state.pending, request)
            if (state.active) return [false, { ...state, pending }]
            return [true, { active: true, pending }]
          },
        )
        if (!mustRun) return
        while (true) {
          if (yield* Ref.get(disposedRef)) {
            yield* clearDriver()
            return
          }
          const current = yield* Ref.get(snapshotRef)
          if (current.phase === 'quota-error') {
            yield* clearDriver()
            return
          }
          if (yield* isRateGated()) {
            // Leave pending for the scheduler and resign: the deadline —
            // not another immediate run — releases the work. A trigger that
            // raced this check merged its intent first, so nothing is lost.
            yield* resignDriver()
            return
          }
          const next = yield* takeOrResign()
          if (next === null) return
          const outcome = yield* restore(runPass(next))
          if (outcome === 'quota') {
            yield* clearDriver()
            return
          }
          if (outcome === 'paused' || outcome === 'deferred') {
            // Deferred remainder intent is requeued above; paused work
            // resumes with the recovery trigger. Resign either way: looping
            // here would hot-spin against a still-closed gate.
            yield* resignDriver()
            return
          }
          // 'continue': stay active and drain.
        }
      }),
    )

  const requestFull = (triggerKind: SyncTriggerKind): Effect.Effect<void> =>
    requestDownload({ kind: 'full', triggerKind })

  const handleMutation = (input?: {
    readonly groupIds?: string[]
  }): Effect.Effect<void> =>
    Effect.gen(function* () {
      if (yield* Ref.get(disposedRef)) return
      const ids = [...new Set(input?.groupIds ?? [])].sort()
      if (ids.length === 0) return yield* requestFull('mutation')
      const control = yield* attemptStorage(storage.readControl(namespace))
      if (!control.ok || control.value === null) return
      const generation = control.value.generation
      yield* Effect.ignore(
        storage.markDirty({ namespace, generation, dirtyGroupIds: ids }),
      )
      for (const groupId of ids) {
        yield* notify(() =>
          broadcast({ type: 'dirty', namespace, generation, groupId }),
        )
      }
      return yield* requestDownload({
        kind: 'targeted',
        groupIds: ids,
        triggerKind: 'mutation',
      })
    })

  return {
    requestDownload,
    handleLaunch: requestFull('launch'),
    handleReconnect: requestFull('reconnect'),
    handleForeground: Effect.gen(function* () {
      if (yield* Ref.get(disposedRef)) return
      const lastFull = yield* Ref.get(lastFullRef)
      if (
        lastFull !== null &&
        now() - lastFull <= OFFLINE_SYNC_FOREGROUND_STALE_MS
      ) {
        return
      }
      return yield* requestFull('foreground')
    }),
    handleMutation,
    handleUnknownOutcome: (input?: { readonly groupIds?: string[] }) =>
      Effect.gen(function* () {
        if (yield* Ref.get(disposedRef)) return
        const ids = [...new Set(input?.groupIds ?? [])].sort()
        if (ids.length === 0) return yield* requestFull('unknown-outcome')
        return yield* requestDownload({
          kind: 'targeted',
          groupIds: ids,
          triggerKind: 'unknown-outcome',
        })
      }),
    markGroupsDirty: (groupIds: string[]) =>
      Effect.gen(function* () {
        const ids = [...new Set(groupIds)].sort()
        if (ids.length === 0) return
        const control = yield* attemptStorage(storage.readControl(namespace))
        if (!control.ok || control.value === null) return
        const generation = control.value.generation
        yield* Effect.ignore(
          storage.markDirty({ namespace, generation, dirtyGroupIds: ids }),
        )
        for (const groupId of ids) {
          yield* notify(() =>
            broadcast({ type: 'dirty', namespace, generation, groupId }),
          )
        }
        return yield* requestDownload({
          kind: 'targeted',
          groupIds: ids,
          triggerKind: 'mutation',
        })
      }),
    handleExpenseDeleted: (input: {
      readonly groupId: string
      readonly expenseId: string
    }) =>
      Effect.gen(function* () {
        if (yield* Ref.get(disposedRef)) return
        const control = yield* attemptStorage(storage.readControl(namespace))
        if (!control.ok || control.value === null) return
        const generation = control.value.generation
        const deleted = yield* attemptStorage(
          storage.deleteExpenseLocally({
            namespace,
            generation,
            groupId: input.groupId,
            expenseId: input.expenseId,
          }),
        )
        if (!deleted.ok) {
          // Local deletion failures leave the old snapshot dirty via
          // markDirty; the refresh below still runs.
          const marked = yield* attemptStorage(
            storage.markDirty({
              namespace,
              generation,
              dirtyGroupIds: [input.groupId],
            }),
          )
          if (!marked.ok) return
        }
        yield* notify(() =>
          broadcast({
            type: 'dirty',
            namespace,
            generation,
            groupId: input.groupId,
          }),
        )
        return yield* requestDownload({
          kind: 'targeted',
          groupIds: [input.groupId],
          triggerKind: 'mutation',
        })
      }),
    handleGroupRemoved: (input: { readonly groupId: string }) =>
      Effect.gen(function* () {
        if (yield* Ref.get(disposedRef)) return
        const control = yield* attemptStorage(storage.readControl(namespace))
        if (!control.ok || control.value === null) return
        const generation = control.value.generation
        yield* Effect.ignore(
          storage.deleteGroupLocally({
            namespace,
            generation,
            groupId: input.groupId,
          }),
        )
        yield* notify(() =>
          broadcast({ type: 'catalog-changed', namespace, generation }),
        )
      }),
    snapshot: Ref.get(snapshotRef),
    lastCompletedFullPassAt: Ref.get(lastFullRef),
    earliestRetryAt: Effect.map(Ref.get(rateRef), (rate) => rate.until),
    ownerId: owner,
    dispose: Ref.set(disposedRef, true),
  }
}
