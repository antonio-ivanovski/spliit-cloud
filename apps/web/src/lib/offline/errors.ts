/**
 * Typed offline storage errors.
 *
 * Status records persist only {@link OfflineErrorCode} values, never raw server
 * error payloads, messages, or expense text. Use {@link toStatusErrorCode} when
 * recording a failure.
 */

import { Predicate, Schema } from 'effect'

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
 *
 * Iterative cause/inner walk (same depth bound as the original recursion):
 * Dexie and storage wrappers nest the original failure under `cause`/`inner`; a
 * quota failure must still stop writes.
 */
export function isQuotaError(error: unknown, depth = 0): boolean {
  const hasName = Predicate.hasProperty('name')
  const hasCode = Predicate.hasProperty('code')
  const hasMessage = Predicate.hasProperty('message')
  const hasCause = Predicate.hasProperty('cause')
  const hasInner = Predicate.hasProperty('inner')
  const pending: Array<{ node: unknown; level: number }> = [
    { node: error, level: depth },
  ]
  while (pending.length > 0) {
    const current = pending.pop()
    if (current === undefined) continue
    const { node, level } = current
    if (level > 3 || !Predicate.isObject(node)) continue
    const name = hasName(node) ? String(node.name) : ''
    if (name === 'QuotaExceededError') return true
    const code = hasCode(node) ? node.code : undefined
    // DOMException.QUOTA_EXCEEDED_ERR is 22 in legacy implementations.
    if (code === 22) return true
    const message = hasMessage(node) ? String(node.message) : ''
    if (/quota/i.test(`${name} ${message}`) && /exceed/i.test(message)) {
      return true
    }
    if (hasCause(node)) pending.push({ node: node.cause, level: level + 1 })
    if (hasInner(node)) pending.push({ node: node.inner, level: level + 1 })
  }
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

/**
 * Typed offline sync failures (Effect error channel).
 *
 * One `Schema.TaggedError` class per `OfflineErrorCode`-relevant failure group:
 * storage failures, quota, schema/invalid-payload, and fencing
 * (generation/namespace/revision/lease). Fields carry only the persistable code
 * — never messages, server payloads, or expense text.
 *
 * `OfflineErrorCode`, `OfflineStorageError`, `isQuotaError`, and
 * `toStatusErrorCode` above stay stable: the repository, database, store, and
 * storage service import them. These tagged classes are additive.
 */
export class OfflineStorageFailure extends Schema.TaggedError<OfflineStorageFailure>()(
  'OfflineStorageFailure',
  {
    code: Schema.Literals(['storage-unavailable', 'storage-blocked']),
  },
) {}

export class OfflineQuotaFailure extends Schema.TaggedError<OfflineQuotaFailure>()(
  'OfflineQuotaFailure',
  {
    code: Schema.Literals(['quota-exceeded']),
  },
) {}

export class OfflineSchemaFailure extends Schema.TaggedError<OfflineSchemaFailure>()(
  'OfflineSchemaFailure',
  {
    code: Schema.Literals([
      'schema-unsupported',
      'corrupt-record',
      'invalid-payload',
    ]),
  },
) {}

export class OfflineFencingFailure extends Schema.TaggedError<OfflineFencingFailure>()(
  'OfflineFencingFailure',
  {
    code: Schema.Literals([
      'generation-mismatch',
      'namespace-revoked',
      'revision-changed',
      'lease-conflict',
    ]),
  },
) {}

/** Every typed offline sync failure. Defects and interruption are not members. */
export type OfflineSyncFailure =
  | OfflineStorageFailure
  | OfflineQuotaFailure
  | OfflineSchemaFailure
  | OfflineFencingFailure

/** True for typed offline sync failures (never defects, never interruption). */
export function isOfflineSyncFailure(
  error: unknown,
): error is OfflineSyncFailure {
  return (
    Predicate.isTagged(error, 'OfflineStorageFailure') ||
    Predicate.isTagged(error, 'OfflineQuotaFailure') ||
    Predicate.isTagged(error, 'OfflineSchemaFailure') ||
    Predicate.isTagged(error, 'OfflineFencingFailure')
  )
}

/**
 * Single mapError-at-the-boundary normalizer into the typed channel.
 *
 * Maps `OfflineStorageError` by code (checked before quota-likeness, so a
 * storage error carrying a nested quota cause keeps its own code) and raw
 * quota-like failures to `OfflineQuotaFailure`. Already-tagged failures pass
 * through untouched. Anything else — network/fetch rejections, auth shapes,
 * aborts, defects — is NOT a storage failure and returns null so callers keep
 * the legacy classification probes for it.
 *
 * The Dexie boundary itself (mapDexieError in database.ts) is owned elsewhere;
 * sync.ts wraps repository throws with this at its own call sites.
 */
export function toOfflineSyncFailure(
  error: unknown,
): OfflineSyncFailure | null {
  if (isOfflineSyncFailure(error)) return error
  if (isOfflineStorageError(error)) {
    switch (error.code) {
      case 'storage-unavailable':
      case 'storage-blocked':
        return new OfflineStorageFailure({ code: error.code })
      case 'quota-exceeded':
        return new OfflineQuotaFailure({ code: error.code })
      case 'schema-unsupported':
      case 'corrupt-record':
      case 'invalid-payload':
        return new OfflineSchemaFailure({ code: error.code })
      case 'generation-mismatch':
      case 'namespace-revoked':
      case 'revision-changed':
      case 'lease-conflict':
        return new OfflineFencingFailure({ code: error.code })
    }
  }
  if (isQuotaError(error)) {
    return new OfflineQuotaFailure({ code: 'quota-exceeded' })
  }
  return null
}
