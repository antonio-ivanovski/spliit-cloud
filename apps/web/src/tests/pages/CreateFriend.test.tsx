import { render, screen, within } from '@/test/test-utils'
import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  mockFriendsQuery: vi.fn(),
  mockCreateFriend: vi.fn(),
  mockToast: vi.fn(),
  mockNavigate: vi.fn(),
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
  useNavigate: () => mocks.mockNavigate,
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

  // ── Interaction tests (task 13.28) ───────────────────────────────

  it('submits Friends tab — selects a friend, submits, calls mutateAsync with peerAccountId, navigates to /groups/$id/expenses', async () => {
    mocks.mockFriendsQuery.mockReturnValue({
      data: {
        friends: [
          {
            accountId: 'peer-1',
            name: 'Alice',
            email: 'a@b.com',
            friendLedgerStatus: 'NONE',
          },
        ],
      },
      isLoading: false,
    })
    mocks.mockCreateFriend.mockResolvedValue({
      groupId: 'new-group',
      existed: false,
    })

    const { user } = render(<CreateFriend />)

    const combobox = within(
      screen.getByRole('tabpanel', { name: 'Friends list' }),
    ).getByRole('combobox')
    await user.click(combobox)

    const option = await screen.findByRole('option', { name: /Alice/ })
    await user.click(option)

    await user.click(
      screen.getByRole('button', { name: 'Create a friend ledger' }),
    )

    await vi.waitFor(() => {
      expect(mocks.mockCreateFriend).toHaveBeenCalled()
    })
    expect(
      mocks.mockCreateFriend.mock.calls[0][0].friendFormValues.peerAccountId,
    ).toBe('peer-1')
    expect(mocks.mockNavigate).toHaveBeenCalledWith(
      expect.objectContaining({
        to: '/groups/$groupId/expenses',
        params: { groupId: 'new-group' },
      }),
    )
  })

  it('submits Email tab — enters email, submits, calls mutateAsync with peerEmail and temporaryName set to email', async () => {
    const { user } = render(<CreateFriend />)

    await user.click(screen.getByRole('tab', { name: 'Email' }))

    await user.type(
      screen.getByRole('textbox', { name: /friend's email/i }),
      'friend@example.com',
    )

    await user.click(
      screen.getByRole('button', { name: 'Create a friend ledger' }),
    )

    await vi.waitFor(() => {
      expect(mocks.mockCreateFriend).toHaveBeenCalled()
    })
    expect(
      mocks.mockCreateFriend.mock.calls[0][0].friendFormValues.peerEmail,
    ).toBe('friend@example.com')
    expect(
      mocks.mockCreateFriend.mock.calls[0][0].friendFormValues.temporaryName,
    ).toBe('friend@example.com')
  })

  it('submits Link tab — enters name, submits, calls mutateAsync with useLink:true and temporaryName', async () => {
    const { user } = render(<CreateFriend />)

    await user.click(screen.getByRole('tab', { name: 'Shareable link' }))

    await user.type(
      screen.getByRole('textbox', { name: /display name/i }),
      'Bob',
    )

    await user.click(
      screen.getByRole('button', { name: 'Create a friend ledger' }),
    )

    await vi.waitFor(() => {
      expect(mocks.mockCreateFriend).toHaveBeenCalled()
    })
    expect(
      mocks.mockCreateFriend.mock.calls[0][0].friendFormValues.useLink,
    ).toBe(true)
    expect(
      mocks.mockCreateFriend.mock.calls[0][0].friendFormValues.temporaryName,
    ).toBe('Bob')
  })

  it('clears inactive peer mode fields when switching tabs before submit', async () => {
    mocks.mockFriendsQuery.mockReturnValue({
      data: {
        friends: [
          {
            accountId: 'peer-1',
            name: 'Alice',
            email: 'a@b.com',
            friendLedgerStatus: 'NONE',
          },
        ],
      },
      isLoading: false,
    })
    mocks.mockCreateFriend.mockResolvedValue({
      groupId: 'new-group',
      existed: false,
    })

    const { user } = render(<CreateFriend />)

    const combobox = within(
      screen.getByRole('tabpanel', { name: 'Friends list' }),
    ).getByRole('combobox')
    await user.click(combobox)
    await user.click(await screen.findByRole('option', { name: /Alice/ }))

    await user.click(screen.getByRole('tab', { name: 'Email' }))
    await user.type(
      screen.getByRole('textbox', { name: /friend's email/i }),
      'friend@example.com',
    )

    await user.click(
      screen.getByRole('button', { name: 'Create a friend ledger' }),
    )

    await vi.waitFor(() => {
      expect(mocks.mockCreateFriend).toHaveBeenCalled()
    })
    expect(
      mocks.mockCreateFriend.mock.calls[0][0].friendFormValues,
    ).toMatchObject({
      peerAccountId: undefined,
      peerEmail: 'friend@example.com',
      useLink: undefined,
      temporaryName: 'friend@example.com',
    })
  })

  it('navigates to existing ledger when result.existed is true', async () => {
    mocks.mockFriendsQuery.mockReturnValue({
      data: {
        friends: [
          {
            accountId: 'peer-1',
            name: 'Alice',
            email: 'a@b.com',
            friendLedgerStatus: 'NONE',
          },
        ],
      },
      isLoading: false,
    })
    mocks.mockCreateFriend.mockResolvedValue({
      groupId: 'existing',
      existed: true,
    })

    const { user } = render(<CreateFriend />)

    const combobox = within(
      screen.getByRole('tabpanel', { name: 'Friends list' }),
    ).getByRole('combobox')
    await user.click(combobox)
    const option = await screen.findByRole('option', { name: /Alice/ })
    await user.click(option)
    await user.click(
      screen.getByRole('button', { name: 'Create a friend ledger' }),
    )

    await vi.waitFor(() => {
      expect(mocks.mockNavigate).toHaveBeenCalled()
    })
    expect(mocks.mockNavigate).toHaveBeenCalledWith(
      expect.objectContaining({
        to: '/groups/$groupId',
        params: { groupId: 'existing' },
      }),
    )
  })

  it('navigates with friendLinkInvite param when result.inviteUrl is returned', async () => {
    mocks.mockFriendsQuery.mockReturnValue({
      data: {
        friends: [
          {
            accountId: 'peer-1',
            name: 'Alice',
            email: 'a@b.com',
            friendLedgerStatus: 'NONE',
          },
        ],
      },
      isLoading: false,
    })
    mocks.mockCreateFriend.mockResolvedValue({
      groupId: 'new-group',
      inviteUrl: 'http://example.com/invite',
    })

    const { user } = render(<CreateFriend />)

    const combobox = within(
      screen.getByRole('tabpanel', { name: 'Friends list' }),
    ).getByRole('combobox')
    await user.click(combobox)
    const option = await screen.findByRole('option', { name: /Alice/ })
    await user.click(option)
    await user.click(
      screen.getByRole('button', { name: 'Create a friend ledger' }),
    )

    await vi.waitFor(() => {
      expect(mocks.mockNavigate).toHaveBeenCalled()
    })
    expect(mocks.mockNavigate).toHaveBeenCalledWith(
      expect.objectContaining({
        to: '/groups/$groupId',
        params: { groupId: 'new-group' },
        search: { friendLinkInvite: 'http://example.com/invite' },
      }),
    )
  })

  it('shows error toast when mutation fails', async () => {
    mocks.mockFriendsQuery.mockReturnValue({
      data: {
        friends: [
          {
            accountId: 'peer-1',
            name: 'Alice',
            email: 'a@b.com',
            friendLedgerStatus: 'NONE',
          },
        ],
      },
      isLoading: false,
    })
    mocks.mockCreateFriend.mockRejectedValue(new Error('Network error'))

    const { user } = render(<CreateFriend />)

    const combobox = within(
      screen.getByRole('tabpanel', { name: 'Friends list' }),
    ).getByRole('combobox')
    await user.click(combobox)
    const option = await screen.findByRole('option', { name: /Alice/ })
    await user.click(option)
    await user.click(
      screen.getByRole('button', { name: 'Create a friend ledger' }),
    )

    await vi.waitFor(() => {
      expect(mocks.mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          description: 'Network error',
          variant: 'destructive',
        }),
      )
    })
  })

  // ── Temporary name field tests ─────────────────────────────────────────

  it('renders temporary name field in Link tab', async () => {
    const { user } = render(<CreateFriend />)

    await user.click(screen.getByRole('tab', { name: 'Shareable link' }))

    expect(screen.getByText('Display name')).toBeInTheDocument()
    expect(screen.getByText(/Enter a name for the person/)).toBeInTheDocument()
  })

  it('requires temporary name before submitting Link tab', async () => {
    const { user } = render(<CreateFriend />)

    await user.click(screen.getByRole('tab', { name: 'Shareable link' }))

    await user.click(
      screen.getByRole('button', { name: 'Create a friend ledger' }),
    )

    await vi.waitFor(() => {
      expect(
        screen.getByText('temporaryName is required for link invites'),
      ).toBeInTheDocument()
    })
  })

  it('does not render temporary name field in Email tab', async () => {
    const { user } = render(<CreateFriend />)

    await user.click(screen.getByRole('tab', { name: 'Email' }))

    expect(
      screen.queryByRole('textbox', { name: /display name/i }),
    ).not.toBeInTheDocument()
  })

  it('shows empty friends state', () => {
    render(<CreateFriend />)

    expect(
      screen.getByText(/Add a friend by entering their email/i),
    ).toBeInTheDocument()
  })

  it('renders hasFriendLedger indicator in Friends tab dropdown when true', async () => {
    mocks.mockFriendsQuery.mockReturnValue({
      data: {
        friends: [
          {
            accountId: 'peer-1',
            name: 'Alice',
            email: 'a@b.com',
            hasFriendLedger: true,
            friendLedgerStatus: 'ACTIVE',
            sharedGroupCount: 1,
          },
        ],
      },
      isLoading: false,
    })

    const { user } = render(<CreateFriend />)

    const combobox = within(
      screen.getByRole('tabpanel', { name: 'Friends list' }),
    ).getByRole('combobox')
    await user.click(combobox)

    expect(
      screen.getAllByText(/already has a friend ledger/i).length,
    ).toBeGreaterThanOrEqual(1)
  })
})
