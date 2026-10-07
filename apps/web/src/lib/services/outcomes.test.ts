import { describe, expect, it } from 'vitest'

import { toStatusErrorCode } from '@/lib/offline/errors'

import {
  GroupDeniedError,
  HttpError,
  NetworkError,
  PermissionError,
  RateLimitError,
  SessionRejectedError,
  StaleGenerationError,
  StaleLeaseError,
  StaleRevisionError,
  StorageBlockedError,
  StorageCorruptError,
  StorageQuotaError,
  StorageSchemaError,
  StorageUnavailableError,
  TimeoutError,
  UploadError,
  WorkerError,
} from './errors'
import {
  mapToConnectivityStatus,
  mapToPersistedCode,
  safeMessageForLog,
} from './outcomes'

// Authoring gate (test-audit): this file owns the UI-boundary mapping
// contract — typed errors become existing outcomes, and nothing raw (Cause,
// payloads, messages) reaches persistent status or logs. Regression: a
// storage failure persisting a raw server message would leak user content
// into IndexedDB status records; a transport failure mapped to null
// connectivity would hide offline UI. No other test covers this mapping
// layer; inputs are plain values, no seams.

describe('persisted status codes', () => {
  it('keeps specific codes for storage and fencing families', () => {
    expect(mapToPersistedCode(new StorageBlockedError())).toBe(
      'storage-blocked',
    )
    expect(
      mapToPersistedCode(new StorageUnavailableError({ reason: 'x' })),
    ).toBe('storage-unavailable')
    expect(mapToPersistedCode(new StorageQuotaError({}))).toBe('quota-exceeded')
    expect(
      mapToPersistedCode(new StorageSchemaError({ schemaVersion: 99 })),
    ).toBe('schema-unsupported')
    expect(
      mapToPersistedCode(new StorageCorruptError({ reason: 'bad-row' })),
    ).toBe('corrupt-record')
    expect(
      mapToPersistedCode(new StaleGenerationError({ namespace: 'ns' })),
    ).toBe('generation-mismatch')
    expect(mapToPersistedCode(new StaleRevisionError({}))).toBe(
      'revision-changed',
    )
    expect(mapToPersistedCode(new StaleLeaseError({}))).toBe('lease-conflict')
  })

  it('matches the legacy fallback for transport and unknown failures', () => {
    const network = new NetworkError({ reason: 'fetch-failed' })
    expect(mapToPersistedCode(network)).toBe(toStatusErrorCode(network))
    expect(mapToPersistedCode(network)).toBe('storage-unavailable')

    const raw = new Error('secret server payload')
    expect(mapToPersistedCode(raw)).toBe(toStatusErrorCode(raw))
    expect(
      mapToPersistedCode(
        new TimeoutError({ operation: 'fetch', timeoutMs: 1 }),
      ),
    ).toBe('storage-unavailable')
  })
})

describe('connectivity projection', () => {
  it('reports genuine transport loss as offline', () => {
    expect(mapToConnectivityStatus(new NetworkError({ reason: 'x' }))).toBe(
      'offline',
    )
    expect(
      mapToConnectivityStatus(
        new TimeoutError({ operation: 'fetch', timeoutMs: 1 }),
      ),
    ).toBe('offline')
  })

  it('never reports a server answer as offline', () => {
    expect(mapToConnectivityStatus(new HttpError({ status: 503 }))).toBe(
      'server-unreachable',
    )
    expect(
      mapToConnectivityStatus(
        new RateLimitError({ status: 429, retryAfterMs: 1 }),
      ),
    ).toBe('server-unreachable')
  })

  it('returns null for families with no connectivity signal', () => {
    expect(mapToConnectivityStatus(new StorageQuotaError({}))).toBeNull()
    expect(mapToConnectivityStatus(new SessionRejectedError({}))).toBeNull()
    expect(
      mapToConnectivityStatus(new GroupDeniedError({ groupId: 'g' })),
    ).toBeNull()
    expect(
      mapToConnectivityStatus(
        new WorkerError({ worker: 'query', reason: 'x' }),
      ),
    ).toBeNull()
    expect(mapToConnectivityStatus(new Error('raw'))).toBeNull()
  })

  it('does not report local worker/download timeouts as offline', () => {
    // Regression: any TimeoutError mapped to offline, so a slow Dexie query
    // read as network loss. Only transport (fetch) timeouts are offline.
    expect(
      mapToConnectivityStatus(
        new TimeoutError({ operation: 'offline-query', timeoutMs: 1 }),
      ),
    ).toBeNull()
    expect(
      mapToConnectivityStatus(
        new TimeoutError({ operation: 'offline-download', timeoutMs: 1 }),
      ),
    ).toBeNull()
  })
})

describe('log-safe messages', () => {
  it('describes failures with tags and safe scalars only', () => {
    expect(
      safeMessageForLog(new NetworkError({ reason: 'fetch-failed' })),
    ).toBe('network-unreachable')
    expect(safeMessageForLog(new HttpError({ status: 503 }))).toBe(
      'http-error:503',
    )
    expect(
      safeMessageForLog(new PermissionError({ permission: 'notifications' })),
    ).toBe('permission-denied:notifications')
    expect(
      safeMessageForLog(
        new UploadError({ stage: 'transfer', reason: 'reset' }),
      ),
    ).toBe('upload-error:transfer')
    expect(safeMessageForLog(new Error('secret-token-abc'))).toBe(
      'service-unavailable',
    )
  })

  it('never embeds failure details in the message', () => {
    const secret = 'secret-expense-title'
    const messages = [
      safeMessageForLog(new StorageCorruptError({ reason: secret })),
      safeMessageForLog(new StorageUnavailableError({ reason: secret })),
      safeMessageForLog(new Error(secret)),
    ]
    for (const message of messages) {
      expect(message).not.toContain(secret)
    }
  })
})
