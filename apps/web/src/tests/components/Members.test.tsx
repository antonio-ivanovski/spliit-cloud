import { useCurrentGroup } from '@/app/groups/[groupId]/current-group-context'
import GroupMembers from '@/app/groups/[groupId]/members/members'
import { useCurrentAccount } from '@/lib/use-current-account'
import { render, screen } from '@/test/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// ── Module mocks ────────────────────────────────────────────────────────

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    children,
    ...props
  }: {
    to: string
    children: React.ReactNode
    [key: string]: unknown
  }) => <a href={to}>{children}</a>,
}))

vi.mock('@/components/link', () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: string
    children: React.ReactNode
    [key: string]: unknown
  }) => <a href={href}>{children}</a>,
  Link: ({
    href,
    children,
    ...props
  }: {
    href: string
    children: React.ReactNode
    [key: string]: unknown
  }) => <a href={href}>{children}</a>,
}))

// Mock tRPC - the members page uses many mutations and queries
const mockCreateMutation = vi.fn()
const mockCreateLinkMutation = vi.fn()
const mockRevokeMutation = vi.fn()
const mockUpdateRoleMutation = vi.fn()
const mockRemoveMemberMutation = vi.fn()
const mockLeaveMutation = vi.fn()
const mockArchiveForSelfMutation = vi.fn()

// Shared mutable state so tests can override query results
let mockMembersData: { members: any[] } = { members: [] }
let mockInvitationsData: { invitations: any[] } = { invitations: [] }

// Track onSuccess callbacks so tests can trigger them
let createMutationOnSuccess: ((data: any) => void) | null = null
let createLinkMutationOnSuccess: ((data: any) => void) | null = null

vi.mock('@/trpc/client', () => {
  return {
    trpc: {
      useUtils: () => ({
        invitations: {
          list: { invalidate: vi.fn().mockResolvedValue(undefined) },
        },
        groups: {
          get: { invalidate: vi.fn().mockResolvedValue(undefined) },
          getDetails: { invalidate: vi.fn().mockResolvedValue(undefined) },
          importLinks: {
            listUnlinked: { invalidate: vi.fn().mockResolvedValue(undefined) },
          },
          leavePreview: { invalidate: vi.fn().mockResolvedValue(undefined) },
        },
        account: {
          members: { invalidate: vi.fn().mockResolvedValue(undefined) },
          groups: { invalidate: vi.fn().mockResolvedValue(undefined) },
        },
      }),
      invitations: {
        create: {
          useMutation: (opts?: { onSuccess?: (data: any) => void }) => {
            createMutationOnSuccess = opts?.onSuccess ?? null
            return { mutateAsync: mockCreateMutation, isPending: false }
          },
        },
        createLink: {
          useMutation: (opts?: { onSuccess?: (data: any) => void }) => {
            createLinkMutationOnSuccess = opts?.onSuccess ?? null
            return { mutateAsync: mockCreateLinkMutation, isPending: false }
          },
        },
        revoke: {
          useMutation: () => ({
            mutateAsync: mockRevokeMutation,
            isPending: false,
          }),
        },
        list: {
          useQuery: () => ({ data: mockInvitationsData, isLoading: false }),
        },
        revokePreview: {
          useQuery: () => ({ data: undefined, isLoading: false }),
        },
      },
      account: {
        members: {
          useQuery: () => ({ data: mockMembersData, isLoading: false }),
        },
      },
      groups: {
        members: {
          updateRole: {
            useMutation: () => ({
              mutate: mockUpdateRoleMutation,
              isPending: false,
            }),
          },
          remove: {
            useMutation: () => ({
              mutateAsync: mockRemoveMemberMutation,
              isPending: false,
            }),
          },
          removePreview: {
            useQuery: () => ({ data: undefined, isLoading: false }),
          },
        },
        importLinks: {
          listUnlinked: {
            useQuery: () => ({ data: undefined, isLoading: false }),
          },
        },
        leave: {
          useMutation: () => ({ mutate: mockLeaveMutation, isPending: false }),
        },
        archiveForSelf: {
          useMutation: () => ({
            mutateAsync: mockArchiveForSelfMutation,
            isPending: false,
          }),
        },
        leavePreview: {
          useQuery: () => ({ data: undefined, isLoading: false }),
        },
      },
    },
  }
})

vi.mock('@/lib/use-current-account', () => ({
  useCurrentAccount: vi.fn(),
}))

vi.mock('@/app/groups/[groupId]/current-group-context', () => ({
  useCurrentGroup: vi.fn(),
}))

vi.mock('@/lib/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
  }),
}))

// ── Fixtures ────────────────────────────────────────────────────────────

const mockGroup = {
  id: 'group-1',
  name: 'Test Group',
  slug: 'test-group',
  archived: false,
  ledgerId: 'ledger-1',
  currency: '$',
  currencyCode: 'USD',
  information: '',
  createdAt: new Date(),
  updatedAt: new Date(),
  ledger: {
    id: 'ledger-1',
    currency: '$',
    currencyCode: 'USD',
    groupId: 'group-1',
  },
  members: [],
  invitations: [],
  participants: [],
}

const mockCurrentMember = {
  id: 'member-1',
  role: 'ADMIN' as const,
  status: 'ACTIVE' as const,
}

const mockAccountData = {
  id: 'user-1',
  name: 'Alice',
  email: 'alice@example.com',
  image: null,
  emailVerified: true,
  createdAt: new Date(),
  updatedAt: new Date(),
}

// ── Setup ───────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()

  vi.mocked(useCurrentGroup).mockReturnValue({
    isLoading: false,
    groupId: 'group-1',
    group: mockGroup as any,
    currentLedgerParticipantId: 'lp-1',
    currentMember: mockCurrentMember,
    currentInvitation: null,
    linkInviteState: null,
  })

  vi.mocked(useCurrentAccount).mockReturnValue({
    data: mockAccountData,
    isPending: false,
    isRefetching: false,
    error: null,
    refetch: vi.fn(),
  })
})

// ── Tests ───────────────────────────────────────────────────────────────

describe('GroupMembers', () => {
  it('renders the members page title', () => {
    render(<GroupMembers />)

    expect(screen.getByText('Members')).toBeInTheDocument()
  })

  it('renders invite by email form when user is admin', () => {
    render(<GroupMembers />)

    // Should render the invite tabs
    const tabs = screen.getAllByRole('tab')
    expect(tabs.length).toBe(2)
    expect(tabs[0]).toHaveTextContent('Email')
    expect(tabs[1]).toHaveTextContent('Invite link')

    // Email field should be visible (input with accessible name 'Email')
    const emailInput = screen.getByRole('textbox', { name: 'Email' })
    expect(emailInput).toBeInTheDocument()
    expect(emailInput).toHaveAttribute('type', 'email')
  })

  it('shows empty state when no members', () => {
    render(<GroupMembers />)

    expect(screen.getByText('No active members yet.')).toBeInTheDocument()
  })

  it('renders member list with role badges when members exist', () => {
    mockMembersData.members = [
      {
        id: 'gm-1',
        accountId: 'user-1',
        groupId: 'group-1',
        role: 'ADMIN',
        status: 'ACTIVE',
        joinedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        account: { id: 'user-1', name: 'Alice', email: 'alice@example.com' },
        ledgerParticipant: { id: 'lp-1' },
      },
      {
        id: 'gm-2',
        accountId: 'user-2',
        groupId: 'group-1',
        role: 'MEMBER',
        status: 'ACTIVE',
        joinedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        account: { id: 'user-2', name: 'Bob', email: 'bob@example.com' },
        ledgerParticipant: { id: 'lp-2' },
      },
    ]

    vi.mocked(useCurrentGroup).mockReturnValue({
      isLoading: false,
      groupId: 'group-1',
      group: {
        ...mockGroup,
        members: [
          {
            id: 'gm-1',
            accountId: 'user-1',
            role: 'ADMIN',
            status: 'ACTIVE',
            ledgerParticipant: { id: 'lp-1' },
          },
          {
            id: 'gm-2',
            accountId: 'user-2',
            role: 'MEMBER',
            status: 'ACTIVE',
            ledgerParticipant: { id: 'lp-2' },
          },
        ],
      } as any,
      currentLedgerParticipantId: 'lp-1',
      currentMember: { id: 'gm-1', role: 'ADMIN', status: 'ACTIVE' },
      currentInvitation: null,
      linkInviteState: null,
    })

    render(<GroupMembers />)

    // Both names should appear
    expect(screen.getByText('Alice')).toBeInTheDocument()
    expect(screen.getByText('Bob')).toBeInTheDocument()

    // Role badges should be present
    expect(screen.getAllByText('Admin').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('Member').length).toBeGreaterThanOrEqual(1)
  })

  it('shows "You" badge for current user', () => {
    mockMembersData.members = [
      {
        id: 'gm-1',
        accountId: 'user-1',
        groupId: 'group-1',
        role: 'ADMIN',
        status: 'ACTIVE',
        joinedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        account: { id: 'user-1', name: 'Alice', email: 'alice@example.com' },
        ledgerParticipant: { id: 'lp-1' },
      },
    ]

    vi.mocked(useCurrentGroup).mockReturnValue({
      isLoading: false,
      groupId: 'group-1',
      group: {
        ...mockGroup,
        members: [
          {
            id: 'gm-1',
            accountId: 'user-1',
            role: 'ADMIN',
            status: 'ACTIVE',
            ledgerParticipant: { id: 'lp-1' },
          },
        ],
      } as any,
      currentLedgerParticipantId: 'lp-1',
      currentMember: { id: 'gm-1', role: 'ADMIN', status: 'ACTIVE' },
      currentInvitation: null,
      linkInviteState: null,
    })

    render(<GroupMembers />)

    expect(screen.getByText('You')).toBeInTheDocument()
  })

  it('admin can see invite form and member management controls', () => {
    render(<GroupMembers />)

    // Invite form should be present
    expect(screen.getByText('Invite member')).toBeInTheDocument()
  })

  it('non-admin sees no manage permission message', () => {
    vi.mocked(useCurrentGroup).mockReturnValue({
      isLoading: false,
      groupId: 'group-1',
      group: mockGroup as any,
      currentLedgerParticipantId: 'lp-1',
      currentMember: { id: 'gm-1', role: 'MEMBER', status: 'ACTIVE' },
      currentInvitation: null,
      linkInviteState: null,
    })

    render(<GroupMembers />)

    expect(screen.getByText(/only admins can invite/i)).toBeInTheDocument()
  })

  it('submit creates invitation via email', async () => {
    mockCreateMutation.mockResolvedValue(undefined)
    const { user } = render(<GroupMembers />)

    // Fill in email
    const emailInput = screen.getByRole('textbox', { name: 'Email' })
    await user.type(emailInput, 'charlie@example.com')

    // Click invite button
    const inviteButton = screen.getByRole('button', { name: /send invite/i })
    await user.click(inviteButton)

    await vi.waitFor(() => {
      expect(mockCreateMutation).toHaveBeenCalledWith({
        groupId: 'group-1',
        email: 'charlie@example.com',
        role: 'MEMBER',
      })
    })
  })

  it('renders the generated invite link after creation', async () => {
    const inviteData = {
      inviteUrl: 'https://spliit.app/invite/abc123',
      temporaryName: null,
      role: 'MEMBER',
      expiresAt: new Date(Date.now() + 86400000),
    }
    mockCreateLinkMutation.mockResolvedValue(inviteData)

    const { user } = render(<GroupMembers />)

    // Switch to link tab
    const linkTab = screen.getByRole('tab', { name: 'Invite link' })
    await user.click(linkTab)

    // Click generate button
    const generateButton = screen.getByRole('button', { name: /generate/i })
    await user.click(generateButton)

    await vi.waitFor(() => {
      expect(mockCreateLinkMutation).toHaveBeenCalled()
    })

    // Trigger the onSuccess callback (the component sets it on useMutation)
    if (createLinkMutationOnSuccess) {
      createLinkMutationOnSuccess(inviteData)
    }

    // The generated link section should appear
    await vi.waitFor(() => {
      expect(
        screen.getByDisplayValue('https://spliit.app/invite/abc123'),
      ).toBeInTheDocument()
    })
  })
})
