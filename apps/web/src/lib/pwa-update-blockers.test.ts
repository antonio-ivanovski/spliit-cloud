import { describe, expect, it, vi } from 'vitest'

import {
  getPwaUpdateBlockerCount,
  getPwaUpdateBlockerReasons,
  hasPwaUpdateBlockers,
  isPwaUpdateProtectionInitialized,
  markPwaUpdateProtectionInitialized,
  registerPwaUpdateBlocker,
  resetPwaUpdateBlockersForTests,
  subscribePwaUpdateBlockers,
} from './pwa-update-blockers'

describe('pwa-update-blockers', () => {
  it('tracks every registration with one blocking rule', () => {
    resetPwaUpdateBlockersForTests()
    const listener = vi.fn()
    const unsubscribe = subscribePwaUpdateBlockers(listener)
    const unregisterA = registerPwaUpdateBlocker('expense-form')
    const unregisterB = registerPwaUpdateBlocker('upload')

    expect(hasPwaUpdateBlockers()).toBe(true)
    expect(getPwaUpdateBlockerCount()).toBe(2)
    expect(getPwaUpdateBlockerReasons()).toEqual(['expense-form', 'upload'])

    unregisterA()
    unregisterB()
    unregisterB()
    expect(hasPwaUpdateBlockers()).toBe(false)
    expect(listener).toHaveBeenCalledTimes(4)
    unsubscribe()
  })

  it('marks protection ready and notifies the shared subscription', () => {
    resetPwaUpdateBlockersForTests()
    const listener = vi.fn()
    const unsubscribe = subscribePwaUpdateBlockers(listener)

    markPwaUpdateProtectionInitialized()
    markPwaUpdateProtectionInitialized()

    expect(isPwaUpdateProtectionInitialized()).toBe(true)
    expect(listener).toHaveBeenCalledOnce()
    unsubscribe()
  })
})
