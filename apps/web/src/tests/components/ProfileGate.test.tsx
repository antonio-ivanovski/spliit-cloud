import { render, screen } from '@/test/test-utils'
import { describe, expect, it, vi } from 'vitest'

// ── Module mocks ────────────────────────────────────────────────────────

let mockCurrentPath = '/'

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
  useRouterState: () => ({
    location: { pathname: mockCurrentPath },
  }),
}))

vi.mock('@/lib/use-current-account', () => ({
  useCurrentAccount: vi.fn(),
}))

// ── SUT ─────────────────────────────────────────────────────────────────

import { ProfileGate } from '@/components/profile-gate'
import { useCurrentAccount } from '@/lib/use-current-account'
import { type Mock } from 'vitest'

// ── Tests ───────────────────────────────────────────────────────────────

describe('ProfileGate', () => {
  afterEach(() => {
    vi.clearAllMocks()
    mockCurrentPath = '/'
  })

  it('shows loading spinner while account is pending', () => {
    ;(useCurrentAccount as Mock).mockReturnValue({
      data: null,
      isPending: true,
    })

    const { container } = render(
      <ProfileGate>
        <div data-testid="child">content</div>
      </ProfileGate>,
    )

    const spinner = container.querySelector('.animate-spin')
    expect(spinner).toBeInTheDocument()
    expect(screen.queryByTestId('child')).not.toBeInTheDocument()
  })

  it('renders children when no account (signed out)', () => {
    ;(useCurrentAccount as Mock).mockReturnValue({
      data: null,
      isPending: false,
    })

    render(
      <ProfileGate>
        <div data-testid="child">content</div>
      </ProfileGate>,
    )

    expect(screen.getByTestId('child')).toHaveTextContent('content')
  })

  it('renders children when account has a display name', () => {
    ;(useCurrentAccount as Mock).mockReturnValue({
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
    })

    render(
      <ProfileGate>
        <div data-testid="child">content</div>
      </ProfileGate>,
    )

    expect(screen.getByTestId('child')).toHaveTextContent('content')
    expect(screen.queryByTestId('navigate')).not.toBeInTheDocument()
  })

  it('redirects to complete-profile when account has no name', () => {
    ;(useCurrentAccount as Mock).mockReturnValue({
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
    })

    render(
      <ProfileGate>
        <div data-testid="child">content</div>
      </ProfileGate>,
    )

    const navigate = screen.getByTestId('navigate')
    expect(navigate).toHaveAttribute('data-to', '/auth/complete-profile')
    expect(navigate.getAttribute('data-search')).toContain('redirect')
  })

  it('redirects to complete-profile when name equals email', () => {
    ;(useCurrentAccount as Mock).mockReturnValue({
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
    })

    render(
      <ProfileGate>
        <div data-testid="child">content</div>
      </ProfileGate>,
    )

    const navigate = screen.getByTestId('navigate')
    expect(navigate).toHaveAttribute('data-to', '/auth/complete-profile')
  })

  it('does NOT redirect when already on /auth/complete-profile', () => {
    mockCurrentPath = '/auth/complete-profile'

    ;(useCurrentAccount as Mock).mockReturnValue({
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
    })

    render(
      <ProfileGate>
        <div data-testid="child">profile form</div>
      </ProfileGate>,
    )

    expect(screen.getByTestId('child')).toHaveTextContent('profile form')
    expect(screen.queryByTestId('navigate')).not.toBeInTheDocument()
  })

  it.each(['/privacy', '/terms', '/imprint'])(
    'does NOT redirect from %s when account has no name',
    (path) => {
      mockCurrentPath = path

      ;(useCurrentAccount as Mock).mockReturnValue({
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
      })

      render(
        <ProfileGate>
          <div data-testid="child">legal page</div>
        </ProfileGate>,
      )

      expect(screen.getByTestId('child')).toHaveTextContent('legal page')
      expect(screen.queryByTestId('navigate')).not.toBeInTheDocument()
    },
  )

  it('redirects from / when account has no name', () => {
    mockCurrentPath = '/'

    ;(useCurrentAccount as Mock).mockReturnValue({
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
    })

    render(
      <ProfileGate>
        <div data-testid="child">home page</div>
      </ProfileGate>,
    )

    const navigate = screen.getByTestId('navigate')
    expect(navigate).toHaveAttribute('data-to', '/auth/complete-profile')
    // The redirect search param should capture the home path
    expect(navigate.getAttribute('data-search')).toContain('/')
  })

  it('redirects from /groups/abc when account has no name', () => {
    mockCurrentPath = '/groups/abc'

    ;(useCurrentAccount as Mock).mockReturnValue({
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
    })

    render(
      <ProfileGate>
        <div data-testid="child">group page</div>
      </ProfileGate>,
    )

    const navigate = screen.getByTestId('navigate')
    expect(navigate).toHaveAttribute('data-to', '/auth/complete-profile')
    expect(navigate.getAttribute('data-search')).toContain('/groups/abc')
  })
})
