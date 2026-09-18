import { afterEach, describe, expect, it } from 'vitest'

import {
  hasFetchNetworkFailure,
  reportNetworkFailure,
  reportNetworkSuccess,
  resetConnectivityForTests,
  trackedFetch,
} from '@/lib/connectivity'

describe('connectivity latch', () => {
  afterEach(() => {
    resetConnectivityForTests()
  })

  it('latches on a fetch TypeError and clears on success', async () => {
    expect(hasFetchNetworkFailure()).toBe(false)
    reportNetworkFailure(new TypeError('Failed to fetch'))
    expect(hasFetchNetworkFailure()).toBe(true)
    reportNetworkSuccess()
    expect(hasFetchNetworkFailure()).toBe(false)
  })

  it('ignores non-network errors', () => {
    reportNetworkFailure(new Error('UNAUTHORIZED'))
    expect(hasFetchNetworkFailure()).toBe(false)
  })

  it('trackedFetch reports failure when fetch throws', async () => {
    const original = globalThis.fetch
    globalThis.fetch = (async () => {
      throw new TypeError('Failed to fetch')
    }) as typeof fetch
    try {
      await expect(trackedFetch('/auth/get-session')).rejects.toThrow(
        /Failed to fetch/,
      )
      expect(hasFetchNetworkFailure()).toBe(true)
    } finally {
      globalThis.fetch = original
    }
  })

  it('trackedFetch treats HTTP 401 as reachable, not a server outage', async () => {
    const { getDefaultConnectivityStore } =
      await import('@/lib/offline/connectivity')
    const original = globalThis.fetch
    globalThis.fetch = (async () =>
      new Response('{}', {
        status: 401,
        headers: { 'content-type': 'application/json' },
      })) as typeof fetch
    try {
      const response = await trackedFetch('/trpc/push.getConfig')
      expect(response.status).toBe(401)
      expect(getDefaultConnectivityStore().getSnapshot().serverFailure).toBe(
        null,
      )
      expect(getDefaultConnectivityStore().isOnline()).toBe(true)
    } finally {
      globalThis.fetch = original
    }
  })

  it('trackedFetch records HTTP 503 as a server outage but clears on next success', async () => {
    const { getDefaultConnectivityStore } =
      await import('@/lib/offline/connectivity')
    const original = globalThis.fetch
    try {
      globalThis.fetch = (async () =>
        new Response('{}', {
          status: 503,
          headers: { 'content-type': 'application/json' },
        })) as typeof fetch
      await trackedFetch('/trpc/push.getConfig')
      expect(
        getDefaultConnectivityStore().getSnapshot().serverFailure,
      ).toMatchObject({ kind: 'http-error', status: 503 })

      globalThis.fetch = (async () =>
        new Response('{}', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })) as typeof fetch
      await trackedFetch('/trpc/push.getConfig')
      expect(getDefaultConnectivityStore().getSnapshot().serverFailure).toBe(
        null,
      )
    } finally {
      globalThis.fetch = original
    }
  })
})
