import { Context, Effect, Layer, Predicate, Schedule, Schema } from 'effect'

import { isQuotaError } from '@/lib/offline/errors'
import { expenseApiSchema } from '@spliit/domain'
import type { Expense } from '@spliit/domain'

/**
 * Offline expense-create flush pipeline (Phase 1).
 *
 * Drains the `pendingExpenses` Dexie outbox after reconnect, oldest
 * `createdAtMs` first. Each row reuses its caller-provided `requestId`, so the
 * server's idempotent-create record (`runIdempotentCreate`, keyed on account +
 * operation + requestId) makes replay-after-reconnect safe: the same payload
 * replays to the stored result instead of double-posting.
 *
 * Outcome rules:
 *
 * - Success deletes the temp row. The real row arrives through the download pass
 *   that follows the flush (delete-temp + insert-real reconcile; the temp row
 *   is never mutated in place).
 * - Permanent rejection marks the row `failed` and never retries it:
 *   `BAD_REQUEST` (payload the server cannot accept), `CONFLICT` for a request
 *   id already used with _different input_, and other definitive 4xx
 *   (`FORBIDDEN` on an archived group, `UNAUTHORIZED`, `NOT_FOUND`). A
 *   `CONFLICT` that only reports _in-flight_ processing stays `pending`: the
 *   first attempt may still commit, and the next flush replays to its result.
 *   The different-input match couples to the API's idempotency message
 *   (`apps/api/src/lib/api/idempotency.ts`); an unrecognized `CONFLICT` message
 *   fails safe to deferred, never to failed.
 * - Transient failures (network loss, 5xx, 429, timeouts) retry with exponential
 *   backoff + jitter, bounded to 3 retries per row per flush. Exhausted rows
 *   stay `pending` for the next reconnect — the flush itself never loops.
 *
 * Validation split (repo rule): durable/server boundaries stay zod
 * (`pendingExpenseRecordSchema` at the outbox write, `expenseApiSchema` on the
 * payload right before the network send). Effect `Schema` decodes the row
 * envelope _inside_ this pipeline; corrupt rows mark `failed` without ever
 * reaching the network.
 *
 * Dependencies arrive as plain interfaces (Dexie adapters + the vanilla tRPC
 * mutate fn live in `lib/offline/pending-expense-queue.ts`); Promise conversion
 * happens only at the caller's ManagedRuntime bridge, never in here.
 */

export interface PendingFlushCreateInput {
  readonly groupId: string
  readonly requestId: string
  readonly expense: Expense
}

/**
 * Server result shape. Mirrors `createExpenseOutputSchema` (`{ expenseId,
 * recurringSeriesId }`) without importing the API package: the flush only
 * forwards these two fields.
 */
export interface PendingFlushCreateResult {
  readonly expenseId: string
  readonly recurringSeriesId: string | null
}

export interface PendingFlushStoreKey {
  readonly groupId: string
  readonly clientId: string
}

export type PendingFlushOutcome = 'sent' | 'failed'

export interface PendingExpenseFlushDeps {
  /**
   * Raw outbox rows for the namespace. Unknowns on purpose: every row is
   * decoded inside the pipeline so corrupt rows mark `failed` instead of
   * throwing the flush.
   */
  readonly listPending: (input: {
    readonly namespace: string
  }) => Promise<ReadonlyArray<unknown>>
  /** `sent` deletes the temp row; `failed` pins it as failed. */
  readonly markResult: (
    input: PendingFlushStoreKey & { readonly outcome: PendingFlushOutcome },
  ) => Promise<void>
  /** Vanilla `client.groups.expenses.create.mutate` (no guard link). */
  readonly createExpense: (
    input: PendingFlushCreateInput,
  ) => Promise<PendingFlushCreateResult>
}

export interface PendingFlushSummary {
  readonly total: number
  readonly sent: number
  readonly failed: number
  readonly deferred: number
}

export class PendingFlushStorageError extends Schema.TaggedError<PendingFlushStorageError>()(
  'PendingFlushStorageError',
  {
    code: Schema.Literals(['storage-unavailable', 'quota-exceeded']),
  },
) {}

export interface PendingExpenseFlush {
  /**
   * Flush every `pending` row for the namespace in `createdAtMs` order. Per-row
   * outcomes accumulate in the summary; only outbox _access_ failures
   * (list/mark) fail the whole flush. Already-`failed` rows are skipped, never
   * retried.
   */
  readonly flush: (input: {
    readonly namespace: string
  }) => Effect.Effect<PendingFlushSummary, PendingFlushStorageError>
}

export const PendingExpenseFlush = Context.Service<PendingExpenseFlush>(
  'PendingExpenseFlush',
)

/** Row envelope decoded inside the pipeline; the expense payload stays zod. */
const FlushRowSchema = Schema.Struct({
  namespace: Schema.NonEmptyString,
  groupId: Schema.NonEmptyString,
  clientId: Schema.NonEmptyString,
  requestId: Schema.NonEmptyString,
  createdAtMs: Schema.Number,
  status: Schema.Literals(['pending', 'failed']),
  expense: Schema.Unknown,
})

type FlushRow = typeof FlushRowSchema.Type

const decodeRow = Schema.decodeUnknownEffect(FlushRowSchema)

/** Bounded exponential backoff with jitter for transient sends. */
const TRANSIENT_RETRY_SCHEDULE = Schedule.exponential('100 millis').pipe(
  Schedule.jittered,
)

/** Max send attempts per row per flush (initial attempt + 3 retries). */
const TRANSIENT_RETRY_TIMES = 3

function toStorageError(error: unknown): PendingFlushStorageError {
  if (isQuotaError(error)) {
    return new PendingFlushStorageError({ code: 'quota-exceeded' })
  }
  return new PendingFlushStorageError({ code: 'storage-unavailable' })
}

const hasCode = Predicate.hasProperty('code')
const hasData = Predicate.hasProperty('data')
const hasMessage = Predicate.hasProperty('message')

/** TRPC/HTTP status code carried by a send rejection, when present. */
function statusCodeOf(error: unknown): string | number | null {
  if (!Predicate.isObject(error)) return null
  const direct = hasCode(error) ? error.code : undefined
  if (typeof direct === 'string' || typeof direct === 'number') return direct
  if (hasData(error) && Predicate.isObject(error.data)) {
    const nested = hasCode(error.data) ? error.data.code : undefined
    if (typeof nested === 'string' || typeof nested === 'number') return nested
  }
  return null
}

function messageOf(error: unknown): string {
  if (!Predicate.isObject(error)) return ''
  return hasMessage(error) ? String(error.message) : ''
}

type RowDisposition = 'sent' | 'failed' | 'deferred'

/**
 * Classify a send rejection. Permanent rejections mark the row `failed`;
 * anything else is transient (bounded retry, then deferred to the next
 * reconnect). `CONFLICT` splits on the server's different-input message so an
 * in-flight replay never strands a row as failed.
 */
function classifySendError(error: unknown): RowDisposition {
  const code = statusCodeOf(error)
  if (code === 'BAD_REQUEST') return 'failed'
  if (code === 'CONFLICT') {
    return /different input/.test(messageOf(error)) ? 'failed' : 'deferred'
  }
  switch (code) {
    case 'FORBIDDEN':
    case 'UNAUTHORIZED':
    case 'NOT_FOUND':
    case 'METHOD_NOT_SUPPORTED':
    case 400:
    case 401:
    case 403:
    case 404:
    case 405:
    case 422:
      return 'failed'
    default:
      return 'deferred'
  }
}

const isTransientSendError = (error: unknown): boolean =>
  classifySendError(error) === 'deferred'

/**
 * Retry gate: only genuinely transient sends retry in-flush. An in-flight
 * `CONFLICT` (the first attempt may still commit) defers to the next flush
 * without spending retries — its replay resolves once the server finishes.
 */
const isRetryableSendError = (error: unknown): boolean =>
  isTransientSendError(error) && statusCodeOf(error) !== 'CONFLICT'

const hasGroupId = Predicate.hasProperty('groupId')
const hasClientId = Predicate.hasProperty('clientId')

/** Lenient addressing for corrupt rows: mark `failed` only when possible. */
function addressOf(candidate: unknown): PendingFlushStoreKey | null {
  if (!Predicate.isObject(candidate)) return null
  const groupId = hasGroupId(candidate) ? candidate.groupId : undefined
  const clientId = hasClientId(candidate) ? candidate.clientId : undefined
  if (
    !Predicate.isString(groupId) ||
    groupId.length === 0 ||
    !Predicate.isString(clientId) ||
    clientId.length === 0
  ) {
    return null
  }
  return { groupId, clientId }
}

const compareFlushRows = (left: FlushRow, right: FlushRow): number => {
  if (left.createdAtMs !== right.createdAtMs) {
    return left.createdAtMs - right.createdAtMs
  }
  return left.clientId < right.clientId
    ? -1
    : left.clientId > right.clientId
      ? 1
      : 0
}

export function makePendingExpenseFlush(
  deps: PendingExpenseFlushDeps,
): PendingExpenseFlush {
  const markOutcome = (
    namespace: string,
    key: PendingFlushStoreKey,
    outcome: PendingFlushOutcome,
  ): Effect.Effect<void, PendingFlushStorageError> =>
    Effect.tryPromise({
      try: () => deps.markResult({ ...key, outcome }),
      catch: (error: unknown) => toStorageError(error),
    })

  const sendRow = (
    row: FlushRow,
  ): Effect.Effect<PendingFlushCreateResult, unknown, never> => {
    // Wire-boundary validation stays zod: the exact procedure schema gates
    // the network send, so an invalid stored payload marks `failed` here
    // and never reaches the server.
    const parsed = expenseApiSchema.safeParse(row.expense)
    if (!parsed.success) {
      return Effect.fail({ code: 'BAD_REQUEST' as const })
    }
    const payload: PendingFlushCreateInput = {
      groupId: row.groupId,
      requestId: row.requestId,
      expense: parsed.data,
    }
    return Effect.tryPromise({
      try: () => deps.createExpense(payload),
      catch: (error: unknown) => error,
    }).pipe(
      Effect.retry({
        schedule: TRANSIENT_RETRY_SCHEDULE,
        times: TRANSIENT_RETRY_TIMES,
        while: isRetryableSendError,
      }),
    )
  }

  const flushRow = (
    namespace: string,
    row: FlushRow,
    summary: {
      sent: number
      failed: number
      deferred: number
    },
  ): Effect.Effect<void, PendingFlushStorageError> =>
    Effect.gen(function* () {
      const key: PendingFlushStoreKey = {
        groupId: row.groupId,
        clientId: row.clientId,
      }
      const outcome = yield* Effect.matchEffect(sendRow(row), {
        onFailure: (error: unknown) => Effect.succeed(classifySendError(error)),
        onSuccess: () => Effect.succeed('sent' as const),
      })
      if (outcome === 'sent') {
        yield* markOutcome(namespace, key, 'sent')
        summary.sent += 1
        return
      }
      if (outcome === 'failed') {
        yield* markOutcome(namespace, key, 'failed')
        summary.failed += 1
        return
      }
      summary.deferred += 1
    })

  const flush: PendingExpenseFlush['flush'] = (input) =>
    Effect.gen(function* () {
      const raw = yield* Effect.tryPromise({
        try: () => deps.listPending({ namespace: input.namespace }),
        catch: (error: unknown) => toStorageError(error),
      })
      // Decode inside the pipeline: corrupt rows mark `failed` (visible in
      // the overlay) instead of failing the flush.
      const rows: FlushRow[] = []
      const summary = { sent: 0, failed: 0, deferred: 0 }
      for (const candidate of raw) {
        const decoded = yield* Effect.exit(decodeRow(candidate))
        if (decoded._tag === 'Success') {
          rows.push(decoded.value)
          continue
        }
        // Corrupt durable row: mark `failed` when addressable so it never
        // retries. Unaddressable junk (impossible via the validated write
        // path) only counts — there is no key to mark.
        const key = addressOf(candidate)
        if (key !== null) {
          yield* markOutcome(input.namespace, key, 'failed').pipe(Effect.ignore)
        }
        summary.failed += 1
      }
      // Oldest first; failed rows never retry.
      const ordered = rows
        .filter((row) => row.status === 'pending')
        .sort(compareFlushRows)
      for (const row of ordered) {
        yield* flushRow(input.namespace, row, summary)
      }
      const total = raw.length
      yield* Effect.logInfo('Pending expense flush finished', {
        total,
        ...summary,
      })
      return { total, ...summary } satisfies PendingFlushSummary
    })

  return { flush }
}

export function makePendingExpenseFlushLive(
  deps: PendingExpenseFlushDeps,
): Layer.Layer<PendingExpenseFlush, PendingFlushStorageError> {
  return Layer.succeed(PendingExpenseFlush, makePendingExpenseFlush(deps))
}
