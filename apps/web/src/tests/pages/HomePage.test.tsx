import { afterEach, describe, expect, it, vi } from 'vitest'

import { useCurrentAccount } from '@/lib/use-current-account'
import { act, render, screen } from '@/test/test-utils'

// ── Module mocks ────────────────────────────────────────────────────────

vi.mock('@/lib/use-current-account', () => ({
  useCurrentAccount: vi.fn(),
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
  getRouteApi: () => ({
    useSearch: () => ({
      redirect: undefined,
      mode: undefined,
      email: undefined,
    }),
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
  AuthPanel: () => <div data-testid="auth-panel">Sign in content</div>,
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

// ── Tests ───────────────────────────────────────────────────────────────

describe('HomePage (signed-out)', () => {
  afterEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
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
})

describe('HomePage (signed-in)', () => {
  afterEach(() => {
    vi.clearAllMocks()
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
})
