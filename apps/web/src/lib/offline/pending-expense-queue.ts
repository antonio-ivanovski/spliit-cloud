import { createTRPCClient, httpLink } from '@trpc/client'
import { Dexie } from 'dexie'
import { Effect, Predicate } from 'effect'
import superjson from 'superjson'

import { getApiBaseUrl } from '@/lib/api-url'
import { trackedFetch } from '@/lib/connectivity'
import {
  makePendingExpenseFlush,
  PendingExpenseFlush,
  type PendingFlushCreateResult,
  type PendingFlushStorageError,
  type PendingFlushSummary,
} from '@/lib/services/pending-expense-flush'
import type { AppRouter } from '@spliit/api/router'
import type { Expense } from '@spliit/domain'

import {
  buildNamespace,
  pendingExpenseRecordSchema,
  type PendingExpenseRecord,
} from './contract'
import {
  mapDexieError,
  openOfflineDatabase,
  type OfflineDexieDatabase,
} from './database'

/**
 * Offline expense-create queue: Dexie outbox IO, mutation identification, and
 * the reconnect flush bridge (Phase 1).
 *
 * The write guard (`write-guard.ts`) diverts only `groups.expenses.create` here
 * while known-offline; every other mutation still throws `OfflineWriteError`.
 * The flush pipeline (`PendingExpenseFlush`) owns retry and outcome policy —
 * this module only adapts Dexie and the vanilla tRPC mutate client to its
 * injected interfaces. Overlay (list affordance) writes stay in
 * `pending-expenses.ts`; the flush reports resolutions back through the
 * `onResolved` callback so the overlay deletes temp rows on success and pins
 * them as failed on permanent rejection.
 *
 * Validation split: records parse with `pendingExpenseRecordSchema` _outside_
 * every Dexie transaction (repository precedent); the flush re-decodes with
 * Effect Schema inside its pipeline and re-validates the payload with
 * `expenseApiSchema` at the wire boundary.
 */

/** The only procedure diverted offline. Everything else still throws. */
export const EXPENSE_CREATE_PROCEDURE_PATH = 'groups.expenses.create'

export type PendingExpenseResolution = {
  readonly groupId: string
  readonly clientId: string
  readonly outcome: 'sent' | 'failed'
}

/**
 * Dotted procedure path from a TanStack mutation's identity. tRPC v11 sets
 * `mutationKey` to `[[...pathSegments]]` (plus an optional input element);
 * `meta.procedurePath` is a documented escape hatch for imperative
 * `client.mutate` calls that set it explicitly. Anything else is not an expense
 * create.
 */
export function getMutationProcedurePath(options: {
  readonly mutationKey?: unknown
  readonly meta?: unknown
}): string | null {
  const { mutationKey, meta } = options
  if (Array.isArray(mutationKey) && mutationKey.length > 0) {
    const segments = mutationKey[0]
    if (Array.isArray(segments) && segments.every(Predicate.isString)) {
      return segments.join('.')
    }
    if (Predicate.isString(segments) && segments.length > 0) return segments
  }
  if (Predicate.isObject(meta)) {
    const candidate = Predicate.hasProperty('procedurePath')(meta)
      ? meta.procedurePath
      : undefined
    if (Array.isArray(candidate) && candidate.every(Predicate.isString)) {
      return candidate.join('.')
    }
    if (Predicate.isString(candidate) && candidate.length > 0) return candidate
  }
  return null
}

export function isExpenseCreateMutation(options: {
  readonly mutationKey?: unknown
  readonly meta?: unknown
}): boolean {
  return getMutationProcedurePath(options) === EXPENSE_CREATE_PROCEDURE_PATH
}

/** TRPC link operations carry the dotted path directly. */
export function isExpenseCreateOpPath(path: unknown): path is string {
  return Predicate.isString(path) && path === EXPENSE_CREATE_PROCEDURE_PATH
}

/** Temp id derived from the idempotency key: never collides with server ids. */
export function queuedClientIdFor(requestId: string): string {
  return `pending-${requestId}`
}

/**
 * Namespace for outbox rows. Null when no account identity is cached (never in
 * practice for expense creation, which requires a session): callers then keep
 * the overlay-only row and skip the durable outbox write.
 */
export function resolvePendingNamespace(
  accountId: string | null | undefined,
): string | null {
  if (!Predicate.isString(accountId) || accountId.length === 0) return null
  try {
    return buildNamespace(getApiBaseUrl(), accountId)
  } catch {
    return null
  }
}

export type PendingExpenseEnqueueInput = {
  readonly namespace: string
  readonly groupId: string
  readonly requestId: string
  readonly expense: unknown
  readonly createdAtMs?: number
}

/**
 * Assemble and validate an outbox record. Null when the variables are not a
 * valid expense create (bad shape or a payload the procedure would reject):
 * callers fail those closed with `OfflineWriteError`, preserving the old
 * behavior for input that could never flush.
 */
export function buildPendingExpenseRecord(
  input: PendingExpenseEnqueueInput,
): PendingExpenseRecord | null {
  const parsed = pendingExpenseRecordSchema.safeParse({
    namespace: input.namespace,
    groupId: input.groupId,
    clientId: queuedClientIdFor(input.requestId),
    requestId: input.requestId,
    createdAtMs: input.createdAtMs ?? Date.now(),
    status: 'pending',
    expense: input.expense,
  })
  return parsed.success ? parsed.data : null
}

/**
 * Synthetic create result returned to a diverted offline mutation. The
 * `expenseId` is the temp id (real id arrives via the post-flush download);
 * callers treat it opaquely for invalidation.
 */
export function queuedExpenseResult(record: PendingExpenseRecord): {
  readonly expenseId: string
  readonly recurringSeriesId: null
} {
  return { expenseId: record.clientId, recurringSeriesId: null }
}

async function withPendingDatabase<T>(
  run: (db: OfflineDexieDatabase) => Promise<T>,
): Promise<T> {
  const db = await openOfflineDatabase().catch((error): never =>
    mapDexieError(error),
  )
  try {
    return await run(db)
  } finally {
    try {
      db.close()
    } catch {
      // Close failures never fail the outbox operation.
    }
  }
}

/** Persist a validated record. Rejects on validation or storage failure. */
export async function savePendingExpenseRecord(
  record: unknown,
): Promise<PendingExpenseRecord> {
  const parsed = pendingExpenseRecordSchema.safeParse(record)
  if (!parsed.success) {
    throw new Error('pending-expense-invalid')
  }
  const validated = parsed.data
  await withPendingDatabase((db) => db.pendingExpenses.put(validated))
  return validated
}

/** Raw rows for one namespace. Undecoded on purpose: the flush decodes. */
export async function listPendingExpenseRecords(
  namespace: string,
): Promise<unknown[]> {
  const db = await openOfflineDatabase().catch((error): never =>
    mapDexieError(error),
  )
  try {
    const rows = await db.pendingExpenses
      .where('[namespace+groupId]')
      .between([namespace, Dexie.minKey], [namespace, Dexie.maxKey], true, true)
      .toArray()
    return [...rows]
  } finally {
    try {
      db.close()
    } catch {
      // Close failures never fail the outbox read.
    }
  }
}

export async function deletePendingExpenseRecord(input: {
  readonly namespace: string
  readonly groupId: string
  readonly clientId: string
}): Promise<void> {
  await withPendingDatabase((db) =>
    db.pendingExpenses.delete([input.namespace, input.groupId, input.clientId]),
  )
}

export async function markPendingExpenseFailed(input: {
  readonly namespace: string
  readonly groupId: string
  readonly clientId: string
}): Promise<void> {
  await withPendingDatabase(async (db) => {
    const existing = await db.pendingExpenses.get([
      input.namespace,
      input.groupId,
      input.clientId,
    ])
    if (!existing) return
    const parsed = pendingExpenseRecordSchema.safeParse({
      ...existing,
      status: 'failed',
    })
    if (!parsed.success) return
    await db.pendingExpenses.put(parsed.data)
  })
}

/** Apply a flush outcome to the durable outbox. */
export async function resolvePendingExpenseRecord(
  namespace: string,
  resolution: PendingExpenseResolution,
): Promise<void> {
  if (resolution.outcome === 'sent') {
    await deletePendingExpenseRecord({
      namespace,
      groupId: resolution.groupId,
      clientId: resolution.clientId,
    })
    return
  }
  await markPendingExpenseFailed({
    namespace,
    groupId: resolution.groupId,
    clientId: resolution.clientId,
  })
}

/**
 * Vanilla (non-React) create client for the flush. Dedicated unbatched link
 * with SuperJSON, mirroring the offline download fetchers — and deliberately
 * _without_ the write-guard link, which would reject the flush itself while the
 * transport still reports unreachable.
 */
export type PendingExpenseCreateFn = (input: {
  readonly groupId: string
  readonly requestId: string
  readonly expense: Expense
}) => Promise<PendingFlushCreateResult>

export function createPendingExpenseCreateFn(options?: {
  baseUrl?: string
  fetchFn?: typeof fetch
}): PendingExpenseCreateFn {
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
  return (input) => client.groups.expenses.create.mutate(input)
}

/**
 * Self-sufficient flush program for the reconnect bridge: Dexie adapters +
 * vanilla mutate client wired into the service, fully provided so the caller
 * only runs it through the page runtime (`getPageRuntime().runPromise`).
 * Promise conversion stays at that imperative edge, never inside services.
 */
export function buildPendingExpenseFlushProgram(input: {
  readonly namespace: string
  readonly onResolved?: (resolution: PendingExpenseResolution) => void
  readonly createExpense?: PendingExpenseCreateFn
}): Effect.Effect<PendingFlushSummary, PendingFlushStorageError> {
  const namespace = input.namespace
  const createExpense = input.createExpense ?? createPendingExpenseCreateFn()
  const service = makePendingExpenseFlush({
    listPending: () => listPendingExpenseRecords(namespace),
    markResult: async (key) => {
      await resolvePendingExpenseRecord(namespace, key)
      try {
        input.onResolved?.(key)
      } catch {
        // Overlay notification must never fail the flush.
      }
    },
    createExpense,
  })
  return service
    .flush({ namespace })
    .pipe(Effect.provideService(PendingExpenseFlush, service))
}
