import { render, screen } from '@/test/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { useCurrentAccount } from '@/lib/use-current-account'

// ── Module mocks ────────────────────────────────────────────────────────

vi.mock('@/lib/use-current-account', () => ({
  useCurrentAccount: vi.fn(),
}))

vi.mock('@/lib/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}))

// Mock @tanstack/react-router for Link and navigation
vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, ...props }: { to: string; children: React.ReactNode; [key: string]: unknown }) => (
    <a href={to} {...props}>{children}</a>
  ),
  useNavigate: () => vi.fn(),
  getRouteApi: () => ({
    useSearch: () => ({ redirect: undefined, mode: undefined, email: undefined }),
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
  RecentGroupList: () => <div data-testid="recent-group-list">Recent groups</div>,
}))

// ── SUT ─────────────────────────────────────────────────────────────────

import HomePage from '@/app/page'

// ── Tests ───────────────────────────────────────────────────────────────

describe('HomePage (signed-out)', () => {
  afterEach(() => {
    vi.clearAllMocks()
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

  it('shows 6 features (accounts, groupsSync, expenses, splitting, settlement, organization)', () => {
    vi.mocked(useCurrentAccount).mockReturnValue({
      data: null,
      isPending: false,
      isRefetching: false,
      error: null,
      refetch: vi.fn(),
    })

    render(<HomePage />)

    expect(screen.getByText('Accounts')).toBeInTheDocument()
    expect(screen.getByText('Groups + sync')).toBeInTheDocument()
    expect(screen.getByText('Expenses + receipts')).toBeInTheDocument()
    expect(screen.getByText('Advanced split')).toBeInTheDocument()
    expect(screen.getByText('Balances')).toBeInTheDocument()
    expect(screen.getByText('Categories')).toBeInTheDocument()
  })

  it('shows Create Group and Import Group buttons in signed-in view', () => {
    // These buttons are only in SignedInHero (signed-in path)
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

    expect(screen.getByText('Create a group')).toBeInTheDocument()
    expect(screen.getByText('Import group from another service')).toBeInTheDocument()
  })
})

describe('HomePage (signed-in)', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('shows welcome back with account name', () => {
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

    expect(screen.getByText('Welcome back, Alice.')).toBeInTheDocument()
  })

  it('shows create group button', () => {
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

    expect(screen.getByText('Create a group')).toBeInTheDocument()
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
