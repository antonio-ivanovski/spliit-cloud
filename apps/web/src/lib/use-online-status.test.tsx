import { afterEach, describe, expect, it } from 'vitest'

import {
  reportNetworkFailure,
  resetConnectivityForTests,
} from '@/lib/connectivity'
import {
  useConnectivityStatus,
  useOfflineWithoutData,
  useOnlineStatus,
  useServerUnreachableWithoutData,
} from '@/lib/use-online-status'
import { act, renderHook } from '@/test/test-utils'

describe('useConnectivityStatus', () => {
  afterEach(() => {
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: true,
    })
    resetConnectivityForTests()
  })

  it('is online by default', () => {
    const { result } = renderHook(() => useConnectivityStatus())
    expect(result.current).toBe('online')
  })

  it('is offline when the browser is offline, even with a fetch failure', () => {
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: false,
    })
    const { result } = renderHook(() => ({
      status: useConnectivityStatus(),
      online: useOnlineStatus(),
      offlineEmpty: useOfflineWithoutData(false),
      serverEmpty: useServerUnreachableWithoutData(false),
    }))
    expect(result.current.status).toBe('offline')
    expect(result.current.online).toBe(false)
    expect(result.current.offlineEmpty).toBe(true)
    expect(result.current.serverEmpty).toBe(false)
  })

  it('is server-unreachable when the API fails while the browser is online', () => {
    const { result } = renderHook(() => ({
      status: useConnectivityStatus(),
      online: useOnlineStatus(),
      offlineEmpty: useOfflineWithoutData(false),
      serverEmpty: useServerUnreachableWithoutData(false),
    }))

    act(() => {
      reportNetworkFailure(new TypeError('Failed to fetch'))
    })

    expect(result.current.status).toBe('server-unreachable')
    expect(result.current.online).toBe(false)
    // Must never claim the user is offline when they are not.
    expect(result.current.offlineEmpty).toBe(false)
    expect(result.current.serverEmpty).toBe(true)
  })

  it('shows no empty state when data is present', () => {
    const { result } = renderHook(() => ({
      offlineEmpty: useOfflineWithoutData(true),
      serverEmpty: useServerUnreachableWithoutData(true),
    }))

    act(() => {
      reportNetworkFailure(new TypeError('Failed to fetch'))
    })

    expect(result.current.offlineEmpty).toBe(false)
    expect(result.current.serverEmpty).toBe(false)
  })

  it('recovers to online on the next success', () => {
    const { result } = renderHook(() => useConnectivityStatus())

    act(() => {
      reportNetworkFailure(new TypeError('Failed to fetch'))
    })
    expect(result.current).toBe('server-unreachable')

    act(() => {
      resetConnectivityForTests()
    })
    expect(result.current).toBe('online')
  })
})
