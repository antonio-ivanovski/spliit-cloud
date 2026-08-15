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

  it('shows the banner when a fetch fails even if navigator.onLine is true', async () => {
    render(<OfflineBanner />)
    expect(screen.queryByTestId('offline-banner')).not.toBeInTheDocument()

    act(() => {
      reportNetworkFailure(new TypeError('Failed to fetch'))
    })

    expect(await screen.findByTestId('offline-banner')).toBeInTheDocument()
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
