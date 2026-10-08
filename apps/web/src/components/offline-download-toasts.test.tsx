import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { OfflineProvider } from '@/lib/offline/provider'
import type { OfflineSync, SyncStatusSnapshot } from '@/lib/offline/sync'

import {
  DOWNLOAD_TOAST_COOLDOWN_MS,
  OfflineDownloadToasts,
  selectDownloadToastKind,
} from './offline-download-toasts'

const mocks = vi.hoisted(() => ({
  toast: vi.fn(() => ({ id: 'toast-1' })),
  dismiss: vi.fn(),
}))

vi.mock('@/components/ui/use-toast', () => ({
  useToast: () => ({ toast: mocks.toast, dismiss: mocks.dismiss }),
}))

function baseStatus(
  overrides: Partial<SyncStatusSnapshot> = {},
): SyncStatusSnapshot {
  return {
    phase: 'done',
    isOwner: true,
    totalGroups: 3,
    readyGroups: 3,
    currentGroupId: null,
    currentGroupName: null,
    activity: null,
    errors: {},
    lastCompletedFullPassAt: null,
    earliestRetryAt: null,
    lastCatalogAt: null,
    ...overrides,
  }
}

function controllableSync(initial: SyncStatusSnapshot) {
  let status = initial
  const listeners = new Set<() => void>()
  return {
    engine: {
      getStatus: () => status,
      subscribe: (listener: () => void) => {
        listeners.add(listener)
        return () => {
          listeners.delete(listener)
        }
      },
      getLastCompletedFullPassAt: () => status.lastCompletedFullPassAt,
    } as unknown as OfflineSync,
    setStatus: (next: SyncStatusSnapshot) => {
      status = next
      act(() => {
        for (const listener of listeners) listener()
      })
    },
  }
}

function renderWithSync(sync: OfflineSync | null) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <OfflineProvider sync={sync}>
        <OfflineDownloadToasts />
      </OfflineProvider>
    </QueryClientProvider>,
  )
}

let now = 0

describe('selectDownloadToastKind', () => {
  it('toasts only quota-error, failed, and disabled', () => {
    expect(selectDownloadToastKind(null)).toBeNull()
    expect(selectDownloadToastKind(baseStatus({ phase: 'idle' }))).toBeNull()
    expect(
      selectDownloadToastKind(baseStatus({ phase: 'downloading' })),
    ).toBeNull()
    expect(selectDownloadToastKind(baseStatus({ phase: 'done' }))).toBeNull()
    expect(
      selectDownloadToastKind(baseStatus({ phase: 'paused-connectivity' })),
    ).toBeNull()
    expect(
      selectDownloadToastKind(baseStatus({ phase: 'rate-limited' })),
    ).toBeNull()
    expect(selectDownloadToastKind(baseStatus({ phase: 'quota-error' }))).toBe(
      'quota-error',
    )
    expect(selectDownloadToastKind(baseStatus({ phase: 'failed' }))).toBe(
      'needs-update',
    )
    expect(selectDownloadToastKind(baseStatus({ phase: 'disabled' }))).toBe(
      'unavailable',
    )
  })
})

describe('OfflineDownloadToasts', () => {
  beforeEach(() => {
    now = 1_000_000
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    mocks.toast.mockClear()
    mocks.dismiss.mockClear()
    mocks.toast.mockImplementation(() => ({ id: `toast-${now}` }))
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('stays silent without an engine or on healthy/transient phases', () => {
    const silent = renderWithSync(null)
    expect(mocks.toast).not.toHaveBeenCalled()
    silent.unmount()

    for (const phase of [
      'idle',
      'downloading',
      'done',
      'paused-connectivity',
      'rate-limited',
    ] as const) {
      const { engine } = controllableSync(baseStatus({ phase }))
      const view = renderWithSync(engine)
      expect(mocks.toast).not.toHaveBeenCalled()
      view.unmount()
    }
  })

  it('toasts once on entering failed and carries a retry action', () => {
    const { engine, setStatus } = controllableSync(baseStatus())
    const view = renderWithSync(engine)
    expect(mocks.toast).not.toHaveBeenCalled()

    setStatus(baseStatus({ phase: 'failed' }))
    expect(mocks.toast).toHaveBeenCalledTimes(1)
    type ToastCall = {
      variant: string
      description: unknown
      action: { props: { onClick: unknown; children: unknown } }
    }
    const [[firstCall]] = mocks.toast.mock.calls as unknown as [[ToastCall]]
    expect(firstCall.variant).toBe('destructive')
    expect(typeof firstCall.description).toBe('string')
    expect(typeof firstCall.action.props.onClick).toBe('function')

    // Same phase re-render must not re-toast.
    setStatus(baseStatus({ phase: 'failed' }))
    expect(mocks.toast).toHaveBeenCalledTimes(1)
    view.unmount()
  })

  it('dismisses the previous toast on kind switch and on exit', () => {
    const { engine, setStatus } = controllableSync(
      baseStatus({ phase: 'failed' }),
    )
    const view = renderWithSync(engine)
    expect(mocks.toast).toHaveBeenCalledTimes(1)
    const [firstResult] = mocks.toast.mock.results as unknown as [
      { value: { id: string } },
    ]
    const firstId = firstResult.value.id

    setStatus(baseStatus({ phase: 'quota-error' }))
    expect(mocks.dismiss).toHaveBeenCalledWith(firstId)
    expect(mocks.toast).toHaveBeenCalledTimes(2)

    setStatus(baseStatus({ phase: 'done' }))
    expect(mocks.toast).toHaveBeenCalledTimes(2)
    expect(mocks.dismiss).toHaveBeenCalledTimes(2)
    view.unmount()
  })

  it('cools down repeats of the same kind but re-toasts after the window', () => {
    const { engine, setStatus } = controllableSync(
      baseStatus({ phase: 'failed' }),
    )
    const view = renderWithSync(engine)
    expect(mocks.toast).toHaveBeenCalledTimes(1)

    // Exit and re-enter within the cooldown: suppressed.
    setStatus(baseStatus({ phase: 'done' }))
    now += DOWNLOAD_TOAST_COOLDOWN_MS - 1000
    setStatus(baseStatus({ phase: 'failed' }))
    expect(mocks.toast).toHaveBeenCalledTimes(1)

    // After the window: re-toasts.
    setStatus(baseStatus({ phase: 'done' }))
    now += DOWNLOAD_TOAST_COOLDOWN_MS + 1000
    setStatus(baseStatus({ phase: 'failed' }))
    expect(mocks.toast).toHaveBeenCalledTimes(2)
    view.unmount()
  })

  it('toasts once under StrictMode double effects', () => {
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })
    const { engine } = controllableSync(baseStatus({ phase: 'disabled' }))
    const view = render(
      <StrictMode>
        <QueryClientProvider client={client}>
          <OfflineProvider sync={engine}>
            <OfflineDownloadToasts />
          </OfflineProvider>
        </QueryClientProvider>
      </StrictMode>,
    )
    expect(mocks.toast).toHaveBeenCalledTimes(1)
    view.unmount()
  })
})
