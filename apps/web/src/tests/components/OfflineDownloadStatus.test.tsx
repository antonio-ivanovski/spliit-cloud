import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  resolveDownloadStatusKind,
  useOfflineDownloadSummary,
  type DownloadSummary,
} from '@/components/offline-download-status'

const summaryMocks = vi.hoisted(() => ({
  useSession: vi.fn(),
  useStorage: vi.fn(),
  useSync: vi.fn(),
}))

vi.mock('@/lib/offline/provider', async (importOriginal) => {
  const original = (await importOriginal()) as Record<string, unknown>
  return {
    ...original,
    useOfflineSession: summaryMocks.useSession,
    useOptionalOfflineStorage: summaryMocks.useStorage,
    useOptionalOfflineSync: summaryMocks.useSync,
    useOfflineRetry: () => ({ retry: vi.fn(async () => true) }),
  }
})

function makeSummaryWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
  return Wrapper
}

function baseSummary(
  overrides: Partial<DownloadSummary> = {},
): DownloadSummary {
  return {
    storageStatus: 'available',
    storageBlockedMessage: null,
    total: 2,
    ready: 2,
    dirtyCount: 0,
    errorCount: 0,
    unsupportedCount: 0,
    catalogUnsupported: false,
    hasMore: false,
    enabled: true,
    catalogCapturedAt: null,
    lastCompletedFullPassAt: null,
    currentGroupName: null,
    syncPhase: null,
    syncErrorCount: 0,
    isLoading: false,
    isRefreshing: false,
    ...overrides,
  }
}

describe('resolveDownloadStatusKind', () => {
  it('requires all ready with no failure for available', () => {
    expect(resolveDownloadStatusKind(baseSummary())).toBe('available')
  })

  it('uses needs-update when dirty even when all ready', () => {
    expect(resolveDownloadStatusKind(baseSummary({ dirtyCount: 1 }))).toBe(
      'needs-update',
    )
  })

  it('uses needs-update when ready but an active failure exists', () => {
    expect(resolveDownloadStatusKind(baseSummary({ errorCount: 1 }))).toBe(
      'needs-update',
    )
  })

  it('reports empty for zero-member accounts', () => {
    expect(resolveDownloadStatusKind(baseSummary({ total: 0, ready: 0 }))).toBe(
      'empty',
    )
  })

  it('reports paused when automatic downloads are off', () => {
    expect(
      resolveDownloadStatusKind(
        baseSummary({ enabled: false, ready: 1, total: 2 }),
      ),
    ).toBe('paused')
  })

  it('keeps storage failures distinct for recoverable retry UI', () => {
    expect(
      resolveDownloadStatusKind(baseSummary({ storageStatus: 'blocked' })),
    ).toBe('blocked')
    expect(
      resolveDownloadStatusKind(baseSummary({ storageStatus: 'quota-error' })),
    ).toBe('quota-error')
    expect(
      resolveDownloadStatusKind(baseSummary({ storageStatus: 'unavailable' })),
    ).toBe('unavailable')
  })

  it('distinguishes downloading from partial via real sync phase', () => {
    expect(
      resolveDownloadStatusKind(
        baseSummary({ ready: 1, total: 2, syncPhase: 'downloading' }),
      ),
    ).toBe('downloading')
    expect(
      resolveDownloadStatusKind(
        baseSummary({ ready: 1, total: 2, syncPhase: 'verifying' }),
      ),
    ).toBe('downloading')
    expect(
      resolveDownloadStatusKind(
        baseSummary({ ready: 1, total: 2, syncPhase: 'catalog' }),
      ),
    ).toBe('downloading')
    expect(
      resolveDownloadStatusKind(
        baseSummary({ ready: 1, total: 2, syncPhase: 'idle' }),
      ),
    ).toBe('partial')
    // Fallback when no engine exists: isRefreshing still distinguishes.
    expect(
      resolveDownloadStatusKind(
        baseSummary({ ready: 1, total: 2, isRefreshing: true }),
      ),
    ).toBe('downloading')
    expect(
      resolveDownloadStatusKind(
        baseSummary({ ready: 1, total: 2, isRefreshing: false }),
      ),
    ).toBe('partial')
  })

  it('reports unsupported for old schemas without a dead Retry (P1-5)', () => {
    expect(
      resolveDownloadStatusKind(baseSummary({ unsupportedCount: 1 })),
    ).toBe('unsupported')
    expect(
      resolveDownloadStatusKind(baseSummary({ catalogUnsupported: true })),
    ).toBe('unsupported')
    // Unsupported outranks empty/partial so the update copy wins.
    expect(
      resolveDownloadStatusKind(
        baseSummary({ total: 0, ready: 0, unsupportedCount: 1 }),
      ),
    ).toBe('unsupported')
  })
})

describe('useOfflineDownloadSummary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    summaryMocks.useSession.mockReturnValue({ namespace: 'ns', generation: 1 })
    summaryMocks.useSync.mockReturnValue(null)
  })

  function storageWith({
    controlEnabled,
    catalog,
  }: {
    controlEnabled: boolean
    catalog: null | { groups: unknown[]; capturedAt: Date }
  }) {
    // Store snapshots must stay referentially stable between emits or
    // useSyncExternalStore loops (see the component's own comment).
    const snapshot = { status: 'available', blockedMessage: null }
    return {
      subscribe: () => () => {},
      getSnapshot: () => snapshot,
      getRepository: () => ({
        readControl: vi.fn(async () => ({
          generation: 1,
          enabled: controlEnabled,
        })),
        readCatalog: vi.fn(async () =>
          catalog
            ? { status: 'ready' as const, record: catalog }
            : { status: 'missing' as const },
        ),
        listGroupStatus: vi.fn(async () => []),
        readGroup: vi.fn(async () => ({ status: 'missing' as const })),
      }),
    }
  }

  it('reports disabled (not default-on) when Clear removed the catalog', async () => {
    // Regression: after Clear downloads the catalog is gone while control
    // stays disabled. Defaulting enabled to true showed the switch ON while
    // storage was OFF, and every toggle wrote `false` to already-false
    // storage, leaving no way back on.
    summaryMocks.useStorage.mockReturnValue(
      storageWith({ controlEnabled: false, catalog: null }),
    )
    const { result } = renderHook(() => useOfflineDownloadSummary(), {
      wrapper: makeSummaryWrapper(),
    })
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })
    expect(result.current.enabled).toBe(false)
    expect(resolveDownloadStatusKind(result.current)).toBe('empty')
  })

  it('reports enabled when control is on even without a catalog yet', async () => {
    summaryMocks.useStorage.mockReturnValue(
      storageWith({ controlEnabled: true, catalog: null }),
    )
    const { result } = renderHook(() => useOfflineDownloadSummary(), {
      wrapper: makeSummaryWrapper(),
    })
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })
    expect(result.current.enabled).toBe(true)
  })
})
