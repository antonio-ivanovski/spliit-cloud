import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { onlineManager } from '@tanstack/react-query'
import {
  act,
  render,
  renderHook,
  screen,
  waitFor,
} from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { AuthAccount } from '@/lib/auth'
import { useCurrentAccount } from '@/lib/use-current-account'

import { createConnectivityStore } from './connectivity'
import { createOfflineLifecycle } from './lifecycle'
import { OfflineProvider, useRevalidateVisiblePermissions } from './provider'
import { createOfflineStore } from './store'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  useSession: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  authClient: {
    getSession: mocks.getSession,
    useSession: mocks.useSession,
  },
}))

function makeAccount(id: string): AuthAccount {
  return {
    id,
    name: `User ${id}`,
    email: `${id}@example.com`,
    image: null,
    emailVerified: true,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
  }
}

function memoryStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() {
      return map.size
    },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => {
      map.delete(key)
    },
    setItem: (key: string, value: string) => {
      map.set(key, value)
    },
  }
}

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
}

describe('OfflineProvider', () => {
  afterEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    try {
      onlineManager.setOnline(true)
    } catch {
      // Ignore.
    }
  })

  it('renders public content while storage is unavailable', async () => {
    mocks.useSession.mockReturnValue({
      data: null,
      error: null,
      isPending: false,
      isRefetching: false,
      refetch: vi.fn(),
    })
    mocks.getSession.mockResolvedValue({ data: null, error: null })
    const storage = createOfflineStore({
      openTimeoutMs: 5,
      openRepository: async () => {
        throw new Error('blocked')
      },
    })
    const connectivity = createConnectivityStore({
      isNavigatorOnline: () => true,
      isVisible: () => true,
    })
    const lifecycle = createOfflineLifecycle({
      readLastAccount: () => null,
      writeLastAccount: () => {},
      clearLastAccount: () => {},
      resolveNamespace: (id) => JSON.stringify(['http://localhost:3001', id]),
      verifySession: async () => ({ kind: 'signed-out' }),
      storage: memoryStorage(),
    })
    const queryClient = makeQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <OfflineProvider
          lifecycle={lifecycle}
          connectivity={connectivity}
          storage={storage}
        >
          <div data-testid="public-page">public content</div>
        </OfflineProvider>
      </QueryClientProvider>,
    )
    // Children render immediately; storage opens in the background.
    expect(screen.getByTestId('public-page')).toBeInTheDocument()
    await waitFor(() => {
      expect(storage.getSnapshot().status).not.toBe('opening')
    })
    expect(screen.getByTestId('public-page')).toBeInTheDocument()
    lifecycle.dispose()
    connectivity.dispose()
    storage.close()
  })

  it('StrictMode mount/unmount balances global listeners', async () => {
    mocks.useSession.mockReturnValue({
      data: null,
      error: null,
      isPending: false,
      isRefetching: false,
      refetch: vi.fn(),
    })
    mocks.getSession.mockResolvedValue({ data: null, error: null })
    // Isolated stores so cross-file default-singleton state cannot leak into
    // listener counts. StrictMode double-mounts effects; all adds must pair
    // with removes on unmount (no repeated registration, no leak).
    const connectivity = createConnectivityStore({
      isNavigatorOnline: () => true,
      isVisible: () => true,
    })
    const lifecycle = createOfflineLifecycle({
      readLastAccount: () => null,
      writeLastAccount: () => {},
      clearLastAccount: () => {},
      resolveNamespace: (id) => JSON.stringify(['http://localhost:3001', id]),
      verifySession: async () => ({ kind: 'signed-out' }),
      storage: memoryStorage(),
    })
    const storage = createOfflineStore({
      openRepository: async () => ({ close: vi.fn() }) as unknown as never,
    })
    const addSpy = vi.spyOn(window, 'addEventListener')
    const removeSpy = vi.spyOn(window, 'removeEventListener')
    const addsBefore = addSpy.mock.calls.length
    const removesBefore = removeSpy.mock.calls.length
    const queryClient = makeQueryClient()
    const { unmount } = render(
      <StrictMode>
        <QueryClientProvider client={queryClient}>
          <OfflineProvider
            lifecycle={lifecycle}
            connectivity={connectivity}
            storage={storage}
          >
            <div>child</div>
          </OfflineProvider>
        </QueryClientProvider>
      </StrictMode>,
    )
    // Provider registers online/offline/focus listeners exactly once per mount
    // (connectivity.start is idempotent; StrictMode double-effects clean up).
    unmount()
    const added = addSpy.mock.calls.length - addsBefore
    const removed = removeSpy.mock.calls.length - removesBefore
    // Every added global listener is removed on unmount — no leak, no repeat.
    expect(added).toBeGreaterThan(0)
    expect(removed).toBe(added)
    addSpy.mockRestore()
    removeSpy.mockRestore()
    lifecycle.dispose()
    connectivity.dispose()
    storage.close()
  })

  it('keeps TanStack online state in agreement with transport', async () => {
    mocks.useSession.mockReturnValue({
      data: { user: makeAccount('a'), session: {} },
      error: null,
      isPending: false,
      isRefetching: false,
      refetch: vi.fn(),
    })
    mocks.getSession.mockResolvedValue({
      data: { user: makeAccount('a') },
      error: null,
    })
    const connectivity = createConnectivityStore({
      isNavigatorOnline: () => true,
      isVisible: () => true,
    })
    const lifecycle = createOfflineLifecycle({
      readLastAccount: () => makeAccount('a'),
      writeLastAccount: () => {},
      clearLastAccount: () => {},
      resolveNamespace: (id) => JSON.stringify(['http://localhost:3001', id]),
      verifySession: async () => ({
        kind: 'verified',
        account: makeAccount('a'),
      }),
      storage: memoryStorage(),
    })
    const storage = createOfflineStore({
      openRepository: async () => ({ close: vi.fn() }) as unknown as never,
    })
    const queryClient = makeQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <OfflineProvider
          lifecycle={lifecycle}
          connectivity={connectivity}
          storage={storage}
        >
          <div>child</div>
        </OfflineProvider>
      </QueryClientProvider>,
    )
    await waitFor(() => {
      expect(onlineManager.isOnline()).toBe(true)
    })
    await act(async () => {
      connectivity.reportNetworkFailure(new TypeError('Failed to fetch'))
    })
    await waitFor(() => {
      expect(onlineManager.isOnline()).toBe(false)
    })
    await act(async () => {
      connectivity.reportNetworkSuccess()
    })
    await waitFor(() => {
      expect(onlineManager.isOnline()).toBe(true)
    })
    lifecycle.dispose()
    connectivity.dispose()
    storage.close()
  })

  it('forwards UNAUTHORIZED query failures to verification, ignores FORBIDDEN (P1-1)', async () => {
    mocks.useSession.mockReturnValue({
      data: null,
      error: null,
      isPending: false,
      isRefetching: false,
      refetch: vi.fn(),
    })
    const connectivity = createConnectivityStore({
      isNavigatorOnline: () => true,
      isVisible: () => true,
    })
    const lifecycle = createOfflineLifecycle({
      readLastAccount: () => null,
      writeLastAccount: () => {},
      clearLastAccount: () => {},
      resolveNamespace: (id) => JSON.stringify(['http://localhost:3001', id]),
      verifySession: async () => ({ kind: 'signed-out' }),
      storage: memoryStorage(),
    })
    const storage = createOfflineStore({
      openRepository: async () => ({ close: vi.fn() }) as unknown as never,
    })
    const queryClient = makeQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <OfflineProvider
          lifecycle={lifecycle}
          connectivity={connectivity}
          storage={storage}
        >
          <div>child</div>
        </OfflineProvider>
      </QueryClientProvider>,
    )
    // Wait for cold-start bootstrap verification to settle.
    await waitFor(() => {
      expect(lifecycle.getSnapshot().verifyAttempt).toBeGreaterThan(0)
    })
    const baseline = lifecycle.getSnapshot().verifyAttempt

    await act(async () => {
      await queryClient
        .fetchQuery({
          queryKey: ['p1-unauthorized'],
          queryFn: async () => {
            throw { data: { code: 'UNAUTHORIZED' } }
          },
          retry: false,
        })
        .catch(() => undefined)
    })
    await waitFor(() => {
      expect(lifecycle.getSnapshot().verifyAttempt).toBeGreaterThan(baseline)
    })
    const afterUnauthorized = lifecycle.getSnapshot().verifyAttempt

    await act(async () => {
      await queryClient
        .fetchQuery({
          queryKey: ['p1-forbidden'],
          queryFn: async () => {
            throw { data: { code: 'FORBIDDEN' } }
          },
          retry: false,
        })
        .catch(() => undefined)
    })
    // Give any erroneous verification a chance to run, then assert exclusion.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50))
    })
    expect(lifecycle.getSnapshot().verifyAttempt).toBe(afterUnauthorized)

    lifecycle.dispose()
    connectivity.dispose()
    storage.close()
  })

  it('forwards useSession UNAUTHORIZED errors to verification, ignores FORBIDDEN (P1-1)', async () => {
    mocks.useSession.mockReturnValue({
      data: null,
      error: null,
      isPending: false,
      isRefetching: false,
      refetch: vi.fn(),
    })
    const connectivity = createConnectivityStore({
      isNavigatorOnline: () => true,
      isVisible: () => true,
    })
    const lifecycle = createOfflineLifecycle({
      readLastAccount: () => null,
      writeLastAccount: () => {},
      clearLastAccount: () => {},
      resolveNamespace: (id) => JSON.stringify(['http://localhost:3001', id]),
      verifySession: async () => ({ kind: 'signed-out' }),
      storage: memoryStorage(),
    })
    const storage = createOfflineStore({
      openRepository: async () => ({ close: vi.fn() }) as unknown as never,
    })
    const queryClient = makeQueryClient()
    function Probe() {
      useCurrentAccount()
      return <div>probe</div>
    }
    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <OfflineProvider
          lifecycle={lifecycle}
          connectivity={connectivity}
          storage={storage}
        >
          <Probe />
        </OfflineProvider>
      </QueryClientProvider>,
    )
    await waitFor(() => {
      expect(lifecycle.getSnapshot().verifyAttempt).toBeGreaterThan(0)
    })
    const baseline = lifecycle.getSnapshot().verifyAttempt

    mocks.useSession.mockReturnValue({
      data: null,
      error: { data: { code: 'UNAUTHORIZED' } },
      isPending: false,
      isRefetching: false,
      refetch: vi.fn(),
    })
    rerender(
      <QueryClientProvider client={queryClient}>
        <OfflineProvider
          lifecycle={lifecycle}
          connectivity={connectivity}
          storage={storage}
        >
          <Probe />
        </OfflineProvider>
      </QueryClientProvider>,
    )
    await waitFor(() => {
      expect(lifecycle.getSnapshot().verifyAttempt).toBeGreaterThan(baseline)
    })
    const afterUnauthorized = lifecycle.getSnapshot().verifyAttempt

    mocks.useSession.mockReturnValue({
      data: null,
      error: { data: { code: 'FORBIDDEN' } },
      isPending: false,
      isRefetching: false,
      refetch: vi.fn(),
    })
    rerender(
      <QueryClientProvider client={queryClient}>
        <OfflineProvider
          lifecycle={lifecycle}
          connectivity={connectivity}
          storage={storage}
        >
          <Probe />
        </OfflineProvider>
      </QueryClientProvider>,
    )
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50))
    })
    expect(lifecycle.getSnapshot().verifyAttempt).toBe(afterUnauthorized)

    lifecycle.dispose()
    connectivity.dispose()
    storage.close()
  })

  it('revalidates visible permissions without touching offline downloads (P1-4)', async () => {
    const queryClient = makeQueryClient()
    let groupsGetCalls = 0
    let offlineCalls = 0
    // tRPC-like permission query (groups.get) and an offline download query.
    await queryClient.fetchQuery({
      queryKey: [['groups', 'get'], { groupId: 'g1' }, 'query'],
      queryFn: async () => {
        groupsGetCalls += 1
        return { group: { id: 'g1' } }
      },
    })
    await queryClient.fetchQuery({
      queryKey: ['offline', 'ns', 1, 'group', 'g1'],
      queryFn: async () => {
        offlineCalls += 1
        return { status: 'ready' }
      },
    })
    expect(groupsGetCalls).toBe(1)
    expect(offlineCalls).toBe(1)

    function Wrapper({ children }: { children: React.ReactNode }) {
      return (
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      )
    }
    const { result } = renderHook(() => useRevalidateVisiblePermissions(), {
      wrapper: Wrapper,
    })
    expect(result.current.isRevalidating).toBe(false)
    await act(async () => {
      await result.current.revalidate({ groupId: 'g1' })
    })
    // Visible permission refetched (server authoritative); offline download
    // keys never block the revalidated screen.
    expect(groupsGetCalls).toBeGreaterThan(1)
    expect(offlineCalls).toBe(1)
    expect(result.current.isRevalidating).toBe(false)
  })
})
