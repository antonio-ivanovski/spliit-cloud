import userEvent from '@testing-library/user-event'
import { Effect } from 'effect'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { InstallPromotionDialog } from '@/components/install-promotion-dialog'
import { markInstallEligible } from '@/lib/install-eligibility'
import { registerPwaUpdateBlocker } from '@/lib/pwa-update-blockers'
import {
  makePwaInstallService,
  type PwaInstallService,
} from '@/lib/services/pwa-install'
import { requestManualInstallOpen } from '@/lib/use-install-prompt'

// Auto-open waits out a 10s user-quiet period in real time.
vi.setConfig({ testTimeout: 20_000 })
import { act, render, screen, waitFor } from '@/test/test-utils'

// Mirror the hook's local interface so tests can fabricate the event.
interface FakeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

// ── UA / env helpers ────────────────────────────────────────────────────

const CHROME_ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36'
const IOS_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
const FIREFOX_ANDROID_UA =
  'Mozilla/5.0 (Android 14; Mobile; rv:121.0) Gecko/121.0 Firefox/121.0'
const FIREFOX_DESKTOP_UA =
  'Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0'

const AUTO_OPEN_TIMEOUT_MS = 15_000

const SAFARI_DESKTOP_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15'

function markEligible() {
  try {
    sessionStorage.setItem(
      'spliit-pwa-install-eligible',
      new Date().toISOString(),
    )
  } catch {
    // ignore
  }
}

function setUserAgent(ua: string) {
  Object.defineProperty(navigator, 'userAgent', {
    configurable: true,
    value: ua,
  })
}

function setMaxTouchPoints(value: number) {
  Object.defineProperty(navigator, 'maxTouchPoints', {
    configurable: true,
    value,
  })
}

function mockMatchMedia(installed: boolean) {
  // Any display-mode query matches only when explicitly installed;
  // everything else is desktop (Radix Dialog) mode so unmounts are
  // deterministic across all tests.
  vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
    matches: query.includes('display-mode:') ? installed : true,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(() => false),
  }))
}

function fireBeforeInstallPrompt(
  outcome: 'accepted' | 'dismissed' = 'accepted',
) {
  const event = new Event('beforeinstallprompt') as FakeInstallPromptEvent
  event.prompt = vi.fn().mockResolvedValue(undefined)
  event.userChoice = Promise.resolve({ outcome })
  act(() => {
    window.dispatchEvent(event)
  })
  return event
}

function clearStorageFlags() {
  try {
    localStorage.removeItem('spliit-pwa-install-dismissed')
    localStorage.removeItem('spliit-pwa-install-remind-at')
    sessionStorage.removeItem('spliit-pwa-install-eligible')
  } catch {
    // ignore
  }
}

// ── Suite ───────────────────────────────────────────────────────────────

describe('InstallPromotionDialog', () => {
  // One started install service per test (the single capture owner for that
  // test's dialog). Fresh instances replace the deleted reset global; real
  // window beforeinstallprompt events reach the default event source.
  const installServices: PwaInstallService[] = []

  async function renderDialog(service?: PwaInstallService) {
    const resolved = service ?? makePwaInstallService()
    if (!service) installServices.push(resolved)
    await Effect.runPromise(resolved.start)
    const rendered = render(<InstallPromotionDialog service={resolved} />)
    return { service: resolved, ...rendered }
  }

  beforeEach(() => {
    // Default to Chrome Android — each test overrides as needed.
    setUserAgent(CHROME_ANDROID_UA)
    setMaxTouchPoints(0)
    mockMatchMedia(false)
    clearStorageFlags()
    // Eligible by default (fresh auth this tab); the eligibility test below
    // clears the flag explicitly. The per-test service reads it at creation.
    markEligible()
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    while (installServices.length > 0) {
      const service = installServices.pop()
      if (service) {
        await Effect.runPromise(service.stop).catch(() => undefined)
      }
    }
  })

  // ── Browser-support matrix ────────────────────────────────────────────

  it('renders nothing on Firefox desktop (no install path)', async () => {
    setUserAgent(FIREFOX_DESKTOP_UA)
    await renderDialog()
    // No auto-open → nothing to wait for.
    expect(screen.queryByTestId('install-promotion-dialog')).toBeNull()
  })

  it('shows the Chrome copy and an Install button when beforeinstallprompt fires', async () => {
    await renderDialog()
    fireBeforeInstallPrompt()
    expect(
      await screen.findByTestId(
        'install-promotion-dialog',
        {},
        { timeout: AUTO_OPEN_TIMEOUT_MS },
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /install/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /not now/i })).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /don't ask again/i }),
    ).toBeInTheDocument()
  })

  it('renders all actions in a single footer with Install last', async () => {
    await renderDialog()
    fireBeforeInstallPrompt()
    const installBtn = await screen.findByTestId(
      'install-promotion-install',
      {},
      { timeout: AUTO_OPEN_TIMEOUT_MS },
    )
    const remindBtn = await screen.findByTestId(
      'install-promotion-remind-later',
      {},
      { timeout: AUTO_OPEN_TIMEOUT_MS },
    )
    const dismissBtn = await screen.findByTestId(
      'install-promotion-dismiss',
      {},
      { timeout: AUTO_OPEN_TIMEOUT_MS },
    )
    // Single-footer regression guard: the split-footer layout rendered
    // Install in its own row above the dismiss actions.
    expect(installBtn.parentElement).toBe(remindBtn.parentElement)
    expect(dismissBtn.parentElement).toBe(remindBtn.parentElement)
    const buttons: Element[] = Array.from(
      (installBtn.parentElement as HTMLElement).querySelectorAll('button'),
    )
    expect(buttons.indexOf(installBtn)).toBeGreaterThan(
      buttons.indexOf(remindBtn),
    )
  })

  it('shows the iOS instructions on iOS Safari without beforeinstallprompt', async () => {
    setUserAgent(IOS_UA)
    await renderDialog()
    const dialog = await screen.findByTestId(
      'install-promotion-dialog',
      {},
      { timeout: AUTO_OPEN_TIMEOUT_MS },
    )
    expect(dialog).toBeInTheDocument()
    // iOS path has no native Install button.
    expect(screen.queryByTestId('install-promotion-install')).toBeNull()
    // Source text mentions "Share" and "Add to Home Screen".
    expect(dialog.textContent).toMatch(/share/i)
    expect(dialog.textContent).toMatch(/add to home screen/i)
  })

  it('shows the Firefox Android menu-based instructions', async () => {
    setUserAgent(FIREFOX_ANDROID_UA)
    await renderDialog()
    const dialog = await screen.findByTestId(
      'install-promotion-dialog',
      {},
      { timeout: AUTO_OPEN_TIMEOUT_MS },
    )
    expect(dialog).toBeInTheDocument()
    // Firefox path has no native Install button.
    expect(screen.queryByTestId('install-promotion-install')).toBeNull()
    // Source text mentions the menu and Install.
    expect(dialog.textContent).toMatch(/menu/i)
    expect(dialog.textContent).toMatch(/install/i)
  })

  // ── Install action ────────────────────────────────────────────────────

  it('clicking Install calls the deferred prompt on Chrome', async () => {
    const user = userEvent.setup()
    await renderDialog()
    const event = fireBeforeInstallPrompt()
    const installBtn = await screen.findByTestId(
      'install-promotion-install',
      {},
      { timeout: AUTO_OPEN_TIMEOUT_MS },
    )
    await user.click(installBtn)

    await waitFor(() => {
      expect(event.prompt).toHaveBeenCalledTimes(1)
    })
  })

  it('hides the dialog after the user accepts the install prompt', async () => {
    const user = userEvent.setup()
    await renderDialog()
    fireBeforeInstallPrompt('accepted')
    const installBtn = await screen.findByTestId(
      'install-promotion-install',
      {},
      {
        timeout: AUTO_OPEN_TIMEOUT_MS,
      },
    )
    await user.click(installBtn)

    await waitFor(() => {
      expect(
        screen.queryByTestId('install-promotion-install'),
      ).not.toBeInTheDocument()
    })
  })

  // ── Persistence: dismiss / remind-later ───────────────────────────────

  it('clicking "Don\'t ask again" sets a permanent localStorage flag', async () => {
    const user = userEvent.setup()
    await renderDialog()
    fireBeforeInstallPrompt()
    const dismissBtn = await screen.findByTestId(
      'install-promotion-dismiss',
      {},
      { timeout: AUTO_OPEN_TIMEOUT_MS },
    )
    await user.click(dismissBtn)

    expect(localStorage.getItem('spliit-pwa-install-dismissed')).toBe('true')
  })

  it('clicking "Not now" sets a 7-day timestamp in localStorage', async () => {
    const user = userEvent.setup()
    const before = Date.now()
    await renderDialog()
    fireBeforeInstallPrompt()
    const remindBtn = await screen.findByTestId(
      'install-promotion-remind-later',
      {},
      { timeout: AUTO_OPEN_TIMEOUT_MS },
    )
    await user.click(remindBtn)

    const raw = localStorage.getItem('spliit-pwa-install-remind-at')
    expect(raw).not.toBeNull()
    const remindAt = Date.parse(raw as string)
    // Should be ~7 days ahead of now (give a generous tolerance).
    const sevenDays = 7 * 24 * 60 * 60 * 1000
    expect(remindAt - before).toBeGreaterThan(sevenDays - 5_000)
    // Upper slack covers the 10s quiet wait before the dialog opened.
    expect(remindAt - before).toBeLessThan(sevenDays + 15_000)
  })

  it('does not auto-open when the dismissed flag is already set', async () => {
    localStorage.setItem('spliit-pwa-install-dismissed', 'true')
    await renderDialog()
    fireBeforeInstallPrompt()
    // Wait a moment to be sure nothing pops up.
    await new Promise((r) => setTimeout(r, 100))
    expect(screen.queryByTestId('install-promotion-dialog')).toBeNull()
  })

  it('does not auto-open while the remind-later timestamp is in the future', async () => {
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    localStorage.setItem('spliit-pwa-install-remind-at', tomorrow)
    await renderDialog()
    fireBeforeInstallPrompt()
    await new Promise((r) => setTimeout(r, 100))
    expect(screen.queryByTestId('install-promotion-dialog')).toBeNull()
  })

  it('re-opens once the remind-later timestamp has passed', async () => {
    const yesterday = new Date(Date.now() - 1000).toISOString()
    localStorage.setItem('spliit-pwa-install-remind-at', yesterday)
    await renderDialog()
    fireBeforeInstallPrompt()
    expect(
      await screen.findByTestId(
        'install-promotion-dialog',
        {},
        { timeout: AUTO_OPEN_TIMEOUT_MS },
      ),
    ).toBeInTheDocument()
  })

  it('does not auto-open when display-mode is standalone (already installed)', async () => {
    mockMatchMedia(true)
    await renderDialog()
    fireBeforeInstallPrompt()
    await new Promise((r) => setTimeout(r, 100))
    expect(screen.queryByTestId('install-promotion-dialog')).toBeNull()
  })

  it('does not auto-open in minimal-ui display mode (already installed)', async () => {
    vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
      matches: query === '(display-mode: minimal-ui)',
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(() => false),
    }))
    await renderDialog()
    fireBeforeInstallPrompt()
    await new Promise((r) => setTimeout(r, 100))
    expect(screen.queryByTestId('install-promotion-dialog')).toBeNull()
  })

  it('does not auto-open when launched from an Android TWA (already installed)', async () => {
    vi.spyOn(document, 'referrer', 'get').mockReturnValue(
      'android-app://cloud.spliit.app',
    )
    await renderDialog()
    fireBeforeInstallPrompt()
    await new Promise((r) => setTimeout(r, 100))
    expect(screen.queryByTestId('install-promotion-dialog')).toBeNull()
  })

  it('hides itself after appinstalled fires', async () => {
    await renderDialog()
    fireBeforeInstallPrompt()
    await screen.findByTestId(
      'install-promotion-install',
      {},
      {
        timeout: AUTO_OPEN_TIMEOUT_MS,
      },
    )

    await act(async () => {
      window.dispatchEvent(new Event('appinstalled'))
      // Allow React 18 to flush both the listener's setInstalled and the
      // auto-close effect's setIsOpen(false) before asserting.
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(
        screen.queryByTestId('install-promotion-install'),
      ).not.toBeInTheDocument()
    })
  })

  // ── Esc / backdrop dismiss ────────────────────────────────────────────

  it('treats Esc / backdrop dismiss as "not now" (not permanent)', async () => {
    const user = userEvent.setup()
    await renderDialog()
    fireBeforeInstallPrompt()
    await screen.findByTestId(
      'install-promotion-install',
      {},
      {
        timeout: AUTO_OPEN_TIMEOUT_MS,
      },
    )

    // Press Escape; the underlying Radix Dialog surfaces onOpenChange(false).
    await user.keyboard('{Escape}')

    expect(localStorage.getItem('spliit-pwa-install-dismissed')).toBeNull()
    expect(localStorage.getItem('spliit-pwa-install-remind-at')).not.toBeNull()
  })

  // ── Auth-success eligibility ──────────────────────────────────────────

  it('does not auto-open without a fresh auth event in this tab', async () => {
    sessionStorage.removeItem('spliit-pwa-install-eligible')
    await renderDialog()
    fireBeforeInstallPrompt()
    await new Promise((r) => setTimeout(r, 100))
    expect(screen.queryByTestId('install-promotion-dialog')).toBeNull()
  })

  it(
    'shares one service capture across remounts (routes)',
    { timeout: 40_000 },
    async () => {
      const first = await renderDialog()
      fireBeforeInstallPrompt()
      await screen.findByTestId(
        'install-promotion-dialog',
        {},
        { timeout: AUTO_OPEN_TIMEOUT_MS },
      )
      // A route change remounts the dialog on the same service: no second
      // event needed.
      first.unmount()
      await renderDialog(first.service)
      expect(
        await screen.findByTestId(
          'install-promotion-dialog',
          {},
          { timeout: AUTO_OPEN_TIMEOUT_MS },
        ),
      ).toBeInTheDocument()
    },
  )

  it('treats a native dismissal like "Not now" (7-day cooldown)', async () => {
    const user = userEvent.setup()
    await renderDialog()
    fireBeforeInstallPrompt('dismissed')
    const installBtn = await screen.findByTestId(
      'install-promotion-install',
      {},
      { timeout: AUTO_OPEN_TIMEOUT_MS },
    )
    await user.click(installBtn)
    await waitFor(() => {
      expect(
        localStorage.getItem('spliit-pwa-install-remind-at'),
      ).not.toBeNull()
    })
    expect(localStorage.getItem('spliit-pwa-install-dismissed')).toBeNull()
  })

  it(
    'defers auto-open while unfinished work blocks, resumes after',
    { timeout: 40_000 },
    async () => {
      const release = registerPwaUpdateBlocker('test-form')
      try {
        await renderDialog()
        fireBeforeInstallPrompt()
        await new Promise((r) => setTimeout(r, 11_000))
        expect(screen.queryByTestId('install-promotion-dialog')).toBeNull()
      } finally {
        release()
      }
      expect(
        await screen.findByTestId(
          'install-promotion-dialog',
          {},
          { timeout: AUTO_OPEN_TIMEOUT_MS },
        ),
      ).toBeInTheDocument()
    },
  )

  it('opens after delayed eligibility lands post-mount', async () => {
    sessionStorage.removeItem('spliit-pwa-install-eligible')
    await renderDialog()
    fireBeforeInstallPrompt()
    await new Promise((r) => setTimeout(r, 100))
    expect(screen.queryByTestId('install-promotion-dialog')).toBeNull()
    markInstallEligible()
    expect(
      await screen.findByTestId(
        'install-promotion-dialog',
        {},
        { timeout: AUTO_OPEN_TIMEOUT_MS },
      ),
    ).toBeInTheDocument()
  })

  it('survives restricted storage without crashing', async () => {
    const user = userEvent.setup()
    await renderDialog()
    fireBeforeInstallPrompt()
    const installBtn = await screen.findByTestId(
      'install-promotion-install',
      {},
      { timeout: AUTO_OPEN_TIMEOUT_MS },
    )
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied')
    })
    try {
      await user.click(installBtn)
      await waitFor(() => {
        expect(
          screen.queryByTestId('install-promotion-dialog'),
        ).not.toBeInTheDocument()
      })
    } finally {
      vi.restoreAllMocks()
    }
  })

  it('shows desktop Safari Add to Dock instructions', async () => {
    setUserAgent(SAFARI_DESKTOP_UA)
    setMaxTouchPoints(0)
    await renderDialog()
    const dialog = await screen.findByTestId(
      'install-promotion-dialog',
      {},
      { timeout: AUTO_OPEN_TIMEOUT_MS },
    )
    expect(dialog.textContent).toMatch(/add to dock/i)
    expect(screen.queryByTestId('install-promotion-install')).toBeNull()
  })

  it('opens on manual request despite an active remind-later cooldown', async () => {
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    localStorage.setItem('spliit-pwa-install-remind-at', tomorrow)
    await renderDialog()
    fireBeforeInstallPrompt()
    await new Promise((r) => setTimeout(r, 100))
    expect(screen.queryByTestId('install-promotion-dialog')).toBeNull()
    await act(async () => {
      requestManualInstallOpen()
    })
    expect(
      await screen.findByTestId('install-promotion-dialog'),
    ).toBeInTheDocument()
  })
})
