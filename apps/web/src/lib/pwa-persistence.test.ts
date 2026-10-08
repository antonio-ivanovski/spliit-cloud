import { describe, expect, it, vi } from 'vitest'

import {
  PWA_PERSIST_ATTEMPT_KEY,
  ensurePersistentStorageOnce,
  isPersistenceWorthRequesting,
} from './pwa-persistence'

const CHROME = {
  userAgent:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
  brands: [{ brand: 'Chromium' }, { brand: 'Google Chrome' }],
}

describe('persistent storage request', () => {
  it('approves recognized Chromium engines silently, skips the rest', () => {
    expect(isPersistenceWorthRequesting(CHROME)).toBe(true)
    expect(
      isPersistenceWorthRequesting({
        userAgent: CHROME.userAgent,
        brands: [{ brand: 'Microsoft Edge' }],
      }),
    ).toBe(true)
    expect(
      isPersistenceWorthRequesting({
        userAgent:
          'Mozilla/5.0 (Macintosh; rv:126.0) Gecko/20100101 Firefox/126.0',
      }),
    ).toBe(false)
    expect(
      isPersistenceWorthRequesting({
        userAgent:
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
      }),
    ).toBe(false)
    expect(isPersistenceWorthRequesting({})).toBe(false)
    expect(isPersistenceWorthRequesting({ userAgent: '' })).toBe(false)
  })

  it('requests once, then reports already without re-prompting', async () => {
    const store = new Map<string, string>()
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value)
      },
    }
    const persist = vi.fn().mockResolvedValue(true)
    const deps = {
      environment: CHROME,
      storage,
      navigatorRef: { storage: { persist } },
    }
    await expect(ensurePersistentStorageOnce(deps)).resolves.toBe('persisted')
    expect(persist).toHaveBeenCalledOnce()
    expect(store.get(PWA_PERSIST_ATTEMPT_KEY)).toBe('1')
    await expect(ensurePersistentStorageOnce(deps)).resolves.toBe('already')
    expect(persist).toHaveBeenCalledOnce()
  })

  it('skips, degrades, and never throws', async () => {
    const storage = {
      getItem: () => null,
      setItem: vi.fn(),
    }
    await expect(
      ensurePersistentStorageOnce({
        environment: { userAgent: 'Firefox/126.0' },
        storage,
      }),
    ).resolves.toBe('skipped')
    await expect(
      ensurePersistentStorageOnce({
        environment: CHROME,
        storage,
        navigatorRef: {},
      }),
    ).resolves.toBe('unsupported')
    await expect(
      ensurePersistentStorageOnce({
        environment: CHROME,
        storage,
        navigatorRef: {
          storage: { persist: () => Promise.reject(new Error('denied')) },
        },
      }),
    ).resolves.toBe('declined')
    await expect(
      ensurePersistentStorageOnce({
        environment: CHROME,
        storage: {
          getItem: () => {
            throw new Error('private mode')
          },
          setItem: () => {
            throw new Error('private mode')
          },
        },
        navigatorRef: { storage: { persist: async () => false } },
      }),
    ).resolves.toBe('declined')
  })

  it('requests when no storage is provided instead of reporting already', async () => {
    // Regression: `deps.storage?.getItem(...) !== null` evaluated
    // `undefined !== null` as true, so callers without storage (SSR, tests,
    // default wiring) silently got 'already' and never probed persist().
    const persist = vi.fn().mockResolvedValue(true)
    await expect(
      ensurePersistentStorageOnce({
        environment: CHROME,
        storage: undefined,
        navigatorRef: { storage: { persist } },
      }),
    ).resolves.toBe('persisted')
    expect(persist).toHaveBeenCalledOnce()
  })
})
