import {
  Cause,
  Context,
  Deferred,
  Effect,
  Exit,
  Layer,
  Option,
  Ref,
} from 'effect'

import { isAbortError } from '@/lib/offline/connectivity'
import type { OfflineErrorCode } from '@/lib/offline/errors'
import { OfflineStorageError, isQuotaError } from '@/lib/offline/errors'
import {
  OfflineRepository,
  type CommitGroupInput,
  type EvictGroupInput,
  type MarkDirtyInput,
  type OfflineRepositoryOpenOptions,
  type ReplaceCatalogInput,
} from '@/lib/offline/repository'

import {
  StaleGenerationError,
  StaleLeaseError,
  StaleRevisionError,
  StorageBlockedError,
  StorageCorruptError,
  StorageQuotaError,
  StorageSchemaError,
  StorageUnavailableError,
} from './errors'

/**
 * Effect storage lifecycle + typed local persistence (Task 4).
 *
 * Dexie stays the sole application IndexedDB wrapper: this service never
 * touches IDB directly. Every method delegates to OfflineRepository, which owns
 * Zod validation/preparation OUTSIDE its transactions and runs one short
 * Promise-based Dexie transaction callback at the adapter boundary. No Effect
 * scheduling, fetch, sleep, or unrelated awaits ever run inside a transaction —
 * the wrapper only calls the repository method (a single promise) and maps its
 * outcome, so the transaction boundary is unchanged.
 *
 * Failure policy (preserved exactly from repository/database):
 *
 * - Quota stops download writes, retains reads, no eviction or retry loop.
 * - Unsupported newer schemas/versions are never interpreted or overwritten.
 * - Blocked / versionchange / unexpected-close recovery is ONE controlled
 *   foreground reopen (reopenAfterBlock): concurrent callers share the single
 *   in-flight reopen instead of stampeding the database.
 * - No schema bump for the Effect adoption (OFFLINE_DB_VERSION untouched).
 *
 * Error mapping is exactly-once at this boundary: OfflineStorageError codes
 * become typed ServiceError tags; unknown failures are normalized once (quota
 * detection included). Upper layers match tags and never re-inspect raw storage
 * failures. Interruption (caller abort, account-switch fence) stays in Effect's
 * interruption channel, never a storage tag.
 */

export type StorageServiceError =
  | StorageBlockedError
  | StorageUnavailableError
  | StorageQuotaError
  | StorageSchemaError
  | StorageCorruptError
  | StaleGenerationError
  | StaleRevisionError
  | StaleLeaseError

function contextOf(options?: {
  readonly namespace?: string
  readonly groupId?: string
}): { namespace: string; groupId?: string } {
  return {
    namespace: options?.namespace ?? 'unknown-namespace',
    groupId: options?.groupId,
  }
}

/**
 * Single normalization point for storage failures. Pure: deterministic given
 * the input, so the UI boundary (outcomes.ts) and tests can rely on it.
 * Payloads carry only safe metadata (namespace/groupId are storage keys, never
 * user content); raw causes are dropped, never persisted or logged.
 */
export function mapStorageError(
  error: unknown,
  options?: { readonly namespace?: string; readonly groupId?: string },
): StorageServiceError {
  const context = contextOf(options)
  if (error instanceof OfflineStorageError) {
    switch (error.code) {
      case 'quota-exceeded':
        return new StorageQuotaError({ groupId: context.groupId })
      case 'schema-unsupported':
        return new StorageSchemaError({ schemaVersion: 'unsupported' })
      case 'corrupt-record':
      case 'invalid-payload':
        return new StorageCorruptError({
          reason: error.code,
          groupId: context.groupId,
        })
      case 'generation-mismatch':
      case 'namespace-revoked':
        return new StaleGenerationError({ namespace: context.namespace })
      case 'revision-changed':
        return new StaleRevisionError({ groupId: context.groupId })
      case 'lease-conflict':
        return new StaleLeaseError({})
      case 'storage-blocked':
        return new StorageBlockedError()
      case 'storage-unavailable':
        return new StorageUnavailableError({ reason: error.code })
    }
  }
  if (isQuotaError(error)) {
    return new StorageQuotaError({ groupId: context.groupId })
  }
  return new StorageUnavailableError({ reason: 'unknown' })
}

function isAbortLike(error: unknown): boolean {
  if (isAbortError(error)) return true
  return error instanceof DOMException && error.name === 'AbortError'
}

export interface OfflineStorageOpenDeps {
  /** Production default opens the real Dexie database (database.ts). */
  readonly openRepository?: (
    options?: OfflineRepositoryOpenOptions,
  ) => Promise<OfflineRepository>
}

export interface OfflineStorage {
  /**
   * The single foreground open. Idempotent: concurrent or repeated calls share
   * the one in-flight/finished open, never stampede IndexedDB.
   */
  readonly open: Effect.Effect<void, StorageServiceError>
  /**
   * ONE controlled recovery reopen after blocked/versionchange/close: closes
   * the current handle and opens fresh exactly once. Concurrent callers share
   * the single in-flight reopen; a second recovery requires a second call.
   */
  readonly reopenAfterBlock: Effect.Effect<void, StorageServiceError>
  /** Release the handle. Best-effort: durability fences never depend on it. */
  readonly close: Effect.Effect<void>
  /** True once open() succeeded and close() has not run since. */
  readonly isOpen: Effect.Effect<boolean>
  readonly readControl: (
    namespace: string,
  ) => Effect.Effect<
    Awaited<ReturnType<OfflineRepository['readControl']>>,
    StorageServiceError
  >
  readonly ensureControl: (
    namespace: string,
  ) => Effect.Effect<
    Awaited<ReturnType<OfflineRepository['ensureControl']>>,
    StorageServiceError
  >
  readonly readCatalog: (
    namespace: string,
  ) => Effect.Effect<
    Awaited<ReturnType<OfflineRepository['readCatalog']>>,
    StorageServiceError
  >
  readonly readGroupMeta: (
    namespace: string,
    groupId: string,
  ) => Effect.Effect<
    Awaited<ReturnType<OfflineRepository['readGroupMeta']>>,
    StorageServiceError
  >
  readonly readGroupData: (
    namespace: string,
    groupId: string,
  ) => Effect.Effect<
    Awaited<ReturnType<OfflineRepository['readGroupData']>>,
    StorageServiceError
  >
  readonly listGroupStatus: (
    namespace: string,
  ) => Effect.Effect<
    Awaited<ReturnType<OfflineRepository['listGroupStatus']>>,
    StorageServiceError
  >
  readonly replaceCatalog: (
    input: ReplaceCatalogInput,
  ) => Effect.Effect<
    Awaited<ReturnType<OfflineRepository['replaceCatalog']>>,
    StorageServiceError
  >
  readonly commitGroup: (
    input: CommitGroupInput,
  ) => Effect.Effect<
    Awaited<ReturnType<OfflineRepository['commitGroup']>>,
    StorageServiceError
  >
  readonly confirmGroup: (input: {
    readonly namespace: string
    readonly generation: number
    readonly groupId: string
    readonly serverRevision: string
    readonly now?: Date
  }) => Effect.Effect<
    Awaited<ReturnType<OfflineRepository['confirmGroup']>>,
    StorageServiceError
  >
  readonly markDirty: (
    input: MarkDirtyInput,
  ) => Effect.Effect<
    Awaited<ReturnType<OfflineRepository['markDirty']>>,
    StorageServiceError
  >
  readonly evictGroup: (
    input: EvictGroupInput,
  ) => Effect.Effect<
    Awaited<ReturnType<OfflineRepository['evictGroup']>>,
    StorageServiceError
  >
  readonly acquireLease: (options: {
    readonly namespace: string
    readonly generation: number
    readonly owner: string
    readonly ttlMs?: number
    readonly now?: number
  }) => Effect.Effect<
    Awaited<ReturnType<OfflineRepository['acquireLease']>>,
    StorageServiceError
  >
  readonly renewLease: (options: {
    readonly namespace: string
    readonly generation: number
    readonly owner: string
    readonly ttlMs?: number
    readonly now?: number
  }) => Effect.Effect<
    Awaited<ReturnType<OfflineRepository['renewLease']>>,
    StorageServiceError
  >
  readonly releaseLease: (options: {
    readonly namespace: string
    readonly generation: number
    readonly owner: string
  }) => Effect.Effect<void, StorageServiceError>
  readonly deleteExpenseLocally: (options: {
    readonly namespace: string
    readonly generation: number
    readonly groupId: string
    readonly expenseId: string
    readonly now?: Date
  }) => Effect.Effect<
    Awaited<ReturnType<OfflineRepository['deleteExpenseLocally']>>,
    StorageServiceError
  >
  readonly deleteGroupLocally: (options: {
    readonly namespace: string
    readonly generation: number
    readonly groupId: string
  }) => Effect.Effect<
    Awaited<ReturnType<OfflineRepository['deleteGroupLocally']>>,
    StorageServiceError
  >
  readonly recordAttempt: (options: {
    readonly namespace: string
    readonly generation: number
    readonly groupId: string
    readonly result: 'ok' | 'error'
    readonly errorCode?: OfflineErrorCode | null
    readonly now?: Date
  }) => Effect.Effect<void, StorageServiceError>
}

export const OfflineStorage = Context.Service<OfflineStorage>('OfflineStorage')

export function makeOfflineStorage(
  deps?: OfflineStorageOpenDeps,
): OfflineStorage {
  const openRepository =
    deps?.openRepository ?? ((options) => OfflineRepository.open(options))

  let repository: OfflineRepository | null = null
  // Single-flight opens: every concurrent open/reopen shares one Deferred so
  // recovery never stampedes IndexedDB with parallel opens.
  const inflight = Effect.runSync(
    Ref.make(Option.none<Deferred.Deferred<void, StorageServiceError>>()),
  )

  const openOnce = (): Effect.Effect<void, StorageServiceError> =>
    Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        if (repository) return
        const existing = yield* Ref.get(inflight)
        if (Option.isSome(existing)) {
          return yield* restore(Deferred.await(existing.value))
        }
        const gate = yield* Deferred.make<void, StorageServiceError>()
        yield* Ref.set(inflight, Option.some(gate))
        // tryPromise (not promise): an open rejection is an expected typed
        // failure, never a defect. Effect.promise would let the rejection
        // bypass mapping as a defect.
        const outcome = yield* restore(
          Effect.exit(
            Effect.tryPromise({
              try: (signal) => openRepository({ signal }),
              catch: (error: unknown) => error,
            }),
          ),
        )
        yield* Ref.set(inflight, Option.none())
        if (Exit.isSuccess(outcome)) {
          repository = outcome.value
          yield* Deferred.succeed(gate, undefined)
          return
        }
        if (Cause.hasInterruptsOnly(outcome.cause)) {
          // Our own interruption (caller abort during the open): settle
          // waiters the same way and propagate interruption, never a tag.
          yield* Deferred.interrupt(gate)
          return yield* Effect.interrupt
        }
        const found = Cause.findErrorOption<unknown>(outcome.cause)
        const mapped = mapStorageError(
          found._tag === 'Some' ? found.value : outcome.cause,
        )
        yield* Deferred.fail(gate, mapped)
        return yield* Effect.fail(mapped)
      }),
    )

  const closeHandle = (): void => {
    const handle = repository
    repository = null
    try {
      handle?.close()
    } catch {
      // Close failures never fail recovery; fences stay durable.
    }
  }

  // Wrap one repository call: the Dexie transaction stays entirely inside the
  // repository method (short Promise callback at the adapter boundary). This
  // wrapper never awaits inside a transaction — it only maps the settled
  // outcome. Caller aborts propagate as interruption, never as storage tags.
  const call = <A>(
    namespace: string | undefined,
    groupId: string | undefined,
    run: (repo: OfflineRepository) => Promise<A>,
  ): Effect.Effect<A, StorageServiceError> => {
    const handle = repository
    if (!handle) {
      return Effect.fail(
        new StorageUnavailableError({ reason: 'storage-not-open' }),
      )
    }
    // tryPromise (not promise): a repository rejection is an expected typed
    // failure, never a defect — Effect.promise would let it bypass mapping.
    return Effect.matchEffect(
      Effect.tryPromise({
        try: () => run(handle),
        catch: (error: unknown) => error,
      }),
      {
        onFailure: (error: unknown) =>
          isAbortLike(error)
            ? Effect.interrupt
            : Effect.fail(mapStorageError(error, { namespace, groupId })),
        onSuccess: (value: A) => Effect.succeed(value),
      },
    )
  }

  const storage: OfflineStorage = {
    open: openOnce(),
    reopenAfterBlock: Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        const existing = yield* Ref.get(inflight)
        if (Option.isSome(existing)) {
          return yield* restore(Deferred.await(existing.value))
        }
        closeHandle()
        yield* restore(openOnce())
      }),
    ),
    close: Effect.sync(closeHandle),
    isOpen: Effect.sync(() => repository !== null),
    readControl: (namespace) =>
      call(namespace, undefined, (repo) => repo.readControl(namespace)),
    ensureControl: (namespace) =>
      call(namespace, undefined, (repo) => repo.ensureControl(namespace)),
    readCatalog: (namespace) =>
      call(namespace, undefined, (repo) => repo.readCatalog(namespace)),
    readGroupMeta: (namespace, groupId) =>
      call(namespace, groupId, (repo) =>
        repo.readGroupMeta(namespace, groupId),
      ),
    readGroupData: (namespace, groupId) =>
      call(namespace, groupId, (repo) =>
        repo.readGroupData(namespace, groupId),
      ),
    listGroupStatus: (namespace) =>
      call(namespace, undefined, (repo) => repo.listGroupStatus(namespace)),
    replaceCatalog: (input) =>
      call(input.namespace, undefined, (repo) => repo.replaceCatalog(input)),
    commitGroup: (input) =>
      call(input.namespace, input.snapshot.groupId, (repo) =>
        repo.commitGroup(input),
      ),
    confirmGroup: (input) =>
      call(input.namespace, input.groupId, (repo) => repo.confirmGroup(input)),
    markDirty: (input) =>
      call(input.namespace, undefined, (repo) => repo.markDirty(input)),
    evictGroup: (input) =>
      call(input.namespace, input.groupId, (repo) => repo.evictGroup(input)),
    acquireLease: (options) =>
      call(options.namespace, undefined, (repo) => repo.acquireLease(options)),
    renewLease: (options) =>
      call(options.namespace, undefined, (repo) => repo.renewLease(options)),
    releaseLease: (options) =>
      // Best-effort release: expiry fences a crashed owner and generation
      // fencing blocks stale commits even when release fails. A failed
      // release still clears the local handle state via close semantics at
      // the caller; here only genuine unavailability surfaces.
      call(options.namespace, undefined, (repo) => repo.releaseLease(options)),
    deleteExpenseLocally: (options) =>
      call(options.namespace, options.groupId, (repo) =>
        repo.deleteExpenseLocally(options),
      ),
    deleteGroupLocally: (options) =>
      call(options.namespace, options.groupId, (repo) =>
        repo.deleteGroupLocally(options),
      ),
    recordAttempt: (options) =>
      call(options.namespace, options.groupId, (repo) =>
        repo.recordAttempt({ ...options }),
      ),
  }
  return storage
}

/**
 * Scoped storage layer: opens on scope entry, closes on scope exit. Bind one
 * per account namespace scope (supervisor child scope in Task 8); security
 * correctness stays on durable generation/revocation fences, never on this
 * finalizer running.
 */
export function makeOfflineStorageLive(
  deps?: OfflineStorageOpenDeps,
): Layer.Layer<OfflineStorage, StorageServiceError> {
  // Effect v4: Layer.effect runs the acquisition in the layer scope, so the
  // acquireRelease finalizer closes the handle when the account scope ends.
  return Layer.effect(
    OfflineStorage,
    Effect.acquireRelease(
      Effect.flatMap(
        Effect.sync(() => makeOfflineStorage(deps)),
        (storage) => Effect.as(storage.open, storage),
      ),
      (storage) => storage.close,
    ),
  )
}
