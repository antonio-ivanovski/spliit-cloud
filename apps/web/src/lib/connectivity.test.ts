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
    await expect(trackedFetch('/auth/get-session')).rejects.toThrow(
      /Failed to fetch/,
    )
    expect(hasFetchNetworkFailure()).toBe(true)
    globalThis.fetch = original
  })
})
