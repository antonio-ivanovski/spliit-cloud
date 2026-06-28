import { render, screen } from '@/test/test-utils'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { AccountMenu } from '@/components/account-menu'
import { useCurrentAccount } from '@/lib/use-current-account'

// ── Module mocks ────────────────────────────────────────────────────────

const { mockReplace, mockSignOut } = vi.hoisted(() => ({
  mockReplace: vi.fn(),
  mockSignOut: vi.fn().mockResolvedValue(undefined),
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

vi.mock('@/lib/auth', () => ({
  authClient: {
    signOut: mockSignOut,
  },
}))

vi.mock('@/lib/navigation', () => ({
  useRouter: () => ({
    replace: mockReplace,
    push: vi.fn(),
  }),
}))

vi.mock('@/lib/use-current-account', () => ({
  useCurrentAccount: vi.fn(),
}))

// ── Tests ───────────────────────────────────────────────────────────────

describe('AccountMenu', () => {
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

    // Sign out item should be present
    expect(screen.getByText('Sign out')).toBeInTheDocument()
  })

  it('clicking sign out calls authClient.signOut and router.replace', async () => {
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

    expect(mockSignOut).toHaveBeenCalledOnce()
    expect(mockReplace).toHaveBeenCalledWith({ href: '/' })
  })
})
