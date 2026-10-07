import { Data } from 'effect'

/**
 * Typed client-service failures.
 *
 * Every tag below is an _expected_ failure the UI can name honestly. Anything
 * else — including Effect interruption and defects — is a different channel:
 *
 * - Interruption (user abort, account-switch fence, timeout winner cancelling the
 *   loser, scope close) is Effect's built-in interruption, never one of these
 *   tags and never surfaced as "offline".
 * - Defects (programming errors, unexpected throws inside services) stay in the
 *   defect channel; adapters normalize unknown third-party failures to one of
 *   these tags exactly once at the boundary (see platform.ts).
 *
 * Payload rules: fields carry only safe metadata (status codes, delays, ids,
 * capability names). Never server payloads, messages, expense text, tokens, or
 * credentials — the UI boundary (outcomes.ts) additionally guarantees nothing
 * raw reaches persistent status or logs.
 */

/** Genuine connectivity loss: DNS/connection refused/reset, offline device. */
export class NetworkError extends Data.TaggedError('NetworkError')<{
  readonly reason: string
}> {}

/** A bounded wait expired (probe, session verify, worker request). Not an abort. */
export class TimeoutError extends Data.TaggedError('TimeoutError')<{
  readonly operation: string
  readonly timeoutMs: number
}> {}

/** The server answered with an HTTP error status. Reachable, not offline. */
export class HttpError extends Data.TaggedError('HttpError')<{
  readonly status: number
}> {}

/** HTTP 429 with a server-blessed earliest retry time. Never retried early. */
export class RateLimitError extends Data.TaggedError('RateLimitError')<{
  readonly status: 429
  readonly retryAfterMs: number
}> {}

/** Session verification rejected the identity (auth says signed out / denied). */
export class SessionRejectedError extends Data.TaggedError(
  'SessionRejectedError',
)<{
  readonly status?: number
}> {}

/** The account may not read this group (403 / guard denial). Never a sign-out. */
export class GroupDeniedError extends Data.TaggedError('GroupDeniedError')<{
  readonly groupId: string
  readonly status?: number
}> {}

/** IndexedDB open blocked (other tabs hold the old version). */
export class StorageBlockedError extends Data.TaggedError(
  'StorageBlockedError',
)<{}> {}

/** Storage unavailable or an unexpected storage failure. */
export class StorageUnavailableError extends Data.TaggedError(
  'StorageUnavailableError',
)<{
  readonly reason: string
}> {}

/** Quota exceeded: stop download writes, keep reads, never auto-evict. */
export class StorageQuotaError extends Data.TaggedError('StorageQuotaError')<{
  readonly groupId?: string
}> {}

/** Newer/unknown schema: leave the data untouched. */
export class StorageSchemaError extends Data.TaggedError('StorageSchemaError')<{
  readonly schemaVersion: unknown
}> {}

/** A persisted record failed validation: evict to missing, never synthesize. */
export class StorageCorruptError extends Data.TaggedError(
  'StorageCorruptError',
)<{
  readonly reason: string
  readonly groupId?: string
}> {}

/** Namespace generation changed or was revoked under this account scope. */
export class StaleGenerationError extends Data.TaggedError(
  'StaleGenerationError',
)<{
  readonly namespace: string
}> {}

/** Publication revision moved on; the result belongs to a retired snapshot. */
export class StaleRevisionError extends Data.TaggedError('StaleRevisionError')<{
  readonly groupId?: string
}> {}

/** Sync/storage lease lost to another tab; the pass must stop, not fight. */
export class StaleLeaseError extends Data.TaggedError('StaleLeaseError')<{
  readonly owner?: string
}> {}

/** Query worker missing, timed out, crashed, or answered for a stale scope. */
export class WorkerError extends Data.TaggedError('WorkerError')<{
  readonly worker: 'query' | 'import'
  readonly reason: string
}> {}

/** The browser/engine cannot do this (no worker, no IDB, no SW). */
export class CapabilityError extends Data.TaggedError('CapabilityError')<{
  readonly capability: string
}> {}

/** A permission was denied or needs a user gesture (notifications, persist). */
export class PermissionError extends Data.TaggedError('PermissionError')<{
  readonly permission: string
}> {}

/**
 * Upload staging/transfer/finalize ended partially or unknown. No blanket
 * retry.
 */
export class UploadError extends Data.TaggedError('UploadError')<{
  readonly stage: 'decode' | 'presign' | 'transfer' | 'finalize' | 'cleanup'
  readonly reason: string
}> {}

/** Every expected service failure. Defects and interruption are not members. */
export type ServiceError =
  | NetworkError
  | TimeoutError
  | HttpError
  | RateLimitError
  | SessionRejectedError
  | GroupDeniedError
  | StorageBlockedError
  | StorageUnavailableError
  | StorageQuotaError
  | StorageSchemaError
  | StorageCorruptError
  | StaleGenerationError
  | StaleRevisionError
  | StaleLeaseError
  | WorkerError
  | CapabilityError
  | PermissionError
  | UploadError

const SERVICE_TAGS: ReadonlySet<string> = new Set([
  'NetworkError',
  'TimeoutError',
  'HttpError',
  'RateLimitError',
  'SessionRejectedError',
  'GroupDeniedError',
  'StorageBlockedError',
  'StorageUnavailableError',
  'StorageQuotaError',
  'StorageSchemaError',
  'StorageCorruptError',
  'StaleGenerationError',
  'StaleRevisionError',
  'StaleLeaseError',
  'WorkerError',
  'CapabilityError',
  'PermissionError',
  'UploadError',
])

/** True for expected service failures (never defects, never interruption). */
export function isServiceError(error: unknown): error is ServiceError {
  return (
    typeof error === 'object' &&
    error !== null &&
    '_tag' in error &&
    typeof (error as { _tag: unknown })._tag === 'string' &&
    SERVICE_TAGS.has((error as { _tag: string })._tag)
  )
}

/** True for failures that prove the device cannot reach anyone right now. */
export function isOfflineProof(
  error: unknown,
): error is NetworkError | TimeoutError {
  return (
    typeof error === 'object' &&
    error !== null &&
    ((error as { _tag?: unknown })._tag === 'NetworkError' ||
      (error as { _tag?: unknown })._tag === 'TimeoutError')
  )
}

/** True when the server answered (reachable even when the answer is an error). */
export function isServerAnswer(
  error: unknown,
): error is HttpError | RateLimitError {
  return (
    typeof error === 'object' &&
    error !== null &&
    ((error as { _tag?: unknown })._tag === 'HttpError' ||
      (error as { _tag?: unknown })._tag === 'RateLimitError')
  )
}
