import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { AccountMenu } from '@/components/account-menu'
import { useCurrentAccount } from '@/lib/use-current-account'
import { render, screen, waitFor } from '@/test/test-utils'

// ── Module mocks ────────────────────────────────────────────────────────

const {
  mockClearPushOnboardingCompletion,
  mockDisconnectPushSubscription,
  mockReplaceLocation,
  mockSignOut,
  mockToast,
} = vi.hoisted(() => ({
  mockClearPushOnboardingCompletion: vi.fn(),
  mockDisconnectPushSubscription: vi.fn(),
  mockReplaceLocation: vi.fn(),
  mockSignOut: vi
    .fn()
    .mockResolvedValue({ data: { success: true }, error: null }),
  mockToast: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    children,
  }: {
    to: string
    children: React.ReactNode
    [key: string]: unknown
  }) => <a href={to}>{children}</a>,
}))

vi.mock('@/lib/browser-navigation', () => ({
  replaceBrowserLocation: mockReplaceLocation,
}))

vi.mock('@/components/ui/use-toast', () => ({
  useToast: () => ({ toast: mockToast }),
}))

vi.mock('@/lib/auth', () => ({
  authClient: {
    signOut: mockSignOut,
  },
}))

vi.mock('@/lib/use-current-account', () => ({
  useCurrentAccount: vi.fn(),
}))

vi.mock('@/lib/push-notifications', () => ({
  disconnectPushSubscription: mockDisconnectPushSubscription,
}))

vi.mock('@/components/push-notification-onboarding', () => ({
  clearPushOnboardingCompletion: mockClearPushOnboardingCompletion,
}))

// ── Tests ───────────────────────────────────────────────────────────────

describe('AccountMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDisconnectPushSubscription.mockResolvedValue(false)
    mockSignOut.mockResolvedValue({ data: { success: true }, error: null })
  })

  it('shows skeleton pulse when isPending', () => {
    vi.mocked(useCurrentAccount).mockReturnValue({
      data: null,
      isPending: true,
      isRefetching: false,
      error: null,
      refetch: vi.fn(),
    })

    const { container } = render(<AccountMenu />)

    const skeleton = container.querySelector('.animate-pulse')
    expect(skeleton).toBeInTheDocument()
    expect(skeleton).toHaveClass('bg-muted')
  })

  it('renders null when no account (signed out)', () => {
    vi.mocked(useCurrentAccount).mockReturnValue({
      data: null,
      isPending: false,
      isRefetching: false,
      error: null,
      refetch: vi.fn(),
    })

    const { container } = render(<AccountMenu />)
    expect(container.innerHTML).toBe('')
  })

  it('renders dropdown with account name and email when signed in', () => {
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

    render(<AccountMenu />)

    // The dropdown trigger is a button with aria-label 'Account'
    const trigger = screen.getByRole('button', { name: /account/i })
    expect(trigger).toBeInTheDocument()

    // Avatar element is rendered
    const avatar = trigger.querySelector('[class*="rounded-full"]')
    expect(avatar).toBeInTheDocument()
  })

  it('clicking trigger opens dropdown with account info and sign out', async () => {
    const user = userEvent.setup()

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

    render(<AccountMenu />)

    // Open dropdown
    const trigger = screen.getByRole('button', { name: /account/i })
    await user.click(trigger)

    // Account name and email should be visible
    expect(screen.getByText('Alice')).toBeInTheDocument()
    expect(screen.getByText('alice@example.com')).toBeInTheDocument()

    // Account settings link should be present
    expect(screen.getByText('Account settings')).toBeInTheDocument()

    expect(screen.getByRole('link', { name: 'Feedback' })).toHaveAttribute(
      'href',
      '/feedback',
    )

    // Sign out item should be present
    expect(screen.getByText('Sign out')).toBeInTheDocument()
  })

  it('clicking sign out calls authClient.signOut and hard-replaces the page', async () => {
    const user = userEvent.setup()

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

    render(<AccountMenu />)

    // Open dropdown
    const trigger = screen.getByRole('button', { name: /account/i })
    await user.click(trigger)

    // Click sign out
    const signOutItem = screen.getByText('Sign out')
    await user.click(signOutItem)

    await waitFor(() => expect(mockSignOut).toHaveBeenCalledOnce())
    await waitFor(() => expect(mockReplaceLocation).toHaveBeenCalledWith('/'))
  })

  it('clears push onboarding completion when logout disconnects a device', async () => {
    mockDisconnectPushSubscription.mockResolvedValue(true)
    const user = userEvent.setup()

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

    render(<AccountMenu />)
    await user.click(screen.getByRole('button', { name: /account/i }))
    await user.click(screen.getByText('Sign out'))

    expect(mockClearPushOnboardingCompletion).toHaveBeenCalledWith('user-1')
  })

  it('keeps push onboarding completion when no device was connected', async () => {
    const user = userEvent.setup()

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

    render(<AccountMenu />)
    await user.click(screen.getByRole('button', { name: /account/i }))
    await user.click(screen.getByText('Sign out'))

    expect(mockClearPushOnboardingCompletion).not.toHaveBeenCalled()
  })

  it('confirms anonymous sign-out with the app dialog', async () => {
    const user = userEvent.setup()
    vi.mocked(useCurrentAccount).mockReturnValue({
      data: {
        id: 'guest-1',
        name: 'Guest',
        email: 'guest@anonymous.placeholder.local',
        image: null,
        emailVerified: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        isAnonymous: true,
      },
      isPending: false,
      isRefetching: false,
      error: null,
      refetch: vi.fn(),
    })

    render(<AccountMenu />)
    await user.click(screen.getByRole('button', { name: /account/i }))
    await user.click(screen.getByText('Sign out'))

    expect(mockSignOut).not.toHaveBeenCalled()
    expect(
      screen.getByText(
        'This anonymous account can only be accessed with your saved sign in link. Sign out now?',
      ),
    ).toBeInTheDocument()

    expect(
      screen.getByRole('dialog', { name: 'Sign out?' }),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Sign out' }))

    expect(mockSignOut).toHaveBeenCalledOnce()
    expect(mockReplaceLocation).toHaveBeenCalledWith('/')
  })

  it('cancels anonymous sign-out without touching the session', async () => {
    const user = userEvent.setup()
    vi.mocked(useCurrentAccount).mockReturnValue({
      data: {
        id: 'guest-1',
        name: 'Guest',
        email: 'guest@anonymous.placeholder.local',
        image: null,
        emailVerified: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        isAnonymous: true,
      },
      isPending: false,
      isRefetching: false,
      error: null,
      refetch: vi.fn(),
    })

    render(<AccountMenu />)
    await user.click(screen.getByRole('button', { name: /account/i }))
    await user.click(screen.getByText('Sign out'))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(mockSignOut).not.toHaveBeenCalled()
    expect(mockReplaceLocation).not.toHaveBeenCalled()
  })

  it('keeps the session when Better Auth sign-out fails', async () => {
    mockSignOut.mockResolvedValue({
      data: null,
      error: { message: 'failed' },
    })
    const user = userEvent.setup()
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

    render(<AccountMenu />)
    await user.click(screen.getByRole('button', { name: /account/i }))
    await user.click(screen.getByText('Sign out'))

    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith({
        description: 'Could not sign out. Please try again.',
        variant: 'destructive',
      }),
    )
    expect(mockReplaceLocation).not.toHaveBeenCalled()
  })
})
