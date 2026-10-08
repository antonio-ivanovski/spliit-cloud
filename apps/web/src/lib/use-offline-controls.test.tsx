import { afterEach, describe, expect, it } from 'vitest'

import {
  reportNetworkFailure,
  resetConnectivityForTests,
} from '@/lib/connectivity'
import {
  useConnectionRequired,
  useOfflineQueryEnabled,
  useRemoteControlState,
} from '@/lib/use-offline-controls'
import { act, renderHook } from '@/test/test-utils'

describe('useRemoteControlState', () => {
  afterEach(() => {
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: true,
    })
    resetConnectivityForTests()
  })

  it('is enabled by default', () => {
    const { result } = renderHook(() => useRemoteControlState())
    expect(result.current).toEqual({
      disabled: false,
      reason: null,
      offline: false,
    })
  })

  it('disables with offline reason when the browser is offline', () => {
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: false,
    })
    const { result } = renderHook(() =>
      useRemoteControlState({ ready: true, busy: false }),
    )
    expect(result.current.disabled).toBe(true)
    expect(result.current.reason).toBe('offline')
    expect(result.current.offline).toBe(true)
  })

  it('disables when the transport is unreachable even if the browser claims online', () => {
    const { result } = renderHook(() => useRemoteControlState())
    act(() => {
      reportNetworkFailure(new TypeError('Failed to fetch'))
    })
    expect(result.current.disabled).toBe(true)
    expect(result.current.reason).toBe('offline')
  })

  it('disables with busy reason when not ready', () => {
    const { result } = renderHook(() => useRemoteControlState({ ready: false }))
    expect(result.current).toEqual({
      disabled: true,
      reason: 'busy',
      offline: false,
    })
  })

  it('disables with busy reason while saving', () => {
    const { result } = renderHook(() => useRemoteControlState({ busy: true }))
    expect(result.current.disabled).toBe(true)
    expect(result.current.reason).toBe('busy')
  })

  it('folds an extra condition into disabled', () => {
    const { result } = renderHook(() =>
      useRemoteControlState({ extraDisabled: true }),
    )
    expect(result.current.disabled).toBe(true)
    expect(result.current.reason).toBe('busy')
  })

  it('prefers the offline reason when both offline and busy', () => {
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: false,
    })
    const { result } = renderHook(() =>
      useRemoteControlState({ ready: false, busy: true }),
    )
    expect(result.current.reason).toBe('offline')
  })
})

describe('useOfflineQueryEnabled', () => {
  afterEach(() => {
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: true,
    })
    resetConnectivityForTests()
  })

  it('is enabled by default', () => {
    const { result } = renderHook(() => useOfflineQueryEnabled())
    expect(result.current).toBe(true)
  })

  it('is disabled offline', () => {
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: false,
    })
    const { result } = renderHook(() => useOfflineQueryEnabled())
    expect(result.current).toBe(false)
  })

  it('folds an extra condition', () => {
    const { result } = renderHook(() => useOfflineQueryEnabled(false))
    expect(result.current).toBe(false)
  })
})

describe('useConnectionRequired', () => {
  afterEach(() => {
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: true,
    })
    resetConnectivityForTests()
  })

  it('requires connection when offline without data', () => {
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: false,
    })
    const { result } = renderHook(() => useConnectionRequired(false))
    expect(result.current).toBe(true)
  })

  it('does not require connection when data is present', () => {
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: false,
    })
    const { result } = renderHook(() => useConnectionRequired(true))
    expect(result.current).toBe(false)
  })

  it('does not require connection while online', () => {
    const { result } = renderHook(() => useConnectionRequired(false))
    expect(result.current).toBe(false)
  })
})
