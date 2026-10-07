/**
 * Typed offline storage errors.
 *
 * Status records persist only {@link OfflineErrorCode} values, never raw server
 * error payloads, messages, or expense text. Use {@link toStatusErrorCode} when
 * recording a failure.
 */

/** Machine-readable offline failure, safe to persist in status records. */
export type OfflineErrorCode =
  | 'storage-unavailable'
  | 'storage-blocked'
  | 'quota-exceeded'
  | 'schema-unsupported'
  | 'corrupt-record'
  | 'generation-mismatch'
  | 'revision-changed'
  | 'namespace-revoked'
  | 'lease-conflict'
  | 'invalid-payload'

export class OfflineStorageError extends Error {
  readonly code: OfflineErrorCode
  readonly namespace?: string
  readonly groupId?: string

  constructor(
    code: OfflineErrorCode,
    message?: string,
    options?: { namespace?: string; groupId?: string; cause?: unknown },
  ) {
    // Messages stay generic on purpose: never include server payloads,
    // expense titles/notes, or tokens.
    super(message ?? code)
    this.name = 'OfflineStorageError'
    this.code = code
    this.namespace = options?.namespace
    this.groupId = options?.groupId
    if (options?.cause !== undefined) {
      // `cause` is supported on modern runtimes; assign defensively.
      ;(this as { cause?: unknown }).cause = options.cause
    }
  }
}

export function isOfflineStorageError(
  error: unknown,
): error is OfflineStorageError {
  return error instanceof OfflineStorageError
}

/**
 * True for IndexedDB quota failures. Transaction abort preserves the previous
 * complete data; callers must stop new background writes for that pass and
 * surface Retry/Clear actions instead of auto-evicting arbitrary groups.
 */
export function isQuotaError(error: unknown, depth = 0): boolean {
  if (!error || typeof error !== 'object' || depth > 3) return false
  const name = 'name' in error ? String(error.name) : ''
  if (name === 'QuotaExceededError') return true
  const code = 'code' in error ? error.code : undefined
  // DOMException.QUOTA_EXCEEDED_ERR is 22 in legacy implementations.
  if (code === 22) return true
  const message = 'message' in error ? String(error.message) : ''
  if (/quota/i.test(`${name} ${message}`) && /exceed/i.test(message)) {
    return true
  }
  // Dexie and storage wrappers nest the original failure under
  // `cause`/`inner`; a quota failure must still stop writes.
  if ('cause' in error && isQuotaError(error.cause, depth + 1)) return true
  if ('inner' in error && isQuotaError(error.inner, depth + 1)) return true
  return false
}

/**
 * Map any failure to a persistable code. Never persists messages, server
 * payloads, or expense text.
 */
export function toStatusErrorCode(error: unknown): OfflineErrorCode {
  if (isOfflineStorageError(error)) return error.code
  if (isQuotaError(error)) return 'quota-exceeded'
  return 'storage-unavailable'
}
