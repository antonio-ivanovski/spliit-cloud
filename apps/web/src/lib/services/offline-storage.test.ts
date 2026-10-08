import 'fake-indexeddb/auto'
import { Cause, Context, Effect, Exit, Fiber, Layer } from 'effect'
import { describe, expect, it } from 'vitest'

import { buildNamespace } from '@/lib/offline/contract'
import {
  OfflineStorageError,
  type OfflineErrorCode,
} from '@/lib/offline/errors'
import {
  OfflineRepository,
  type OfflineRepositoryOpenOptions,
} from '@/lib/offline/repository'

import type {
  StorageCorruptError,
  StorageUnavailableError,
  StaleGenerationError,
} from './errors'
import {
  OfflineStorage,
  makeOfflineStorage,
  makeOfflineStorageLive,
  mapStorageError,
} from './offline-storage'

// Authoring gate (test-audit): this file owns the Effect storage boundary —
// every OfflineStorageError code maps to exactly one service tag, aborts
// stay in the interruption channel, opens single-flight, and delegation
// preserves the repository failure policy (quota stops writes, fences hold).
// Regression: a mis-mapped code would drive the wrong recovery (quota shown
// as unavailable invites an eviction loop; generation-mismatch shown as
// unavailable renders stale-account data); a stampeding open would hammer
// IndexedDB once per caller. Rollback/atomicity of the Dexie transactions
// themselves is owned by repository.test.ts; this file owns the wrapper
// around them. The stub openRepository is the production
// OfflineStorageOpenDeps parameter.

const API_ORIGIN = 'http://localhost:3001'
const ACCOUNT = 'storage-service-test'
const namespace = buildNamespace(API_ORIGIN, ACCOUNT)

function storageError(code: OfflineErrorCode): OfflineStorageError {
  return new OfflineStorageError(code, code, { namespace })
}

function stubRepository(
  overrides?: Partial<Record<string, (...args: never[]) => Promise<never>>>,
): OfflineRepository {
  const fail = (method: string) => () =>
    Promise.reject(new Error('unexpected call: ' + method))
  return {
    close: () => {},
    readControl: () => Promise.resolve(null),
    ensureControl: () =>
      Promise.resolve({
        namespace,
        generation: 0,
        dataRevision: 0,
        revoked: false,
        leaseOwner: null,
        leaseUntil: null,
      }),
    readCatalog: () => Promise.resolve({ status: 'missing' as const }),
    readGroupMeta: () => Promise.resolve({ status: 'missing' as const }),
    readGroupData: () => Promise.resolve({ status: 'missing' as const }),
    listGroupStatus: () => Promise.resolve([]),
    ...Object.fromEntries(
      Object.entries(overrides ?? {}).map(([key, fn]) => [
        key,
        fn ?? fail(key),
      ]),
    ),
  } as unknown as OfflineRepository
}

function countingOpener(repo: OfflineRepository) {
  let calls = 0
  const open = (_options?: OfflineRepositoryOpenOptions) => {
    calls += 1
    return Promise.resolve(repo)
  }
  return { open, calls: () => calls }
}

describe('storage error mapping', () => {
  it('maps every persisted code to its service tag', () => {
    expect(
      mapStorageError(storageError('quota-exceeded'), { namespace })._tag,
    ).toBe('StorageQuotaError')
    expect(
      mapStorageError(storageError('schema-unsupported'), { namespace })._tag,
    ).toBe('StorageSchemaError')
    for (const code of ['corrupt-record', 'invalid-payload'] as const) {
      const mapped = mapStorageError(storageError(code), { namespace })
      expect(mapped._tag).toBe('StorageCorruptError')
      expect((mapped as StorageCorruptError).reason).toBe(code)
    }
    for (const code of ['generation-mismatch', 'namespace-revoked'] as const) {
      const mapped = mapStorageError(storageError(code), { namespace })
      expect(mapped._tag).toBe('StaleGenerationError')
      expect((mapped as StaleGenerationError).namespace).toBe(namespace)
    }
    expect(
      mapStorageError(storageError('revision-changed'), { namespace })._tag,
    ).toBe('StaleRevisionError')
    expect(
      mapStorageError(storageError('lease-conflict'), { namespace })._tag,
    ).toBe('StaleLeaseError')
    expect(
      mapStorageError(storageError('storage-blocked'), { namespace })._tag,
    ).toBe('StorageBlockedError')
    expect(
      mapStorageError(storageError('storage-unavailable'), { namespace })._tag,
    ).toBe('StorageUnavailableError')
  })

  it('normalizes unknown and quota-shaped failures once', () => {
    const unknown = mapStorageError(new Error('boom'))
    expect(unknown._tag).toBe('StorageUnavailableError')
    expect((unknown as StorageUnavailableError).reason).toBe('unknown')
    const quotaName = Object.assign(new Error('QuotaExceededError'), {
      name: 'QuotaExceededError',
    })
    expect(mapStorageError(quotaName)._tag).toBe('StorageQuotaError')
    const nested = new Error('dexie put failed', { cause: quotaName })
    expect(mapStorageError(nested)._tag).toBe('StorageQuotaError')
  })
})

describe('storage lifecycle', () => {
  it('opens once and shares concurrent opens', async () => {
    const opener = countingOpener(stubRepository())
    const storage = makeOfflineStorage({ openRepository: opener.open })
    await Effect.runPromise(
      Effect.gen(function* () {
        const first = yield* Effect.forkChild(storage.open)
        const second = yield* Effect.forkChild(storage.open)
        yield* Fiber.join(first)
        yield* Fiber.join(second)
      }),
    )
    expect(opener.calls()).toBe(1)
    expect(await Effect.runPromise(storage.isOpen)).toBe(true)
    await Effect.runPromise(storage.open)
    expect(opener.calls()).toBe(1)
    await Effect.runPromise(storage.close)
    expect(await Effect.runPromise(storage.isOpen)).toBe(false)
  })

  it('fails calls before open without touching IndexedDB', async () => {
    const opener = countingOpener(stubRepository())
    const storage = makeOfflineStorage({ openRepository: opener.open })
    const exit = await Effect.runPromiseExit(storage.readControl(namespace))
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      const failure = exit.cause
      expect(Cause.hasInterrupts(failure)).toBe(false)
    }
    const error = await Effect.runPromise(
      Effect.flip(storage.readControl(namespace)),
    )
    expect(error._tag).toBe('StorageUnavailableError')
    expect((error as StorageUnavailableError).reason).toBe('storage-not-open')
    expect(opener.calls()).toBe(0)
  })

  it('recovers from a blocked open with one controlled reopen', async () => {
    let calls = 0
    const repo = stubRepository()
    const storage = makeOfflineStorage({
      openRepository: () => {
        calls += 1
        return calls === 1
          ? Promise.reject(storageError('storage-blocked'))
          : Promise.resolve(repo)
      },
    })
    const blocked = await Effect.runPromise(Effect.flip(storage.open))
    expect(blocked._tag).toBe('StorageBlockedError')
    await Effect.runPromise(storage.reopenAfterBlock)
    expect(await Effect.runPromise(storage.isOpen)).toBe(true)
    expect(calls).toBe(2)
  })
})

describe('storage delegation', () => {
  it('delegates reads and maps fences to stale tags', async () => {
    const control = {
      namespace,
      generation: 0,
      dataRevision: 0,
      revoked: false,
      leaseOwner: null,
      leaseUntil: null,
    }
    const repo = stubRepository({
      readControl: (() => Promise.resolve(control)) as (
        ...args: never[]
      ) => Promise<never>,
      ensureControl: (() =>
        Promise.reject(storageError('generation-mismatch'))) as (
        ...args: never[]
      ) => Promise<never>,
    })
    const storage = makeOfflineStorage({
      openRepository: () => Promise.resolve(repo),
    })
    await Effect.runPromise(storage.open)
    expect(await Effect.runPromise(storage.readControl(namespace))).toEqual(
      control,
    )
    const fenced = await Effect.runPromise(
      Effect.flip(storage.ensureControl(namespace)),
    )
    expect(fenced._tag).toBe('StaleGenerationError')
    expect((fenced as StaleGenerationError).namespace).toBe(namespace)
  })

  it('keeps caller aborts in the interruption channel', async () => {
    const repo = stubRepository({
      readCatalog: (() =>
        Promise.reject(new DOMException('Aborted', 'AbortError'))) as (
        ...args: never[]
      ) => Promise<never>,
    })
    const storage = makeOfflineStorage({
      openRepository: () => Promise.resolve(repo),
    })
    await Effect.runPromise(storage.open)
    const exit = await Effect.runPromiseExit(storage.readCatalog(namespace))
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      expect(Cause.hasInterrupts(exit.cause)).toBe(true)
    }
  })

  it('round-trips a real Dexie database through the service', async () => {
    await OfflineRepository.deleteDatabaseForTests()
    const storage = makeOfflineStorage()
    try {
      await Effect.runPromise(storage.open)
      const created = await Effect.runPromise(storage.ensureControl(namespace))
      expect(created.generation).toBe(0)
      expect(created.revoked).toBe(false)
      expect(await Effect.runPromise(storage.readControl(namespace))).toEqual(
        created,
      )
      expect(await Effect.runPromise(storage.readCatalog(namespace))).toEqual({
        status: 'missing',
      })
    } finally {
      await Effect.runPromise(storage.close)
      await OfflineRepository.deleteDatabaseForTests()
    }
  })

  it('serves reads through the scoped live layer', async () => {
    const opener = countingOpener(stubRepository())
    const program = Effect.scoped(
      Effect.gen(function* () {
        const context = yield* Layer.build(
          makeOfflineStorageLive({ openRepository: opener.open }),
        )
        const storage = Context.get(context, OfflineStorage)
        expect(yield* storage.isOpen).toBe(true)
        expect(yield* storage.readControl(namespace)).toBe(null)
      }),
    )
    await Effect.runPromise(program)
    expect(opener.calls()).toBe(1)
  })
})
