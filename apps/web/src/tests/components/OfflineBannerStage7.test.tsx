import { afterEach, describe, expect, it, vi } from 'vitest'

import { OfflineBanner } from '@/components/offline-banner'
import {
  OfflineMissingData,
  OfflineNeedsConnection,
} from '@/components/offline-download-status'
import { resetConnectivityForTests } from '@/lib/connectivity'
import {
  getDefaultConnectivityStore,
  resetDefaultConnectivityStoreForTests,
} from '@/lib/offline/connectivity'
import { act, render, screen, waitFor } from '@/test/test-utils'

describe('OfflineBanner honest copy', () => {
  afterEach(() => {
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: true,
    })
    resetConnectivityForTests()
    resetDefaultConnectivityStoreForTests()
  })

  it('uses read-only copy without promising later sync', () => {
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: false,
    })
    render(<OfflineBanner />)
    const banner = screen.getByTestId('offline-banner')
    expect(banner).toHaveTextContent(/downloaded data is read-only/i)
    expect(banner.textContent).not.toMatch(
      /won't be saved|sync later|saved.*reconnect/i,
    )
  })

  it('shows server outage copy when the server answers with failure', () => {
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: true,
    })
    const store = getDefaultConnectivityStore()
    act(() => {
      store.reportServerResponse(503)
    })
    render(<OfflineBanner />)
    expect(screen.getByTestId('offline-banner')).toHaveTextContent(
      /can't reach spliit right now/i,
    )
  })

  it('shows recovering copy while a probe is in flight', async () => {
    // Hold the liveness probe open so `unknown + probeInFlight` is observable.
    const originalFetch = globalThis.fetch
    let release!: (value: Response) => void
    const gate = new Promise<Response>((resolve) => {
      release = resolve
    })
    globalThis.fetch = (() => gate) as unknown as typeof fetch
    try {
      // Trigger the online-event probe path (unknown + in-flight).
      Object.defineProperty(navigator, 'onLine', {
        configurable: true,
        value: true,
      })
      act(() => {
        window.dispatchEvent(new Event('online'))
      })
      render(<OfflineBanner />)
      await waitFor(() => {
        expect(screen.getByTestId('offline-banner')).toHaveTextContent(
          /reconnecting/i,
        )
      })
      act(() => {
        release(
          new Response(JSON.stringify({ status: 'ok' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        )
      })
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('keeps status semantics and avoids overlay layout', () => {
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: false,
    })
    render(<OfflineBanner />)
    const banner = screen.getByTestId('offline-banner')
    expect(banner).toHaveAttribute('role', 'status')
    expect(banner).toHaveAttribute('aria-live', 'polite')
    expect(banner.className).toContain('sticky')
    expect(banner.className).not.toMatch(/(?:^|\s)fixed(?:\s|$)/)
    expect(banner.className).toContain('motion-reduce:animate-none')
  })
})

describe('OfflineNeedsConnection / OfflineMissingData', () => {
  it('shows needs-connection with back navigation and no generic error', () => {
    render(<OfflineNeedsConnection backLabel="Back to groups" backHref="/" />)
    const root = screen.getByTestId('offline-needs-connection')
    expect(root).toHaveTextContent(/needs a connection/i)
    expect(
      screen.getByRole('link', { name: /back to groups/i }),
    ).toHaveAttribute('href', '/')
  })

  it('explains missing data with retry when recovery is possible', async () => {
    const onRetry = vi.fn()
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: true,
    })
    const { user } = render(
      <OfflineMissingData
        description="This group hasn't finished downloading."
        onRetry={onRetry}
        backLabel="Back to groups"
        backHref="/"
      />,
    )
    expect(screen.getByTestId('offline-missing-data')).toHaveTextContent(
      /hasn't finished downloading/i,
    )
    await user.click(screen.getByRole('button', { name: /try again/i }))
    expect(onRetry).toHaveBeenCalledOnce()
    expect(
      screen.getByRole('link', { name: /back to groups/i }),
    ).toBeInTheDocument()
  })

  it('hides retry when the browser is explicitly offline', () => {
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: false,
    })
    render(
      <OfflineMissingData
        description="This group hasn't finished downloading."
        onRetry={vi.fn()}
        backLabel="Back to groups"
        backHref="/"
      />,
    )
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: /back to groups/i }),
    ).toBeInTheDocument()
  })
})
