import { beforeEach, describe, expect, it, vi } from 'vitest'

import { OfflineDownloadSettings } from '@/app/account/offline-download-settings'
import { render, screen, waitFor } from '@/test/test-utils'

const mocks = vi.hoisted(() => ({
  useSession: vi.fn(),
  useStorage: vi.fn(),
  useRetry: vi.fn(),
  useSummary: vi.fn(),
}))

vi.mock('@/lib/offline/provider', async (importOriginal) => {
  const original = (await importOriginal()) as Record<string, unknown>
  return {
    ...original,
    useOfflineSession: mocks.useSession,
    useOptionalOfflineStorage: mocks.useStorage,
    useOfflineRetry: mocks.useRetry,
  }
})

vi.mock('@/components/offline-download-status', async (importOriginal) => {
  const original = (await importOriginal()) as Record<string, unknown>
  return {
    ...original,
    useOfflineDownloadSummary: mocks.useSummary,
    OfflineGroupStatus: () => null,
  }
})

function makeStorage(enabled = true) {
  return {
    subscribe: () => () => {},
    getSnapshot: () => ({ status: 'available' }),
    getRepository: () => ({
      readControl: vi.fn(async () => ({ generation: 3, enabled })),
      readCatalog: vi.fn(async () => ({ status: 'missing' })),
      setEnabled: vi.fn(async () => ({ generation: 4 })),
      clearDownloads: vi.fn(async () => ({ generation: 5 })),
    }),
  }
}

describe('OfflineDownloadSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.useSession.mockReturnValue({ namespace: 'ns', generation: 0 })
    mocks.useStorage.mockReturnValue(makeStorage(true))
    mocks.useRetry.mockReturnValue({ retry: vi.fn(async () => true) })
    mocks.useSummary.mockReturnValue({
      storageStatus: 'available',
      total: 2,
      ready: 2,
      dirtyCount: 0,
      errorCount: 0,
      hasMore: true,
      enabled: true,
      catalogCapturedAt: new Date('2026-09-01T12:00:00.000Z'),
      isLoading: false,
      isRefreshing: false,
    })
    // Storage estimate unsupported in jsdom by default.
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: true,
    })
  })

  it('renders for a device identity with automatic downloads on by default', async () => {
    render(<OfflineDownloadSettings />)
    expect(
      await screen.findByRole('heading', { name: /offline downloads/i }),
    ).toBeInTheDocument()
    const toggle = screen.getByRole('switch', {
      name: /automatic downloads/i,
    })
    expect(toggle).toHaveAttribute('data-checked', '')
  })

  it('shows the exact clear confirmation copy from the contract', async () => {
    const { user } = render(<OfflineDownloadSettings />)
    await user.click(screen.getByRole('button', { name: /^clear downloads$/i }))
    expect(
      await screen.findByText(
        /remove downloaded groups and expenses from this device\? your server data stays safe\. automatic downloads will be turned off\./i,
      ),
    ).toBeInTheDocument()
  })

  it('invokes persist only on click and survives denial', async () => {
    const persist = vi.fn(async () => false)
    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: { persist, estimate: vi.fn(async () => ({})) },
    })
    try {
      const { user } = render(<OfflineDownloadSettings />)
      // No automatic prompt on mount.
      expect(persist).not.toHaveBeenCalled()
      await user.click(
        screen.getByRole('button', { name: /keep downloads on this device/i }),
      )
      await waitFor(() => {
        expect(persist).toHaveBeenCalledTimes(1)
      })
      expect(
        await screen.findByText(
          /did not keep offline data\. downloads still work/i,
        ),
      ).toBeInTheDocument()
    } finally {
      // jsdom has no storage by default; remove the stub.
      Object.defineProperty(navigator, 'storage', {
        configurable: true,
        value: undefined,
      })
    }
  })

  it('disables refresh when downloads are paused', () => {
    mocks.useSummary.mockReturnValue({
      storageStatus: 'available',
      total: 2,
      ready: 1,
      dirtyCount: 0,
      errorCount: 0,
      hasMore: false,
      enabled: false,
      catalogCapturedAt: null,
      isLoading: false,
      isRefreshing: false,
    })
    mocks.useStorage.mockReturnValue(makeStorage(false))
    render(<OfflineDownloadSettings />)
    expect(screen.getByRole('button', { name: /refresh now/i })).toBeDisabled()
  })

  it('surfaces cleanup failures with Retry (P1-6)', async () => {
    mocks.useSession.mockReturnValue({
      namespace: 'ns',
      generation: 0,
      cleanupError: 'cleanup-failed',
    })
    render(<OfflineDownloadSettings />)
    expect(
      await screen.findByTestId('offline-cleanup-error'),
    ).toBeInTheDocument()
    expect(screen.getByTestId('cleanup-retry')).toBeInTheDocument()
  })
})
