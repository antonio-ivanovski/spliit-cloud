import { describe, expect, it, vi } from 'vitest'

import {
  bootstrapPageRuntime,
  disposePageRuntime,
  getPageRuntime,
} from './runtime'

// Authoring gate (test-audit): this file owns the page-lifetime contract —
// one runtime per document, starters run once, disposal releases listeners.
// Regression: a StrictMode/HMR double-bootstrap that re-ran starters would
// duplicate browser listeners and message ports; a dispose that skipped
// starter stops would leak them. No existing test covers the singleton
// lifecycle, and starters are injected through the production PageStarters
// parameter (no test-only seam).

function stubStarters() {
  return {
    initAppMode: vi.fn(() => vi.fn()),
    startPwaServices: vi.fn(() => vi.fn()),
  }
}

async function reset() {
  await disposePageRuntime()
}

describe('page runtime bootstrap', () => {
  it('creates one runtime and runs starters once across repeated bootstraps', async () => {
    try {
      const starters = stubStarters()
      const first = bootstrapPageRuntime(starters)
      const second = bootstrapPageRuntime(starters)
      expect(second).toBe(first)
      expect(getPageRuntime()).toBe(first)
      expect(starters.initAppMode).toHaveBeenCalledTimes(1)
      expect(starters.startPwaServices).toHaveBeenCalledTimes(1)
    } finally {
      await reset()
    }
  })

  it('releases starter stops and the runtime scope on disposal', async () => {
    const starters = stubStarters()
    bootstrapPageRuntime(starters)
    const stopAppMode = starters.initAppMode.mock.results[0]?.value as
      | (() => void)
      | undefined
    const stopPwa = starters.startPwaServices.mock.results[0]?.value as
      | (() => void)
      | undefined
    await disposePageRuntime()
    // Ordinary disposal releases every starter-owned listener/port.
    expect(stopAppMode).toHaveBeenCalledTimes(1)
    expect(stopPwa).toHaveBeenCalledTimes(1)
    // A fresh bootstrap after disposal rebuilds exactly once.
    const rebuilt = stubStarters()
    bootstrapPageRuntime(rebuilt)
    try {
      expect(rebuilt.initAppMode).toHaveBeenCalledTimes(1)
    } finally {
      await reset()
    }
  })
})
