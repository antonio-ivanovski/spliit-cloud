import { describe, expect, it, vi } from 'vitest'

import { reportNetworkFailure } from '@/lib/connectivity'
import {
  useCurrentAccount,
  type UseCurrentAccountResult,
} from '@/lib/use-current-account'
import { render, screen } from '@/test/test-utils'

// ── Module mocks ────────────────────────────────────────────────────────

const { mockNavigate: _mockNavigate } = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  Navigate: ({
    to,
    search,
  }: {
    to: string
    search?: Record<string, string>
  }) => (
    <div
      data-testid="navigate"
      data-to={to}
      data-search={JSON.stringify(search ?? {})}
    />
  ),
}))

vi.mock('@/lib/use-current-account', () => ({
  useCurrentAccount: vi.fn(),
}))

// ── SUT ─────────────────────────────────────────────────────────────────

import { RequireAuth } from '@/components/require-auth'

// ── Tests ───────────────────────────────────────────────────────────────

describe('RequireAuth', () => {
  afterEach(() => {
    vi.clearAllMocks()
    window.sessionStorage.clear()
    window.history.replaceState(null, '', '/')
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: true,
    })
  })

  it('shows loading spinner when isPending', () => {
    vi.mocked(useCurrentAccount).mockReturnValue({
      data: null,
      isPending: true,
      isRefetching: false,
      error: null,
      refetch: vi.fn(),
    })

    const { container } = render(
      <RequireAuth>
        <div data-testid="child">protected content</div>
      </RequireAuth>,
    )

    // The spinner is a Loader2 icon wrapped in a flex container
    const spinner = container.querySelector('.animate-spin')
    expect(spinner).toBeInTheDocument()
    expect(screen.queryByTestId('child')).not.toBeInTheDocument()
  })

  it('renders children when account is authenticated and has a display name', () => {
    vi.mocked(useCurrentAccount).mockReturnValue({
      data: {
        id: 'user-1',
        name: 'Alice',
        email: 'alice@example.com',
        image: null,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      isPending: false,
      isRefetching: false,
      error: null,
      refetch: vi.fn(),
    })

    render(
      <RequireAuth>
        <div data-testid="child">protected content</div>
      </RequireAuth>,
    )

    expect(screen.getByTestId('child')).toHaveTextContent('protected content')
    expect(screen.queryByTestId('navigate')).not.toBeInTheDocument()
  })

  it('redirects to / with redirect search when no account', () => {
    vi.mocked(useCurrentAccount).mockReturnValue({
      data: null,
      isPending: false,
      isRefetching: false,
      error: null,
      refetch: vi.fn(),
    })

    // currentPathWithSearch uses window.location
    const _originalLocation = window.location
    // We can't easily stub window.location.pathname without losing the
    // reference, so we just check that Navigate is rendered with to="/"
    // and that a redirect parameter is present in search.

    render(
      <RequireAuth>
        <div data-testid="child">protected content</div>
      </RequireAuth>,
    )

    const navigate = screen.getByTestId('navigate')
    expect(navigate).toHaveAttribute('data-to', '/')
    expect(navigate.getAttribute('data-search')).toContain('redirect')
    expect(screen.queryByTestId('child')).not.toBeInTheDocument()
  })

  it('shows the offline empty state instead of redirecting when offline', () => {
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: false,
    })
    vi.mocked(useCurrentAccount).mockReturnValue({
      data: null,
      isPending: false,
      isRefetching: false,
      error: new TypeError(
        'Failed to fetch',
      ) as UseCurrentAccountResult['error'],
      refetch: vi.fn(),
    })

    render(
      <RequireAuth>
        <div data-testid="child">protected content</div>
      </RequireAuth>,
    )

    expect(screen.getByTestId('offline-empty-state')).toBeInTheDocument()
    expect(screen.queryByTestId('navigate')).not.toBeInTheDocument()
    expect(screen.queryByTestId('child')).not.toBeInTheDocument()
  })

  it('shows the offline empty state when get-session fails and navigator.onLine is still true', () => {
    reportNetworkFailure(new TypeError('Failed to fetch'))
    vi.mocked(useCurrentAccount).mockReturnValue({
      data: null,
      isPending: false,
      isRefetching: false,
      error: new TypeError(
        'Failed to fetch',
      ) as UseCurrentAccountResult['error'],
      refetch: vi.fn(),
    })

    render(
      <RequireAuth>
        <div data-testid="child">protected content</div>
      </RequireAuth>,
    )

    expect(screen.getByTestId('offline-empty-state')).toBeInTheDocument()
    expect(screen.queryByTestId('navigate')).not.toBeInTheDocument()
  })

  it('redirects signed-out group visits that have no viewKey or invite param', () => {
    vi.mocked(useCurrentAccount).mockReturnValue({
      data: null,
      isPending: false,
      isRefetching: false,
      error: null,
      refetch: vi.fn(),
    })
    window.history.replaceState(null, '', '/groups/group-1')

    render(
      <RequireAuth>
        <div data-testid="child">group</div>
      </RequireAuth>,
    )
    const navigate = screen.getByTestId('navigate')
    expect(navigate).toHaveAttribute('data-to', '/')
    expect(navigate.getAttribute('data-search')).toContain('redirect')
    expect(screen.queryByTestId('child')).not.toBeInTheDocument()
  })

  it('lets signed-out visitors through when the URL has a viewKey', () => {
    vi.mocked(useCurrentAccount).mockReturnValue({
      data: null,
      isPending: false,
      isRefetching: false,
      error: null,
      refetch: vi.fn(),
    })
    window.history.replaceState(
      null,
      '',
      '/groups/group-1?viewKey=public-secret',
    )

    render(
      <RequireAuth>
        <div data-testid="child">group</div>
      </RequireAuth>,
    )
    expect(screen.getByTestId('child')).toBeInTheDocument()
  })

  it('lets signed-out visitors through when the URL has an invite token', () => {
    vi.mocked(useCurrentAccount).mockReturnValue({
      data: null,
      isPending: false,
      isRefetching: false,
      error: null,
      refetch: vi.fn(),
    })
    window.history.replaceState(null, '', '/groups/group-1?invite=invite-token')

    render(
      <RequireAuth>
        <div data-testid="child">group</div>
      </RequireAuth>,
    )
    expect(screen.getByTestId('child')).toBeInTheDocument()
  })

  it('redirects to complete-profile when account has no name', () => {
    vi.mocked(useCurrentAccount).mockReturnValue({
      data: {
        id: 'user-1',
        name: '',
        email: 'alice@example.com',
        image: null,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      isPending: false,
      isRefetching: false,
      error: null,
      refetch: vi.fn(),
    })

    render(
      <RequireAuth>
        <div data-testid="child">protected content</div>
      </RequireAuth>,
    )

    const navigate = screen.getByTestId('navigate')
    expect(navigate).toHaveAttribute('data-to', '/auth/complete-profile')
    expect(navigate.getAttribute('data-search')).toContain('redirect')
    expect(screen.queryByTestId('child')).not.toBeInTheDocument()
  })

  it('redirects to complete-profile when name equals email', () => {
    vi.mocked(useCurrentAccount).mockReturnValue({
      data: {
        id: 'user-1',
        name: 'alice@example.com',
        email: 'alice@example.com',
        image: null,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      isPending: false,
      isRefetching: false,
      error: null,
      refetch: vi.fn(),
    })

    render(
      <RequireAuth>
        <div data-testid="child">protected content</div>
      </RequireAuth>,
    )

    const navigate = screen.getByTestId('navigate')
    expect(navigate).toHaveAttribute('data-to', '/auth/complete-profile')
    expect(screen.queryByTestId('child')).not.toBeInTheDocument()
  })
})
