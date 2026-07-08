import { render, screen } from '@/test/test-utils'
import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  mockFriendsQuery: vi.fn(),
  mockCreateFriend: vi.fn(),
  mockToast: vi.fn(),
  mockRouterPush: vi.fn(),
  mockRouterReplace: vi.fn(),
  mockRouterBack: vi.fn(),
  mockRouterRefresh: vi.fn(),
}))

vi.mock('@/trpc/client', () => ({
  trpc: {
    account: {
      friends: {
        useQuery: mocks.mockFriendsQuery,
      },
    },
    friends: {
      create: {
        useMutation: () => ({
          mutateAsync: mocks.mockCreateFriend,
        }),
      },
    },
    useUtils: () => ({
      account: {
        groups: { invalidate: vi.fn() },
        friends: { invalidate: vi.fn() },
      },
    }),
  },
}))

vi.mock('@/lib/navigation', () => ({
  useRouter: () => ({
    push: mocks.mockRouterPush,
    replace: mocks.mockRouterReplace,
    back: mocks.mockRouterBack,
    refresh: mocks.mockRouterRefresh,
  }),
}))

vi.mock('@/components/ui/use-toast', () => ({
  useToast: () => ({ toast: mocks.mockToast }),
}))

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
}))

vi.mock('@/lib/currency', () => ({
  getCurrency: () => ({
    code: 'USD',
    symbol: '$',
    rounding: 0,
    decimal_digits: 2,
  }),
  useCurrencies: () => [
    {
      code: 'USD',
      symbol: '$',
      name: 'US Dollar',
      rounding: 0,
      decimal_digits: 2,
    },
  ],
}))

import { CreateFriend } from '@/app/friends/create/create-friend'

describe('CreateFriend', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.mockFriendsQuery.mockReturnValue({
      data: { friends: [] },
      isLoading: false,
    })
    mocks.mockCreateFriend.mockResolvedValue({ groupId: 'new-group' })
  })

  it('renders the form with three peer-picker tabs: Friends, Email, and Link', () => {
    render(<CreateFriend />)

    expect(
      screen.getByRole('tab', { name: 'Friends list' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Email' })).toBeInTheDocument()
    expect(
      screen.getByRole('tab', { name: 'Shareable link' }),
    ).toBeInTheDocument()
  })

  it('renders the currency selector', () => {
    render(<CreateFriend />)

    expect(screen.getByText('Main currency')).toBeInTheDocument()
  })

  it('renders the info textarea', () => {
    render(<CreateFriend />)

    expect(screen.getByText('Information (optional)')).toBeInTheDocument()
    expect(
      screen.getByPlaceholderText("Add context like 'Roommate expenses'"),
    ).toBeInTheDocument()
  })

  it('renders a back link to the homepage', () => {
    render(<CreateFriend />)

    const backLink = screen.getByRole('link', { name: 'Back' })
    expect(backLink).toBeInTheDocument()
    expect(backLink).toHaveAttribute('href', '/')
  })
})
