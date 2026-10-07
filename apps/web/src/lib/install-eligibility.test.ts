import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  INSTALL_ELIGIBLE_KEY,
  clearInstallEligibility,
  isInstallEligible,
  markInstallEligible,
  subscribeInstallEligibility,
} from './install-eligibility'

function memoryStorage(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
  const data = new Map<string, string>()
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value)
    },
    removeItem: (key: string) => {
      data.delete(key)
    },
  }
}

describe('install eligibility', () => {
  beforeEach(() => {
    clearInstallEligibility(memoryStorage())
  })

  it('marks and reads eligibility per storage scope', () => {
    const storage = memoryStorage()
    expect(isInstallEligible(storage)).toBe(false)
    markInstallEligible(storage)
    expect(isInstallEligible(storage)).toBe(true)
    expect(storage.getItem(INSTALL_ELIGIBLE_KEY)).not.toBeNull()
    clearInstallEligibility(storage)
    expect(isInstallEligible(storage)).toBe(false)
  })

  it('notifies subscribers when eligibility is marked', () => {
    const listener = vi.fn()
    const stop = subscribeInstallEligibility(listener)
    markInstallEligible(memoryStorage())
    expect(listener).toHaveBeenCalledOnce()
    stop()
    markInstallEligible(memoryStorage())
    expect(listener).toHaveBeenCalledOnce()
  })

  it('never throws on restricted storage', () => {
    const broken = {
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {
        throw new Error('denied')
      },
      removeItem: () => {
        throw new Error('denied')
      },
    }
    expect(() => markInstallEligible(broken)).not.toThrow()
    expect(isInstallEligible(broken)).toBe(false)
    expect(() => clearInstallEligibility(broken)).not.toThrow()
  })
})
