import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { httpLink } from '@trpc/client'
import type { PropsWithChildren } from 'react'
import superjson from 'superjson'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AccountDeletionBanner } from '@/components/account-deletion-banner'
import { OfflineBanner } from '@/components/offline-banner'
import { act, render, screen, waitFor } from '@/test/test-utils'
import { trpc } from '@/trpc/client'
import type { AppRouterOutput } from '@spliit/api/router'

type Status = AppRouterOutput['account']['deletionStatus']
const mocks = vi.hoisted(() => ({
  account: { id: 'alice' } as { id: string } | null,
  online: true,
  load: vi.fn<() => Promise<Status>>(),
}))

vi.mock('@/lib/use-current-account', () => ({
  useCurrentAccount: () => ({
    data: mocks.account,
    isPending: false,
    error: null,
  }),
}))
vi.mock('@/lib/use-online-status', () => ({
  useOnlineStatus: () => mocks.online,
  useConnectivityStatus: () => (mocks.online ? 'online' : 'offline'),
}))
vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, ...props }: PropsWithChildren<{ to: string }>) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}))

const pending: Status = {
  request: {
    executeAt: new Date('2026-09-24T12:00:00Z'),
    keepDisplayName: true,
    status: 'PENDING',
  },
}
const clients: QueryClient[] = []

beforeEach(() => {
  mocks.account = { id: 'alice' }
  mocks.online = true
  mocks.load.mockReset().mockResolvedValue({ request: null })
})
afterEach(() => {
  clients.forEach((client) => client.clear())
  clients.length = 0
  vi.useRealTimers()
})

// Exercise the real tRPC observer/cache with an in-memory transport. No HTTP
// server is needed, and the transport does not implement any banner behavior.
function renderNotice(hidden = false, withOffline = false) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  clients.push(queryClient)
  const client = trpc.createClient({
    links: [
      httpLink({
        url: 'https://spliit.test/trpc',
        transformer: superjson,
        fetch: async () => {
          const data = await mocks.load()
          return new Response(
            JSON.stringify({ result: { data: superjson.serialize(data) } }),
            {
              headers: { 'Content-Type': 'application/json' },
            },
          )
        },
      }),
    ],
  })
  function element(isHidden = hidden) {
    return (
      <trpc.Provider client={client} queryClient={queryClient}>
        <QueryClientProvider client={queryClient}>
          {withOffline && <OfflineBanner />}
          <AccountDeletionBanner hidden={isHidden} />
        </QueryClientProvider>
      </trpc.Provider>
    )
  }
  const view = render(element())
  return {
    ...view,
    refresh: () => queryClient.invalidateQueries(),
    rerenderNotice: (isHidden = hidden) => view.rerender(element(isHidden)),
  }
}

describe('account deletion notice', () => {
  it('shows the scheduled date and review link even after the due time', async () => {
    mocks.load.mockResolvedValue(pending)
    renderNotice()
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Account deletion is scheduled for September 24, 2026',
    )
    expect(
      screen.getByRole('link', { name: 'Review or cancel deletion' }),
    ).toHaveAttribute('href', '/account/delete')
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('updates immediately when scheduling, executing, and cancelling invalidate the shared status', async () => {
    const view = renderNotice()
    await waitFor(() => expect(mocks.load).toHaveBeenCalled())
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    mocks.load.mockResolvedValue(pending)
    await act(() => view.refresh())
    expect(await screen.findByRole('status')).toHaveTextContent('is scheduled')
    mocks.load.mockResolvedValue({
      request: { ...pending.request!, status: 'EXECUTING' },
    })
    await act(() => view.refresh())
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(
        'Account deletion has started.',
      ),
    )
    expect(
      screen.getByRole('link', { name: 'View deletion status' }),
    ).toHaveAttribute('href', '/account/delete')
    expect(
      screen.queryByText('Review or cancel deletion'),
    ).not.toBeInTheDocument()
    mocks.load.mockResolvedValue({ request: null })
    await act(() => view.refresh())
    await waitFor(() =>
      expect(screen.queryByRole('status')).not.toBeInTheDocument(),
    )
  })

  it('does not invent a notice before loading succeeds and retains confirmed status after a refresh fails', async () => {
    let resolve!: (value: Status) => void
    mocks.load.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done
        }),
    )
    const view = renderNotice()
    await waitFor(() => expect(mocks.load).toHaveBeenCalled())
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    await act(async () => {
      resolve(pending)
    })
    expect(await screen.findByRole('status')).toHaveTextContent('is scheduled')
    mocks.load.mockRejectedValue(new Error('Unavailable'))
    await act(() => view.refresh())
    expect(screen.getByRole('status')).toHaveTextContent('is scheduled')
  })

  it('hides on authentication pages and when signed out without requesting status', async () => {
    const view = renderNotice(true)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(mocks.load).not.toHaveBeenCalled()
    mocks.account = null
    view.rerenderNotice(false)
    await act(async () => {})
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(mocks.load).not.toHaveBeenCalled()
  })

  it('discards the previous account status and ignores its in-flight response on an account change', async () => {
    mocks.load.mockResolvedValue(pending)
    const view = renderNotice()
    await screen.findByRole('status')
    let resolveOld!: (value: Status) => void
    mocks.load.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolveOld = done
        }),
    )
    void view.refresh()
    await waitFor(() => expect(mocks.load).toHaveBeenCalledTimes(2))
    mocks.load.mockResolvedValue({ request: null })
    mocks.account = { id: 'bob' }
    view.rerenderNotice()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    await waitFor(() => expect(mocks.load).toHaveBeenCalledTimes(3))
    await act(async () => {
      resolveOld(pending)
    })
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    mocks.account = null
    view.rerenderNotice()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('polls idle accounts every 30 seconds and pending requests every 5 seconds, only while visible and online', async () => {
    vi.useFakeTimers()
    const view = renderNotice()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(mocks.load).toHaveBeenCalledTimes(1)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(29_999)
    })
    expect(mocks.load).toHaveBeenCalledTimes(1)
    mocks.load.mockResolvedValue(pending)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(mocks.load).toHaveBeenCalledTimes(2)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4999)
    })
    expect(mocks.load).toHaveBeenCalledTimes(2)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(mocks.load).toHaveBeenCalledTimes(3)
    const visibility = Object.getOwnPropertyDescriptor(
      document,
      'visibilityState',
    )
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden',
    })
    try {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000)
      })
      expect(mocks.load).toHaveBeenCalledTimes(3)
    } finally {
      if (visibility)
        Object.defineProperty(document, 'visibilityState', visibility)
      else Reflect.deleteProperty(document, 'visibilityState')
    }
    mocks.online = false
    view.rerenderNotice()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000)
    })
    expect(mocks.load).toHaveBeenCalledTimes(3)
    mocks.online = true
    view.rerenderNotice()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(mocks.load).toHaveBeenCalledTimes(4)
  })

  it('keeps the confirmed deletion and offline notices visible together without fetching offline', async () => {
    mocks.load.mockResolvedValue(pending)
    const view = renderNotice(false, true)
    await screen.findByText(/Account deletion is scheduled/)
    const calls = mocks.load.mock.calls.length
    mocks.online = false
    view.rerenderNotice()
    expect(screen.getByTestId('offline-banner')).toBeInTheDocument()
    expect(
      screen.getByText(/Account deletion is scheduled/),
    ).toBeInTheDocument()
    await act(() => view.refresh())
    expect(mocks.load).toHaveBeenCalledTimes(calls)
  })
})
