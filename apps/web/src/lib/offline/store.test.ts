import { describe, expect, it, vi } from 'vitest'

import { OFFLINE_STORAGE_BLOCKED_MESSAGE } from './contract'
import type { OfflineRepository } from './repository'
import { createOfflineStore } from './store'

function fakeRepo(): OfflineRepository {
  return { close: vi.fn() } as unknown as OfflineRepository
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

describe('offline store opening', () => {
  it('publishes available on successful open', async () => {
    const repo = fakeRepo()
    const store = createOfflineStore({
      openTimeoutMs: 10,
      openRepository: async () => repo,
    })
    expect(store.getSnapshot().status).toBe('opening')
    await store.open()
    expect(store.getSnapshot().status).toBe('available')
    expect(store.getRepository()).toBe(repo)
    store.close()
  })

  it('stops blocking after the timeout but accepts eventual success', async () => {
    let resolveOpen!: (repo: OfflineRepository) => void
    const repo = fakeRepo()
    const store = createOfflineStore({
      openTimeoutMs: 10,
      openRepository: () =>
        new Promise<OfflineRepository>((resolve) => {
          resolveOpen = resolve
        }),
    })
    void store.open()
    await sleep(30)
    // Blocking spinner removed; retry hook exposed via `retry()`.
    expect(store.getSnapshot().status).toBe('unavailable')
    expect(store.getRepository()).toBeNull()

    resolveOpen(repo)
    await sleep(10)
    expect(store.getSnapshot().status).toBe('available')
    expect(store.getRepository()).toBe(repo)
    store.close()
  })

  it('ignores stale late results after cancellation', async () => {
    let resolveOpen!: (repo: OfflineRepository) => void
    const stale = fakeRepo()
    const fresh = fakeRepo()
    let calls = 0
    const store = createOfflineStore({
      openTimeoutMs: 1000,
      openRepository: () => {
        calls += 1
        if (calls === 1) {
          return new Promise<OfflineRepository>((resolve) => {
            resolveOpen = resolve
          })
        }
        return Promise.resolve(fresh)
      },
    })
    void store.open()
    await sleep(5)
    store.cancel()
    resolveOpen(stale)
    await sleep(10)
    // Stale connection closed and ignored, never published.
    expect(stale.close).toHaveBeenCalled()
    expect(store.getRepository()).toBeNull()

    await store.retry()
    expect(store.getSnapshot().status).toBe('available')
    expect(store.getRepository()).toBe(fresh)
    store.close()
  })

  it('reports blocked with the multi-tab message', async () => {
    const store = createOfflineStore({
      openTimeoutMs: 1000,
      openRepository: async ({ onBlocked }) => {
        onBlocked()
        return fakeRepo()
      },
    })
    await store.open()
    // The blocked open still resolves (upgrade proceeds once other tabs
    // close); the message stays until then. Never auto-reload or wipe.
    expect(store.getSnapshot().status).toBe('available')
    store.close()

    const blockedStore = createOfflineStore({
      openTimeoutMs: 1000,
      openRepository: async ({ onBlocked }) => {
        onBlocked()
        return new Promise<OfflineRepository>(() => {})
      },
    })
    void blockedStore.open()
    await sleep(5)
    expect(blockedStore.getSnapshot().status).toBe('blocked')
    expect(blockedStore.getSnapshot().blockedMessage).toBe(
      OFFLINE_STORAGE_BLOCKED_MESSAGE,
    )
    blockedStore.close()
  })

  it('maps quota errors to quota-error status', async () => {
    const quota = new DOMException('Quota exceeded', 'QuotaExceededError')
    const store = createOfflineStore({
      openRepository: async () => {
        throw quota
      },
    })
    await store.open()
    expect(store.getSnapshot().status).toBe('quota-error')
    store.close()
  })

  it('notifies on versionchange close', async () => {
    const onStorageClose = vi.fn()
    const store = createOfflineStore({
      onStorageClose,
      openRepository: async ({ onVersionChange }) => {
        onVersionChange()
        return fakeRepo()
      },
    })
    await store.open()
    expect(onStorageClose).toHaveBeenCalled()
    store.close()
  })

  it('close sets terminal unavailable and clears the repository', async () => {
    const repo = fakeRepo()
    const store = createOfflineStore({
      openTimeoutMs: 10,
      openRepository: async () => repo,
    })
    await store.open()
    expect(store.getSnapshot().status).toBe('available')
    expect(store.getRepository()).toBe(repo)
    store.close()
    expect(store.getSnapshot().status).not.toBe('available')
    expect(store.getSnapshot().status).toBe('unavailable')
    expect(store.getRepository()).toBeNull()
  })

  it('cancel transitions out of opening', async () => {
    const store = createOfflineStore({
      openTimeoutMs: 1000,
      openRepository: () => new Promise<OfflineRepository>(() => {}),
    })
    void store.open()
    await sleep(5)
    expect(store.getSnapshot().status).toBe('opening')
    store.cancel()
    expect(store.getSnapshot().status).not.toBe('opening')
    expect(store.getSnapshot().status).toBe('unavailable')
    expect(store.getSnapshot().errorCode).toBe('storage-unavailable')
    expect(store.getRepository()).toBeNull()
    store.close()
  })

  it('retains the old repository until the new open succeeds', async () => {
    const first = fakeRepo()
    const second = fakeRepo()
    let resolveSecond!: (repo: OfflineRepository) => void
    let calls = 0
    const store = createOfflineStore({
      openTimeoutMs: 1000,
      openRepository: () => {
        calls += 1
        if (calls === 1) return Promise.resolve(first)
        return new Promise<OfflineRepository>((resolve) => {
          resolveSecond = resolve
        })
      },
    })
    await store.open()
    expect(store.getRepository()).toBe(first)

    void store.open()
    await sleep(5)
    // Slow retry is pending: old connection must not be closed yet.
    expect(first.close).not.toHaveBeenCalled()
    expect(store.getRepository()).toBeNull()

    resolveSecond(second)
    await sleep(10)
    expect(store.getSnapshot().status).toBe('available')
    expect(store.getRepository()).toBe(second)
    expect(first.close).toHaveBeenCalled()
    store.close()
  })
})
