import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  reportNetworkFailure,
  resetConnectivityForTests,
} from '@/lib/connectivity'
import { DEVICE_SAVED_VIEWS_KEY } from '@/lib/saved-view-groups'
import {
  useCurrentAccount,
  type UseCurrentAccountResult,
} from '@/lib/use-current-account'
import { act, render, screen } from '@/test/test-utils'

// ── Module mocks ────────────────────────────────────────────────────────

const { mockHomeSearch, mockAnnouncementsListQuery, mockOnboardingQuery } =
  vi.hoisted(() => ({
    mockHomeSearch: {
      redirect: undefined as string | undefined,
      invite: undefined as string | undefined,
      viewKey: undefined as string | undefined,
      invitation: undefined as string | undefined,
    },
    mockAnnouncementsListQuery: vi.fn(),
    mockOnboardingQuery: {
      data: undefined as { anonymousOnboardingCompleted: boolean } | undefined,
      isPending: false,
      isFetching: false,
      refetch: vi.fn(),
    },
  }))

vi.mock('@/lib/use-current-account', () => ({
  useCurrentAccount: vi.fn(),
}))

vi.mock('@/trpc/client', () => ({
  trpc: {
    announcements: {
      list: {
        useQuery: mockAnnouncementsListQuery,
      },
    },
    account: {
      onboardingStatus: {
        useQuery: () => mockOnboardingQuery,
      },
    },
  },
}))

// Mock @tanstack/react-router for Link and navigation
vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    children,
    ...props
  }: {
    to: string
    children: React.ReactNode
    [key: string]: unknown
  }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
  useNavigate: () => vi.fn(),
  Navigate: ({
    to,
    search,
    hash,
  }: {
    to: string
    search?: Record<string, string>
    hash?: string
  }) => (
    <div
      data-testid="home-redirect"
      data-to={to}
      data-search={search ? JSON.stringify(search) : undefined}
      data-hash={hash}
    />
  ),
  getRouteApi: () => ({
    useSearch: () => mockHomeSearch,
  }),
}))

vi.mock('@/lib/auth', () => ({
  authClient: {
    signIn: { email: vi.fn(), magicLink: vi.fn(), social: vi.fn() },
    signUp: { email: vi.fn() },
    useSession: vi.fn(),
    getSession: vi.fn(),
  },
}))

// Mock AuthPanel to avoid its complex dependencies
vi.mock('@/components/auth/auth-panel', () => ({
  AuthPanel: ({ redirectTo }: { redirectTo?: string }) => (
    <div data-testid="auth-panel" data-redirect-to={redirectTo ?? ''}>
      Sign in content
    </div>
  ),
}))

// Mock RecentGroupList to avoid tRPC
vi.mock('@/app/groups/recent-group-list', () => ({
  RecentGroupList: () => (
    <div data-testid="recent-group-list">Recent groups</div>
  ),
}))

// ── SUT ─────────────────────────────────────────────────────────────────

import HomePage from '@/app/page'
import { LANDING_FIRST_SPEECH_MS } from '@/components/mascot/use-landing-mascot'

// Default: updates query still loading → teaser hidden, so existing tests are
// unaffected unless they opt in by setting list data.
mockAnnouncementsListQuery.mockReturnValue({ data: undefined })

// ── Tests ───────────────────────────────────────────────────────────────

describe('HomePage (signed-out)', () => {
  afterEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
    mockHomeSearch.redirect = undefined
    mockHomeSearch.invite = undefined
    mockHomeSearch.viewKey = undefined
    mockHomeSearch.invitation = undefined
    mockOnboardingQuery.data = undefined
    mockOnboardingQuery.isPending = false
    mockOnboardingQuery.isFetching = false
    window.localStorage.removeItem(DEVICE_SAVED_VIEWS_KEY)
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: true,
    })
    resetConnectivityForTests()
  })

  it('renders home page with title and description', () => {
    vi.mocked(useCurrentAccount).mockReturnValue({
      data: null,
      isPending: false,
      isRefetching: false,
      error: null,
      refetch: vi.fn(),
    })

    const { container } = render(<HomePage />)

    // The title has "Share Expenses with Friends & Family" with HTML interleaved
    expect(container.textContent).toContain('Share')
    expect(container.textContent).toContain('Expenses')
    expect(container.textContent).toContain('Friends & Family')
    // Description is rendered
    expect(container.textContent).toContain(
      'Track shared expenses and settle up.',
    )
  })

  it('links the signed-out landing to the features page', () => {
    vi.mocked(useCurrentAccount).mockReturnValue({
      data: null,
      isPending: false,
      isRefetching: false,
      error: null,
      refetch: vi.fn(),
    })

    render(<HomePage />)

    expect(screen.getByTestId('landing-features-link')).toHaveAttribute(
      'href',
      '/features',
    )
  })

  it('shows AuthPanel / sign-in card', () => {
    vi.mocked(useCurrentAccount).mockReturnValue({
      data: null,
      isPending: false,
      isRefetching: false,
      error: null,
      refetch: vi.fn(),
    })

    render(<HomePage />)

    expect(screen.getByTestId('auth-panel')).toBeInTheDocument()
  })

  it('keeps the marketing landing and sign-in card when offline', () => {
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

    const { container } = render(<HomePage />)

    expect(container.textContent).toContain('Share')
    expect(screen.getByTestId('landing-bill')).toBeInTheDocument()
    expect(screen.getByTestId('auth-panel')).toBeInTheDocument()
    expect(screen.queryByTestId('offline-empty-state')).not.toBeInTheDocument()
  })

  it('shows a pending shell while a signed-out session is still resolving', () => {
    vi.mocked(useCurrentAccount).mockReturnValue({
      data: null,
      isPending: true,
      isRefetching: false,
      error: null,
      refetch: vi.fn(),
    })

    render(<HomePage />)

    expect(screen.queryByTestId('auth-panel')).not.toBeInTheDocument()
    expect(screen.queryByTestId('landing-bill')).not.toBeInTheDocument()
    expect(screen.queryByTestId('recent-group-list')).not.toBeInTheDocument()
    expect(screen.queryByTestId('offline-empty-state')).not.toBeInTheDocument()
  })

  it('shows the dashboard from a cached account while get-session is pending', () => {
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
      isPending: true,
      isRefetching: false,
      error: null,
      refetch: vi.fn(),
    })

    render(<HomePage />)

    expect(screen.getByTestId('recent-group-list')).toBeInTheDocument()
    expect(screen.queryByTestId('auth-panel')).not.toBeInTheDocument()
  })

  it('shows the landing when get-session fails and navigator.onLine is still true', () => {
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

    render(<HomePage />)

    expect(screen.getByTestId('auth-panel')).toBeInTheDocument()
    expect(screen.queryByTestId('offline-empty-state')).not.toBeInTheDocument()
  })

  it('keeps the marketing landing and opens saved groups from a subtle action', async () => {
    window.localStorage.setItem(
      DEVICE_SAVED_VIEWS_KEY,
      JSON.stringify([
        {
          groupId: 'group-1',
          viewKey: 'secret',
          name: 'Cabin trip',
          memberCount: 3,
          lastOpenedAt: '2026-08-01T00:00:00.000Z',
        },
      ]),
    )
    vi.mocked(useCurrentAccount).mockReturnValue({
      data: null,
      isPending: false,
      isRefetching: false,
      error: null,
      refetch: vi.fn(),
    })

    const { user } = render(<HomePage />)

    expect(screen.getByTestId('landing-bill')).toBeInTheDocument()
    expect(screen.getByTestId('auth-panel')).toBeInTheDocument()
    expect(screen.queryByText('Cabin trip')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'View saved groups' }))
    expect(screen.getByText('Cabin trip')).toBeInTheDocument()
    expect(screen.getByText('View-only')).toBeInTheDocument()
  })

  it('shows Bill in the landing content instead of feature cards', async () => {
    vi.mocked(useCurrentAccount).mockReturnValue({
      data: null,
      isPending: false,
      isRefetching: false,
      error: null,
      refetch: vi.fn(),
    })

    const { user } = render(<HomePage />)

    const bill = screen.getByTestId('landing-bill')
    expect(bill).toBeInTheDocument()
    expect(bill.closest('.motion-stagger')).toBeNull()
    expect(bill.querySelector('svg')?.getAttribute('class')).not.toMatch(
      /transition-transform/,
    )
    expect(screen.queryByTestId('bill-mascot-trigger')).toBeNull()
    expect(screen.queryByText('Accounts')).not.toBeInTheDocument()
    expect(screen.queryByText('Groups + sync')).not.toBeInTheDocument()

    await user.click(screen.getByTestId('landing-bill'))
    const speech = screen.getByTestId('landing-bill-speech')
    expect(speech).toHaveTextContent(
      'Hi — I help split expenses once you sign in.',
    )
    expect(speech.className).toContain('absolute')
    expect(speech.className).not.toContain('-translate-y-full')
    expect(speech.querySelector('[data-mascot-speech-tail]')).not.toBeNull()
  })

  it('speaks unsolicited after a long idle delay without shifting Bill', () => {
    vi.useFakeTimers()
    vi.mocked(useCurrentAccount).mockReturnValue({
      data: null,
      isPending: false,
      isRefetching: false,
      error: null,
      refetch: vi.fn(),
    })

    render(<HomePage />)
    const bill = screen.getByTestId('landing-bill')
    const before = bill.getBoundingClientRect()
    expect(screen.queryByTestId('landing-bill-speech')).toBeNull()

    act(() => {
      vi.advanceTimersByTime(LANDING_FIRST_SPEECH_MS)
    })

    const speech = screen.getByTestId('landing-bill-speech')
    expect(speech).toBeInTheDocument()
    expect(speech.className).toContain('absolute')
    expect(bill.getBoundingClientRect().top).toBe(before.top)
  })

  it('does not render the authenticated marketing hero', () => {
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

    render(<HomePage />)

    expect(screen.queryByText('Share')).not.toBeInTheDocument()
    expect(screen.getByTestId('recent-group-list')).toBeInTheDocument()
  })

  it('shows a teaser for the latest update on the signed-out landing', () => {
    vi.mocked(useCurrentAccount).mockReturnValue({
      data: null,
      isPending: false,
      isRefetching: false,
      error: null,
      refetch: vi.fn(),
    })
    mockAnnouncementsListQuery.mockReturnValue({
      data: [
        { id: 'unknown-older-id', date: '2026-09-01' },
        { id: 'spliit-cloud-2-5-0', date: '2026-10-05' },
      ],
    })

    render(<HomePage />)

    const teaser = screen.getByTestId('landing-updates')
    expect(teaser).toBeInTheDocument()
    expect(teaser).toHaveTextContent("What's new")
    // Latest entry only, with its title, excerpt, a link to its detail page,
    // and a link to /updates.
    expect(teaser).toHaveTextContent('Spliit Cloud 2.5.0 is here')
    expect(teaser).toHaveTextContent('Spliit Cloud 2.5.0 is out')
    expect(
      screen.getByRole('link', { name: 'See all updates' }),
    ).toHaveAttribute('href', '/updates')
    expect(
      screen.getByRole('link', { name: 'Spliit Cloud 2.5.0 is here' }),
    ).toHaveAttribute('href', '/updates/$announcementId')
  })

  it('hides the updates teaser while updates are loading', () => {
    vi.mocked(useCurrentAccount).mockReturnValue({
      data: null,
      isPending: false,
      isRefetching: false,
      error: null,
      refetch: vi.fn(),
    })
    mockAnnouncementsListQuery.mockReturnValue({ data: undefined })

    render(<HomePage />)

    expect(screen.queryByTestId('landing-updates')).not.toBeInTheDocument()
  })

  it('hides the updates teaser when there are no updates', () => {
    vi.mocked(useCurrentAccount).mockReturnValue({
      data: null,
      isPending: false,
      isRefetching: false,
      error: null,
      refetch: vi.fn(),
    })
    mockAnnouncementsListQuery.mockReturnValue({ data: [] })

    render(<HomePage />)

    expect(screen.queryByTestId('landing-updates')).not.toBeInTheDocument()
  })
})

describe('HomePage (signed-in)', () => {
  afterEach(() => {
    vi.clearAllMocks()
    mockHomeSearch.redirect = undefined
    mockHomeSearch.invite = undefined
    mockHomeSearch.viewKey = undefined
    mockHomeSearch.invitation = undefined
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: true,
    })
    resetConnectivityForTests()
  })

  it('does not show the signed-in marketing title', () => {
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

    render(<HomePage />)

    expect(screen.queryByText('Share')).not.toBeInTheDocument()
  })

  it('shows RecentGroupList container', () => {
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

    render(<HomePage />)

    expect(screen.getByTestId('recent-group-list')).toBeInTheDocument()
  })

  it('does not show the updates teaser on the signed-in dashboard', () => {
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
    mockAnnouncementsListQuery.mockReturnValue({
      data: [{ id: 'spliit-cloud-2-5-0', date: '2026-10-05' }],
    })

    render(<HomePage />)

    expect(screen.getByTestId('recent-group-list')).toBeInTheDocument()
    expect(screen.queryByTestId('landing-updates')).not.toBeInTheDocument()
  })

  it('hands the invite-bearing redirect to the AuthPanel explicitly', () => {
    mockHomeSearch.redirect = '/groups/grp-1?invite=invite-token'
    vi.mocked(useCurrentAccount).mockReturnValue({
      data: null,
      isPending: false,
      isRefetching: false,
      error: null,
      refetch: vi.fn(),
    })

    render(<HomePage />)

    // The panel must not depend on ambient route search: the redirect (with
    // the invite token) is passed as a prop so every auth callback after
    // sign-in returns to the group invite, never to a bare `/`.
    expect(screen.getByTestId('auth-panel')).toHaveAttribute(
      'data-redirect-to',
      '/groups/grp-1?invite=invite-token',
    )
  })

  it('continues an authenticated visitor to the preserved destination', () => {
    mockHomeSearch.redirect = '/groups/grp-1?invite=invite-token'
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

    render(<HomePage />)

    // The destination splits into pathname + search object so the query
    // encodes exactly once (query-in-`to` would serialize verbatim and grow
    // `?invite=T` on every lap — the mangled-URL bug).
    expect(screen.getByTestId('home-redirect')).toHaveAttribute(
      'data-to',
      '/groups/grp-1',
    )
    expect(screen.getByTestId('home-redirect')).toHaveAttribute(
      'data-search',
      JSON.stringify({ invite: 'invite-token' }),
    )
    expect(
      screen.getByTestId('home-redirect').getAttribute('data-hash'),
    ).toBeNull()
  })

  it('resolves structured bounce params into the panel destination', () => {
    mockHomeSearch.redirect = '/groups/grp-1'
    mockHomeSearch.invite = 'structured-token'
    vi.mocked(useCurrentAccount).mockReturnValue({
      data: null,
      isPending: false,
      isRefetching: false,
      error: null,
      refetch: vi.fn(),
    })

    render(<HomePage />)

    // The token rides as a first-class param, not nested in `redirect`.
    expect(screen.getByTestId('auth-panel')).toHaveAttribute(
      'data-redirect-to',
      '/groups/grp-1?invite=structured-token',
    )
  })

  it('renders the dashboard instead of self-bouncing on a bare home return', () => {
    mockHomeSearch.invite = 'orphan-token'
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

    render(<HomePage />)

    // No `redirect` and a `/` destination: navigating would self-loop, so the
    // dashboard renders instead of a `/?redirect=%2F` bounce.
    expect(screen.getByTestId('recent-group-list')).toBeInTheDocument()
    expect(screen.queryByTestId('home-redirect')).not.toBeInTheDocument()
  })

  it('holds the pending shell while bounce params settle', () => {
    mockHomeSearch.redirect = '/groups/grp-1'
    mockHomeSearch.invite = 'settling-token'
    mockOnboardingQuery.isPending = true
    mockOnboardingQuery.isFetching = true
    vi.mocked(useCurrentAccount).mockReturnValue({
      data: {
        id: 'guest-1',
        name: 'New Guest',
        email: 'guest-1@anonymous.placeholder.local',
        isAnonymous: true,
        image: null,
        emailVerified: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      isPending: false,
      isRefetching: false,
      error: null,
      refetch: vi.fn(),
    })

    const { container } = render(<HomePage />)

    // Navigating before the authoritative safeguard verdict lands flaps `/`
    // against `/auth/complete-profile` on every session emission (the
    // "slowing down Firefox" race). The URL keeps escrowing the token, so
    // holding the shell sheds nothing.
    expect(screen.queryByTestId('home-redirect')).not.toBeInTheDocument()
    expect(screen.queryByTestId('recent-group-list')).not.toBeInTheDocument()
    expect(container.querySelector('[aria-busy="true"]')).toBeInTheDocument()
  })
})
