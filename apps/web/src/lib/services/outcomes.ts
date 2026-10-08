import type { OfflineErrorCode } from '@/lib/offline/errors'
import { toStatusErrorCode } from '@/lib/offline/errors'
import type { ConnectivityStatus } from '@/lib/use-online-status'

import { isServiceError } from './errors'

/**
 * UI boundary mapping: typed service errors become the existing application
 * outcomes. Components, persistent status, and logs only ever see these values
 * — never a raw Effect Cause, SDK payload, or failure detail.
 *
 * Parity rules:
 *
 * - Persisted status codes match toStatusErrorCode exactly for every input the
 *   old code could produce (unknown/transport failures persist as
 *   storage-unavailable, storage failures keep their specific code).
 * - Connectivity projection matches the store semantics: genuine transport loss
 *   is offline, a server answer (even 5xx/portal/429) is never offline.
 */

export function mapToPersistedCode(error: unknown): OfflineErrorCode {
  if (!isServiceError(error)) return toStatusErrorCode(error)
  switch (error._tag) {
    case 'StorageBlockedError':
      return 'storage-blocked'
    case 'StorageUnavailableError':
      return 'storage-unavailable'
    case 'StorageQuotaError':
      return 'quota-exceeded'
    case 'StorageSchemaError':
      return 'schema-unsupported'
    case 'StorageCorruptError':
      return 'corrupt-record'
    case 'StaleGenerationError':
      return 'generation-mismatch'
    case 'StaleRevisionError':
      return 'revision-changed'
    case 'StaleLeaseError':
      return 'lease-conflict'
    default:
      return toStatusErrorCode(error)
  }
}

/**
 * Connectivity projection for transport/server failures. Returns null for
 * families that carry no connectivity signal (storage, session, worker,
 * capability, permission, upload) so callers cannot mistake them for network
 * state.
 */
export function mapToConnectivityStatus(
  error: unknown,
): ConnectivityStatus | null {
  if (!isServiceError(error)) return null
  switch (error._tag) {
    case 'NetworkError':
      return 'offline'
    case 'TimeoutError':
      // Only transport timeouts signal connectivity. Worker/local timeouts
      // (offline-query, offline-download) are capability slowness, not
      // network loss, and must not flip the offline UI.
      return error.operation === 'fetch' ? 'offline' : null
    case 'HttpError':
    case 'RateLimitError':
      return 'server-unreachable'
    default:
      return null
  }
}

/**
 * Log-safe one-line description. Generic per tag plus safe scalars only (status
 * codes, operation names); never messages, payloads, or ids that could carry
 * user content.
 */
export function safeMessageForLog(error: unknown): string {
  if (!isServiceError(error)) return 'service-unavailable'
  switch (error._tag) {
    case 'NetworkError':
      return 'network-unreachable'
    case 'TimeoutError':
      return 'request-timeout:' + error.operation
    case 'HttpError':
      return 'http-error:' + String(error.status)
    case 'RateLimitError':
      return 'rate-limited'
    case 'SessionRejectedError':
      return 'session-rejected'
    case 'GroupDeniedError':
      return 'group-denied'
    case 'StorageBlockedError':
      return 'storage-blocked'
    case 'StorageUnavailableError':
      return 'storage-unavailable'
    case 'StorageQuotaError':
      return 'storage-quota-exceeded'
    case 'StorageSchemaError':
      return 'storage-schema-unsupported'
    case 'StorageCorruptError':
      return 'storage-corrupt-record'
    case 'StaleGenerationError':
      return 'stale-generation'
    case 'StaleRevisionError':
      return 'stale-revision'
    case 'StaleLeaseError':
      return 'stale-lease'
    case 'WorkerError':
      return 'worker-error:' + error.worker
    case 'CapabilityError':
      return 'capability-missing:' + error.capability
    case 'PermissionError':
      return 'permission-denied:' + error.permission
    case 'UploadError':
      return 'upload-error:' + error.stage
  }
}
