import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'

import { PWA_PERSIST_ATTEMPT_KEY } from '@/lib/pwa-persistence'

import { makePwaPersistence } from './pwa-persistence'

// Authoring gate (test-audit): this file owns the persistence service
// boundary — the request fires at most once per device, Firefox/unknown
// engines skip without probing, and denied/unsupported hosts resolve as
// data instead of failing. Regression: a retried persist() would re-prompt
// where the platform forbids it; a throwing host would break post-auth
// sequencing. Engine recognition stays owned by pwa-persistence.test.ts;
// this file owns once-semantics and infallibility around it. Memory stores
// are the production constructor parameters.

const CHROMIUM_BRANDS = {
  brands: [{ brand: 'Chromium', version: '126' }],
}

function memoryStore() {
  const data = new Map<string, string>()
  return {
    getItem: (key: string) =>
      data.has(key) ? (data.get(key) as string) : null,
    setItem: (key: string, value: string) => {
      data.set(key, value)
    },
  }
}

describe('persistence service', () => {
  it('requests once and reports already on repeat', async () => {
    const storage = memoryStore()
    let calls = 0
    const service = makePwaPersistence({
      environment: CHROMIUM_BRANDS,
      storage,
      navigatorRef: {
        storage: {
          persist: () => {
            calls += 1
            return Promise.resolve(true)
          },
        },
      },
    })
    expect(await Effect.runPromise(service.ensureOnce)).toBe('persisted')
    expect(await Effect.runPromise(service.ensureOnce)).toBe('already')
    expect(calls).toBe(1)
    expect(storage.getItem(PWA_PERSIST_ATTEMPT_KEY)).toBe('1')
    expect(await Effect.runPromise(service.snapshot)).toEqual({
      attempted: true,
      outcome: 'already',
    })
  })

  it('skips Firefox and unknown engines without probing', async () => {
    for (const environment of [
      { userAgent: 'Mozilla/5.0 Firefox/126.0' },
      {},
    ]) {
      let calls = 0
      const service = makePwaPersistence({
        environment,
        storage: memoryStore(),
        navigatorRef: {
          storage: {
            persist: () => {
              calls += 1
              return Promise.resolve(true)
            },
          },
        },
      })
      expect(await Effect.runPromise(service.ensureOnce)).toBe('skipped')
      expect(calls).toBe(0)
      expect(await Effect.runPromise(service.isWorthRequesting)).toBe(false)
    }
  })

  it('resolves declined/unsupported as data, never as failure', async () => {
    const declined = makePwaPersistence({
      environment: CHROMIUM_BRANDS,
      storage: memoryStore(),
      navigatorRef: { storage: { persist: () => Promise.resolve(false) } },
    })
    expect(await Effect.runPromise(declined.ensureOnce)).toBe('declined')

    const unsupported = makePwaPersistence({
      environment: CHROMIUM_BRANDS,
      storage: memoryStore(),
      navigatorRef: {},
    })
    expect(await Effect.runPromise(unsupported.ensureOnce)).toBe('unsupported')

    const throwing = makePwaPersistence({
      environment: CHROMIUM_BRANDS,
      storage: memoryStore(),
      navigatorRef: {
        storage: {
          persist: () => Promise.reject(new Error('host threw')),
        },
      },
    })
    expect(await Effect.runPromise(throwing.ensureOnce)).toBe('declined')
  })

  it('retries once after install via retryAfterInstall', async () => {
    const data = new Map<string, string>()
    const storage = {
      getItem: (key: string) =>
        data.has(key) ? (data.get(key) as string) : null,
      setItem: (key: string, value: string) => {
        data.set(key, value)
      },
      removeItem: (key: string) => {
        data.delete(key)
      },
    }
    let calls = 0
    const service = makePwaPersistence({
      environment: CHROMIUM_BRANDS,
      storage,
      navigatorRef: {
        storage: {
          persist: () => {
            calls += 1
            return Promise.resolve(calls > 1)
          },
        },
      },
    })
    expect(await Effect.runPromise(service.ensureOnce)).toBe('declined')
    expect(await Effect.runPromise(service.ensureOnce)).toBe('already')
    expect(await Effect.runPromise(service.retryAfterInstall)).toBe('persisted')
    expect(calls).toBe(2)
  })
})
