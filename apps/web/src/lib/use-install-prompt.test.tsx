import { act, renderHook } from '@testing-library/react'
import { Effect } from 'effect'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { markInstallEligible } from './install-eligibility'
import {
  makePwaInstallService,
  type PwaInstallService,
} from './services/pwa-install'
import {
  detectBrowserSupport,
  INSTALL_PROMPT_TIMING,
  isPromotionBlockedByWork,
  requestManualInstallOpen,
  shouldDeferPromotionForActivity,
  useInstallPrompt,
} from './use-install-prompt'

// Authoring gate (test-audit): this file owns the thin presentation binding
// (hook state/actions project the install SERVICE) plus the pure helpers that
// still live in the hook module. Capture/eligibility/suppression behavior is
// owned by services/pwa-install.test.ts against fresh service instances —
// this file injects those same instances, so no reset global exists.

const CHROME_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36'
const FIREFOX_DESKTOP_UA =
  'Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0'

function fakePromptEvent(
  outcome: 'accepted' | 'dismissed' = 'accepted',
  prompt?: () => Promise<void>,
) {
  return Object.assign(new Event('beforeinstallprompt'), {
    preventDefault: () => {},
    prompt: prompt ?? (() => Promise.resolve()),
    userChoice: Promise.resolve({ outcome }),
  })
}

function makeService(
  target: EventTarget,
  userAgent: string = CHROME_UA,
): PwaInstallService {
  const service = makePwaInstallService({
    userAgent,
    maxTouchPoints: 0,
    eventSource: target,
    readInstalled: () => false,
  })
  return service
}

async function start(service: PwaInstallService): Promise<void> {
  await Effect.runPromise(service.start)
}

async function stop(service: PwaInstallService): Promise<void> {
  await Effect.runPromise(service.stop)
}

describe('install prompt policy', () => {
  const started: PwaInstallService[] = []

  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
  })

  afterEach(async () => {
    while (started.length > 0) {
      const service = started.pop()
      if (service) await stop(service)
    }
    vi.restoreAllMocks()
  })

  async function renderWithService(
    target: EventTarget = new EventTarget(),
    userAgent: string = CHROME_UA,
  ) {
    const service = makeService(target, userAgent)
    started.push(service)
    await start(service)
    return {
      service,
      target,
      hook: renderHook(() => useInstallPrompt(service)),
    }
  }

  it('detects desktop Safari Add to Dock support', () => {
    const SAFARI_DESKTOP_UA =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15'
    expect(detectBrowserSupport(SAFARI_DESKTOP_UA, 0)).toBe(
      'safari-desktop-instructions',
    )
    expect(detectBrowserSupport(CHROME_UA, 0)).toBe('native-install')
    expect(detectBrowserSupport(FIREFOX_DESKTOP_UA, 0)).toBe('unsupported')
    expect(detectBrowserSupport('', 0)).toBe('unsupported')
  })

  it('gates auto-promotion on fresh-auth eligibility', async () => {
    const { hook, target } = await renderWithService()
    act(() => {
      target.dispatchEvent(fakePromptEvent())
    })
    // No auth event this tab: no auto promotion.
    expect(hook.result.current.readyToShow).toBe(false)
    act(() => {
      markInstallEligible()
    })
    expect(hook.result.current.readyToShow).toBe(true)
  })

  it('opens manually despite cooldowns and suppression', async () => {
    localStorage.setItem('spliit-pwa-install-dismissed', 'true')
    const { hook } = await renderWithService()
    expect(hook.result.current.readyToShow).toBe(false)
    expect(hook.result.current.isOpen).toBe(false)
    act(() => {
      requestManualInstallOpen()
    })
    expect(hook.result.current.isOpen).toBe(true)
    act(() => {
      hook.result.current.close()
    })
    expect(hook.result.current.isOpen).toBe(false)
  })

  it('manual open still respects unsupported browsers and installed state', async () => {
    const { hook } = await renderWithService(
      new EventTarget(),
      FIREFOX_DESKTOP_UA,
    )
    act(() => {
      hook.result.current.openManual()
    })
    expect(hook.result.current.isOpen).toBe(false)
    hook.unmount()
  })

  it('treats a throwing native prompt as unavailable, never a crash', async () => {
    const { hook, target } = await renderWithService()
    act(() => {
      target.dispatchEvent(
        fakePromptEvent('dismissed', () =>
          Promise.reject(new Error('detached')),
        ),
      )
    })
    markInstallEligible()
    await act(async () => {
      await expect(hook.result.current.install()).resolves.toBe('unavailable')
    })
  })

  it('renders closed with no actions when no service resolves', () => {
    const { result } = renderHook(() => useInstallPrompt())
    expect(result.current.readyToShow).toBe(false)
    expect(result.current.isOpen).toBe(false)
    expect(result.current.browserSupport).toBe('unsupported')
  })

  it('exposes quiet-period and cooldown constants', () => {
    expect(INSTALL_PROMPT_TIMING.AUTO_OPEN_QUIET_MS).toBe(10_000)
    expect(INSTALL_PROMPT_TIMING.REMIND_DELAY_MS).toBe(7 * 24 * 60 * 60 * 1000)
    expect(shouldDeferPromotionForActivity(Date.now(), Date.now())).toBe(true)
    expect(shouldDeferPromotionForActivity(0, 20_000)).toBe(false)
    expect(isPromotionBlockedByWork()).toBe(false)
  })
})
