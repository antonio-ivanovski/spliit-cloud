import { afterEach, describe, expect, it, vi } from 'vitest'

import { initPwaAppMode, isLaunchedAsApp } from './pwa-app-mode'

function mockMatchMedia(installed: boolean) {
  vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
    matches: query.includes('display-mode:') ? installed : false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(() => false),
  }))
}

describe('pwa-app-mode', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    delete document.documentElement.dataset.appMode
  })

  it('returns false for a regular browser tab', () => {
    mockMatchMedia(false)
    expect(isLaunchedAsApp()).toBe(false)
  })

  it('returns true when launched in standalone display mode', () => {
    mockMatchMedia(true)
    expect(isLaunchedAsApp()).toBe(true)
  })

  it('tags the document so PWA shell CSS can scope to installed launches', () => {
    mockMatchMedia(true)
    const cleanup = initPwaAppMode()
    expect(document.documentElement.dataset.appMode).toBe('pwa')
    cleanup()
    expect(document.documentElement.dataset.appMode).toBe('pwa')
  })

  it('tags regular tabs as browser', () => {
    mockMatchMedia(false)
    initPwaAppMode()
    expect(document.documentElement.dataset.appMode).toBe('browser')
  })
})
