import { afterEach, describe, expect, it, vi } from 'vitest'

import { ApiErrorEmptyState } from '@/components/api-error-empty-state'
import { ApiStatusBanner } from '@/components/api-status-banner'
import { OfflineBanner } from '@/components/offline-banner'
import {
  reportNetworkFailure,
  resetConnectivityForTests,
} from '@/lib/connectivity'
import { act, render, screen } from '@/test/test-utils'

function stubStatusPageUrl(value: string | undefined) {
  if (value === undefined) {
    vi.stubEnv('VITE_STATUS_PAGE_URL', '')
  } else {
    vi.stubEnv('VITE_STATUS_PAGE_URL', value)
  }
}

function goOffline() {
  Object.defineProperty(navigator, 'onLine', {
    configurable: true,
    value: false,
  })
}

describe('offline vs server-unreachable banners', () => {
  afterEach(() => {
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: true,
    })
    resetConnectivityForTests()
    vi.unstubAllEnvs()
  })

  it('shows neither banner when online', () => {
    render(
      <>
        <OfflineBanner />
        <ApiStatusBanner />
      </>,
    )
    expect(screen.queryByTestId('offline-banner')).not.toBeInTheDocument()
    expect(screen.queryByTestId('api-status-banner')).not.toBeInTheDocument()
  })

  it('shows only the offline banner when the browser is offline', () => {
    goOffline()
    render(
      <>
        <OfflineBanner />
        <ApiStatusBanner />
      </>,
    )
    expect(screen.getByTestId('offline-banner')).toHaveTextContent(/offline/i)
    expect(screen.queryByTestId('api-status-banner')).not.toBeInTheDocument()
  })

  it('shows only the server banner when the API fails while online', async () => {
    render(
      <>
        <OfflineBanner />
        <ApiStatusBanner />
      </>,
    )

    act(() => {
      reportNetworkFailure(new TypeError('Failed to fetch'))
    })

    const banner = await screen.findByTestId('api-status-banner')
    expect(banner).toHaveAttribute('role', 'alert')
    expect(banner).toHaveTextContent(/your connection looks fine/i)
    expect(banner).not.toHaveTextContent(/you're offline/i)
    expect(screen.queryByTestId('offline-banner')).not.toBeInTheDocument()
  })

  it('links to the status page when one is configured', async () => {
    stubStatusPageUrl('https://status.spliit.cloud/')
    render(<ApiStatusBanner />)

    act(() => {
      reportNetworkFailure(new TypeError('Failed to fetch'))
    })

    const link = (await screen.findByTestId('api-status-banner')).querySelector(
      'a',
    )
    expect(link?.getAttribute('href')).toBe('https://status.spliit.cloud/')
    expect(link?.getAttribute('target')).toBe('_blank')
  })

  it('hides the status link for self-hosters without a status page', async () => {
    stubStatusPageUrl(undefined)
    render(<ApiStatusBanner />)

    act(() => {
      reportNetworkFailure(new TypeError('Failed to fetch'))
    })

    expect(
      (await screen.findByTestId('api-status-banner')).querySelector('a'),
    ).toBeNull()
  })
})

describe('ApiErrorEmptyState', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('blames the server and offers a retry', async () => {
    const onRetry = vi.fn()
    const { user } = render(<ApiErrorEmptyState onRetry={onRetry} />)
    const state = screen.getByTestId('api-error-empty-state')
    expect(state).toHaveAttribute('role', 'alert')
    expect(state).toHaveTextContent(/unavailable/i)
    expect(state).not.toHaveTextContent(/you're offline/i)
    await user.click(screen.getByRole('button'))
    expect(onRetry).toHaveBeenCalledOnce()
  })

  it('shows the status link only when configured', () => {
    render(<ApiErrorEmptyState onRetry={() => {}} />)
    expect(
      screen.getByTestId('api-error-empty-state').querySelector('a'),
    ).toBeNull()

    stubStatusPageUrl('https://status.spliit.cloud/')
    render(<ApiErrorEmptyState onRetry={() => {}} />)
    const links = screen
      .getAllByTestId('api-error-empty-state')
      .map((state) => state.querySelector('a'))
    expect(links[1]?.getAttribute('href')).toBe('https://status.spliit.cloud/')
  })
})
