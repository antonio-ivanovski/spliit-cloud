import { afterEach, describe, expect, it } from 'vitest'

import { OfflineBanner } from '@/components/offline-banner'
import {
  reportNetworkFailure,
  resetConnectivityForTests,
} from '@/lib/connectivity'
import { act, render, screen, waitFor } from '@/test/test-utils'

describe('OfflineBanner', () => {
  afterEach(() => {
    // Reset to default online state between tests.
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: true,
    })
    resetConnectivityForTests()
  })

  it('renders nothing when online', () => {
    render(<OfflineBanner />)
    expect(screen.queryByTestId('offline-banner')).not.toBeInTheDocument()
  })

  it('renders the banner when navigator.onLine is false on mount', () => {
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: false,
    })
    render(<OfflineBanner />)
    expect(screen.getByTestId('offline-banner')).toBeInTheDocument()
  })

  it('shows the localized message inside the banner', () => {
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: false,
    })
    render(<OfflineBanner />)
    // Falls back to en-US source string at test time.
    expect(screen.getByTestId('offline-banner')).toHaveTextContent(/offline/i)
  })

  it('shows the banner when the window receives an offline event', async () => {
    render(<OfflineBanner />)
    expect(screen.queryByTestId('offline-banner')).not.toBeInTheDocument()

    act(() => {
      window.dispatchEvent(new Event('offline'))
    })

    expect(await screen.findByTestId('offline-banner')).toBeInTheDocument()
  })

  it('hides the banner when the window receives an online event', async () => {
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: false,
    })
    render(<OfflineBanner />)
    expect(screen.getByTestId('offline-banner')).toBeInTheDocument()

    act(() => {
      window.dispatchEvent(new Event('online'))
    })

    await waitFor(() => {
      expect(screen.queryByTestId('offline-banner')).not.toBeInTheDocument()
    })
  })

  it('stays hidden when a fetch fails while navigator.onLine is true (server down, not offline)', async () => {
    render(<OfflineBanner />)
    expect(screen.queryByTestId('offline-banner')).not.toBeInTheDocument()

    act(() => {
      reportNetworkFailure(new TypeError('Failed to fetch'))
    })

    // The offline banner must not blame the user's connection when the
    // browser is online — the API status banner takes over instead.
    expect(screen.queryByTestId('offline-banner')).not.toBeInTheDocument()
  })

  it('exposes role=status and aria-live=polite for screen readers', () => {
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: false,
    })
    render(<OfflineBanner />)
    const banner = screen.getByTestId('offline-banner')
    expect(banner).toHaveAttribute('role', 'status')
    expect(banner).toHaveAttribute('aria-live', 'polite')
  })

  it('occupies layout space instead of overlaying the page heading', () => {
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: false,
    })
    render(<OfflineBanner />)
    const banner = screen.getByTestId('offline-banner')
    expect(banner.className).toContain('sticky')
    expect(banner.className).not.toMatch(/(?:^|\s)fixed(?:\s|$)/)
  })
})
