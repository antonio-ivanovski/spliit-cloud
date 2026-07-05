import { InstallPromotionDialog } from '@/components/install-promotion-dialog'
import { act, render, screen, waitFor } from '@/test/test-utils'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

const AUTO_OPEN_TIMEOUT_MS = 3000

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

function mockMatchMedia(standalone: boolean) {
  // Single mock: standalone query only matches when explicitly true;
  // everything else is desktop (Radix Dialog) mode so unmounts are
  // deterministic across all tests.
  vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
    matches:
      standalone && query.includes('display-mode: standalone')
        ? true
        : !query.includes('display-mode: standalone'),
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
  window.dispatchEvent(event)
  return event
}

function clearStorageFlags() {
  try {
    localStorage.removeItem('spliit-pwa-install-dismissed')
    localStorage.removeItem('spliit-pwa-install-remind-at')
  } catch {
    // ignore
  }
}

// ── Suite ───────────────────────────────────────────────────────────────

describe('InstallPromotionDialog', () => {
  beforeEach(() => {
    // Default to Chrome Android — each test overrides as needed.
    setUserAgent(CHROME_ANDROID_UA)
    setMaxTouchPoints(0)
    mockMatchMedia(false)
    clearStorageFlags()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ── Browser-support matrix ────────────────────────────────────────────

  it('renders nothing on Firefox desktop (no install path)', async () => {
    setUserAgent(FIREFOX_DESKTOP_UA)
    render(<InstallPromotionDialog />)
    // No auto-open → nothing to wait for.
    expect(screen.queryByTestId('install-promotion-dialog')).toBeNull()
  })

  it('shows the Chrome copy and an Install button when beforeinstallprompt fires', async () => {
    render(<InstallPromotionDialog />)
    fireBeforeInstallPrompt()
    expect(
      await screen.findByTestId(
        'install-promotion-dialog',
        {},
        { timeout: AUTO_OPEN_TIMEOUT_MS },
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /install/i })).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /remind me later/i }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /don't show again/i }),
    ).toBeInTheDocument()
  })

  it('shows the iOS instructions on iOS Safari without beforeinstallprompt', async () => {
    setUserAgent(IOS_UA)
    render(<InstallPromotionDialog />)
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
    render(<InstallPromotionDialog />)
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
    render(<InstallPromotionDialog />)
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
    render(<InstallPromotionDialog />)
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

  it('clicking "Don\'t show again" sets a permanent localStorage flag', async () => {
    const user = userEvent.setup()
    render(<InstallPromotionDialog />)
    fireBeforeInstallPrompt()
    const dismissBtn = await screen.findByTestId(
      'install-promotion-dismiss',
      {},
      { timeout: AUTO_OPEN_TIMEOUT_MS },
    )
    await user.click(dismissBtn)

    expect(localStorage.getItem('spliit-pwa-install-dismissed')).toBe('true')
  })

  it('clicking "Remind me later" sets a 24h timestamp in localStorage', async () => {
    const user = userEvent.setup()
    const before = Date.now()
    render(<InstallPromotionDialog />)
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
    // Should be ~24h ahead of now (give a generous tolerance).
    const twentyFourHours = 24 * 60 * 60 * 1000
    expect(remindAt - before).toBeGreaterThan(twentyFourHours - 5_000)
    expect(remindAt - before).toBeLessThan(twentyFourHours + 5_000)
  })

  it('does not auto-open when the dismissed flag is already set', async () => {
    localStorage.setItem('spliit-pwa-install-dismissed', 'true')
    render(<InstallPromotionDialog />)
    fireBeforeInstallPrompt()
    // Wait a moment to be sure nothing pops up.
    await new Promise((r) => setTimeout(r, 100))
    expect(screen.queryByTestId('install-promotion-dialog')).toBeNull()
  })

  it('does not auto-open while the remind-later timestamp is in the future', async () => {
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    localStorage.setItem('spliit-pwa-install-remind-at', tomorrow)
    render(<InstallPromotionDialog />)
    fireBeforeInstallPrompt()
    await new Promise((r) => setTimeout(r, 100))
    expect(screen.queryByTestId('install-promotion-dialog')).toBeNull()
  })

  it('re-opens once the remind-later timestamp has passed', async () => {
    const yesterday = new Date(Date.now() - 1000).toISOString()
    localStorage.setItem('spliit-pwa-install-remind-at', yesterday)
    render(<InstallPromotionDialog />)
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
    render(<InstallPromotionDialog />)
    fireBeforeInstallPrompt()
    await new Promise((r) => setTimeout(r, 100))
    expect(screen.queryByTestId('install-promotion-dialog')).toBeNull()
  })

  it('hides itself after appinstalled fires', async () => {
    render(<InstallPromotionDialog />)
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

  it('treats Esc / backdrop dismiss as "remind me later" (not permanent)', async () => {
    const user = userEvent.setup()
    render(<InstallPromotionDialog />)
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
})
