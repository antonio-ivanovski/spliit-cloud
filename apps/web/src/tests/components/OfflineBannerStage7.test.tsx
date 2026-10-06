import { afterEach, describe, expect, it, vi } from 'vitest'

import { OfflineBanner } from '@/components/offline-banner'
import { ApiStatusBanner } from '@/components/api-status-banner'
import {
  OfflineMissingData,
  OfflineNeedsConnection,
} from '@/components/offline-download-status'
import { resetConnectivityForTests, trackedFetch } from '@/lib/connectivity'
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

  it('defers to the server banner when the server answers with failure', async () => {
    // Split-banner architecture: OfflineBanner covers browser-offline only.
    // A 5xx while online is the API's outage, so ApiStatusBanner takes over
    // and OfflineBanner stays hidden instead of wrongly blaming the user's
    // connection. A 5xx also mirrors into the offline store distinctly
    // (serverFailure, not unreachable transport).
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: true,
    })
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () =>
      new Response('{}', {
        status: 503,
        headers: { 'content-type': 'application/json' },
      })) as unknown as typeof fetch
    try {
      render(
        <>
          <OfflineBanner />
          <ApiStatusBanner />
        </>,
      )
      await act(async () => {
        await trackedFetch('https://api.example.test/health/liveness')
      })
      expect(
        getDefaultConnectivityStore().getSnapshot().serverFailure,
      ).not.toBeNull()
      expect(screen.queryByTestId('offline-banner')).not.toBeInTheDocument()
      expect(screen.getByTestId('api-status-banner')).toHaveTextContent(
        /can't be reached/i,
      )
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('claims nothing offline while a recovery probe is in flight', async () => {
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
        expect(
          getDefaultConnectivityStore().getSnapshot().probeInFlight,
        ).toBe(true)
      })
      // A pending probe is not proof of offline: no false offline claim.
      expect(screen.queryByTestId('offline-banner')).not.toBeInTheDocument()
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
    // In-flow inside the shell's sticky notice stack (the parent provides
    // stickiness): occupies layout space, never overlays the page heading.
    expect(banner.className).toContain('shrink-0')
    expect(banner.className).not.toMatch(/(?:^|\s)fixed(?:\s|$)/)
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
