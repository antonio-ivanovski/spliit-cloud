import { afterEach, describe, expect, it, vi } from 'vitest'

import { isAndroidApp } from './android-app'

describe('Android presentation context', () => {
  afterEach(() => {
    window.sessionStorage.clear()
    window.history.replaceState(null, '', '/')
    vi.restoreAllMocks()
  })

  it('survives redirects and SPA navigation within the launched session', () => {
    expect(isAndroidApp()).toBe(false)
    window.history.replaceState(null, '', '/groups?android-app=1')
    expect(isAndroidApp()).toBe(true)
    window.history.replaceState(null, '', '/sponsor')
    expect(isAndroidApp()).toBe(true)
    window.sessionStorage.clear()
    expect(isAndroidApp()).toBe(false)
  })

  it('still identifies launch when storage is unavailable', () => {
    window.history.replaceState(null, '', '/?android-app=1')
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Storage blocked')
    })
    expect(isAndroidApp()).toBe(true)
  })
})
