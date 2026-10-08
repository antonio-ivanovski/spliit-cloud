import { describe, expect, it } from 'vitest'

import {
  OfflineFencingFailure,
  OfflineQuotaFailure,
  OfflineSchemaFailure,
  OfflineStorageError,
  OfflineStorageFailure,
  isOfflineSyncFailure,
  isQuotaError,
  toOfflineSyncFailure,
  type OfflineErrorCode,
  type OfflineSyncFailure,
} from './errors'
import {
  classifySyncError,
  toPersistedCode,
  type SyncErrorClassification,
} from './sync'

// Authoring gate (test-audit): this file owns the Phase 2 typed error
// channel — the toPersistedCode mapping table (same persisted codes for same
// inputs, locked against drift), tag dispatch for classifySyncError, the
// repository-boundary normalizer, and quota-probe parity. Pass orchestration,
// retry counts, and phase transitions stay owned by sync.test.ts; the Effect
// driver stays owned by offline-downloads.test.ts.

const NOW = 1_700_000_000_000

type PersistedCode = ReturnType<typeof toPersistedCode>

describe('toPersistedCode mapping table', () => {
  it('records identical persisted codes for identical classifications', () => {
    const cases: Array<[SyncErrorClassification, PersistedCode]> = [
      [{ kind: 'cancelled' }, 'storage-unavailable'],
      [{ kind: 'revision' }, 'storage-unavailable'],
      [{ kind: 'lease' }, 'storage-unavailable'],
      [{ kind: 'disabled' }, 'storage-unavailable'],
      [{ kind: 'quota' }, 'quota-exceeded'],
      [{ kind: 'schema', code: 'invalid-payload' }, 'invalid-payload'],
      [{ kind: 'schema', code: 'storage-blocked' }, 'storage-blocked'],
      [{ kind: 'schema', code: 'storage-unavailable' }, 'storage-unavailable'],
      [{ kind: 'schema', code: 'schema-unsupported' }, 'schema-unsupported'],
      [{ kind: 'schema', code: 'corrupt-record' }, 'schema-unsupported'],
      [{ kind: 'schema', code: 'BAD_REQUEST' }, 'schema-unsupported'],
      [{ kind: 'schema', code: 'http-500' }, 'schema-unsupported'],
      [{ kind: 'auth' }, 'storage-unavailable'],
      [{ kind: 'access', code: 'FORBIDDEN' }, 'storage-unavailable'],
      [{ kind: 'access', code: 'http-404' }, 'storage-unavailable'],
      [{ kind: 'rate-limited', delayMs: 5_000 }, 'storage-unavailable'],
      [{ kind: 'connectivity' }, 'storage-unavailable'],
      [{ kind: 'transient', code: 'timeout' }, 'storage-unavailable'],
      [{ kind: 'transient', code: 'http-503' }, 'storage-unavailable'],
    ]
    for (const [classification, expected] of cases) {
      expect(toPersistedCode(classification)).toBe(expected)
    }
  })
})

describe('classifySyncError tag dispatch', () => {
  it('classifies every tagged failure identically to its storage-code twin', () => {
    const twins: Array<[OfflineErrorCode, OfflineSyncFailure]> = [
      [
        'storage-unavailable',
        new OfflineStorageFailure({ code: 'storage-unavailable' }),
      ],
      [
        'storage-blocked',
        new OfflineStorageFailure({ code: 'storage-blocked' }),
      ],
      ['quota-exceeded', new OfflineQuotaFailure({ code: 'quota-exceeded' })],
      [
        'schema-unsupported',
        new OfflineSchemaFailure({ code: 'schema-unsupported' }),
      ],
      ['corrupt-record', new OfflineSchemaFailure({ code: 'corrupt-record' })],
      [
        'invalid-payload',
        new OfflineSchemaFailure({ code: 'invalid-payload' }),
      ],
      [
        'generation-mismatch',
        new OfflineFencingFailure({ code: 'generation-mismatch' }),
      ],
      [
        'namespace-revoked',
        new OfflineFencingFailure({ code: 'namespace-revoked' }),
      ],
      [
        'revision-changed',
        new OfflineFencingFailure({ code: 'revision-changed' }),
      ],
      ['lease-conflict', new OfflineFencingFailure({ code: 'lease-conflict' })],
    ]
    for (const [code, tagged] of twins) {
      expect(classifySyncError(tagged, NOW)).toEqual(
        classifySyncError(new OfflineStorageError(code, code), NOW),
      )
    }
  })

  it('maps fencing codes to disabled/revision/lease and the rest by channel', () => {
    const cases: Array<[OfflineSyncFailure, SyncErrorClassification]> = [
      [
        new OfflineFencingFailure({ code: 'generation-mismatch' }),
        { kind: 'disabled' },
      ],
      [
        new OfflineFencingFailure({ code: 'namespace-revoked' }),
        { kind: 'disabled' },
      ],
      [
        new OfflineFencingFailure({ code: 'revision-changed' }),
        { kind: 'revision' },
      ],
      [
        new OfflineFencingFailure({ code: 'lease-conflict' }),
        { kind: 'lease' },
      ],
      [new OfflineQuotaFailure({ code: 'quota-exceeded' }), { kind: 'quota' }],
      [
        new OfflineStorageFailure({ code: 'storage-unavailable' }),
        { kind: 'schema', code: 'storage-unavailable' },
      ],
      [
        new OfflineStorageFailure({ code: 'storage-blocked' }),
        { kind: 'schema', code: 'storage-blocked' },
      ],
      [
        new OfflineSchemaFailure({ code: 'invalid-payload' }),
        { kind: 'schema', code: 'invalid-payload' },
      ],
    ]
    for (const [failure, expected] of cases) {
      expect(classifySyncError(failure, NOW)).toEqual(expected)
    }
  })

  it('keeps non-storage errors on the legacy probes', () => {
    // Timeouts stay transient (one auto retry); aborts stay lifecycle
    // cancellation; neither enters the typed storage channel.
    expect(
      classifySyncError(
        new DOMException('Snapshot timeout', 'TimeoutError'),
        NOW,
      ),
    ).toEqual({ kind: 'transient', code: 'timeout' })
    expect(
      classifySyncError(new DOMException('Aborted', 'AbortError'), NOW),
    ).toEqual({ kind: 'cancelled' })
    expect(classifySyncError({ data: { code: 'UNAUTHORIZED' } }, NOW)).toEqual({
      kind: 'auth',
    })
  })
})

describe('toOfflineSyncFailure boundary normalizer', () => {
  it('passes tagged failures through untouched', () => {
    const failure = new OfflineQuotaFailure({ code: 'quota-exceeded' })
    expect(toOfflineSyncFailure(failure)).toBe(failure)
  })

  it('maps every storage code to its channel class', () => {
    const cases: Array<[OfflineErrorCode, OfflineSyncFailure['_tag']]> = [
      ['storage-unavailable', 'OfflineStorageFailure'],
      ['storage-blocked', 'OfflineStorageFailure'],
      ['quota-exceeded', 'OfflineQuotaFailure'],
      ['schema-unsupported', 'OfflineSchemaFailure'],
      ['corrupt-record', 'OfflineSchemaFailure'],
      ['invalid-payload', 'OfflineSchemaFailure'],
      ['generation-mismatch', 'OfflineFencingFailure'],
      ['namespace-revoked', 'OfflineFencingFailure'],
      ['revision-changed', 'OfflineFencingFailure'],
      ['lease-conflict', 'OfflineFencingFailure'],
    ]
    for (const [code, expectedTag] of cases) {
      expect(
        toOfflineSyncFailure(new OfflineStorageError(code, code))?._tag,
      ).toBe(expectedTag)
    }
  })

  it('keeps a storage error ahead of a nested quota cause', () => {
    // A storage-unavailable wrapper around a quota-shaped cause keeps its own
    // code, matching the legacy branch order (storage first, quota second).
    const wrapped = new OfflineStorageError(
      'storage-unavailable',
      'storage-unavailable',
      { cause: { name: 'QuotaExceededError' } },
    )
    expect(toOfflineSyncFailure(wrapped)).toEqual(
      new OfflineStorageFailure({ code: 'storage-unavailable' }),
    )
  })

  it('maps raw quota-like failures without a storage wrapper', () => {
    expect(toOfflineSyncFailure({ name: 'QuotaExceededError' })).toEqual(
      new OfflineQuotaFailure({ code: 'quota-exceeded' }),
    )
    expect(toOfflineSyncFailure({ cause: { inner: { code: 22 } } })).toEqual(
      new OfflineQuotaFailure({ code: 'quota-exceeded' }),
    )
  })

  it('returns null for non-storage failures', () => {
    expect(toOfflineSyncFailure(new TypeError('Load failed'))).toBeNull()
    expect(
      toOfflineSyncFailure(new DOMException('Aborted', 'AbortError')),
    ).toBeNull()
    expect(toOfflineSyncFailure({ data: { code: 'UNAUTHORIZED' } })).toBeNull()
    expect(toOfflineSyncFailure(null)).toBeNull()
    expect(toOfflineSyncFailure(undefined)).toBeNull()
  })

  it('recognizes only the four channel tags', () => {
    expect(
      isOfflineSyncFailure(new OfflineQuotaFailure({ code: 'quota-exceeded' })),
    ).toBe(true)
    expect(
      isOfflineSyncFailure(new OfflineStorageError('quota-exceeded')),
    ).toBe(false)
    expect(isOfflineSyncFailure({ _tag: 'OfflineQuotaFailure' })).toBe(true)
    expect(isOfflineSyncFailure({ _tag: 'NetworkError' })).toBe(false)
    expect(isOfflineSyncFailure(null)).toBe(false)
  })
})

describe('isQuotaError parity', () => {
  it('matches name, legacy code, and message probes', () => {
    expect(isQuotaError({ name: 'QuotaExceededError' })).toBe(true)
    expect(isQuotaError({ code: 22 })).toBe(true)
    expect(isQuotaError(new Error('Quota exceeded on write'))).toBe(true)
    expect(isQuotaError(new TypeError('Load failed'))).toBe(false)
    expect(isQuotaError(null)).toBe(false)
    expect(isQuotaError(undefined)).toBe(false)
    expect(isQuotaError('quota exceeded')).toBe(false)
    expect(isQuotaError([])).toBe(false)
  })

  it('walks cause/inner nesting up to the depth bound', () => {
    expect(isQuotaError({ cause: { name: 'QuotaExceededError' } })).toBe(true)
    expect(isQuotaError({ inner: { code: 22 } })).toBe(true)
    expect(isQuotaError({ cause: { cause: { inner: { code: 22 } } } })).toBe(
      true,
    )
    // Four nestings exceed the bound (levels 1-4 checked only through 3).
    expect(
      isQuotaError({
        cause: { cause: { cause: { cause: { name: 'QuotaExceededError' } } } },
      }),
    ).toBe(false)
    // Cyclic wrappers terminate instead of recursing forever.
    const cyclic: { cause?: unknown } = {}
    cyclic.cause = cyclic
    expect(isQuotaError(cyclic)).toBe(false)
  })
})
