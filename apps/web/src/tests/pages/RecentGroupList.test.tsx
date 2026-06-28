import { render, screen, waitFor } from '@/test/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * BLOCK A: Mock-based tests for RecentGroupList
 *
 * Tests cover: loading, empty, empty-with-hidden, starred/active/archived/hidden
 * partitioning, star toggle, hide toggle, archive toggle (ADMIN only),
 * ForceArchiveDialog on PRECONDITION_FAILED, and PendingInvitations with
 * accept/decline.
 */

// ── Hoisted mocks ───────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  // Queries
  mockUseGroupsQuery: vi.fn(),
  mockUseInvitationsQuery: vi.fn(),
  // Mutations (simple mutateAsync)
  mockSetPreference: vi.fn(),
  mockArchiveGroup: vi.fn(),
  // Mutation callbacks (accept / decline use onSuccess/onError options)
  mockInvitationsAcceptMutate: vi.fn(),
  mockInvitationsDeclineMutate: vi.fn(),
  // Invalidation
  mockInvalidateAccountGroups: vi.fn(),
  mockInvalidateGroupsGet: vi.fn(),
  mockInvalidateInvitationsList: vi.fn(),
  // Toast + navigation
  mockToast: vi.fn(),
  mockRouterPush: vi.fn(),
  // Stored mutation callbacks (set by useMutation during render)
  acceptOnSuccess: null as ((data: { groupId: string }) => void) | null,
  acceptOnError: null as ((error: Error) => void) | null,
  declineOnSuccess: null as (() => void) | null,
  declineOnError: null as ((error: Error) => void) | null,
}))

// ── Module mocks ────────────────────────────────────────────────────────

vi.mock('@/trpc/client', () => ({
  trpc: {
    account: {
      groups: {
        useQuery: mocks.mockUseGroupsQuery,
      },
      setPreference: {
        useMutation: () => ({
          mutateAsync: mocks.mockSetPreference,
        }),
      },
    },
    groups: {
      archive: {
        useMutation: () => ({
          mutateAsync: mocks.mockArchiveGroup,
        }),
      },
    },
    invitations: {
      listForAccount: {
        useQuery: mocks.mockUseInvitationsQuery,
      },
      accept: {
        useMutation: (opts: {
          onSuccess?: (data: { groupId: string }) => void
          onError?: (error: Error) => void
        }) => {
          mocks.acceptOnSuccess = opts?.onSuccess ?? null
          mocks.acceptOnError = opts?.onError ?? null
          return {
            mutate: mocks.mockInvitationsAcceptMutate,
            isPending: false,
          } as const
        },
      },
      decline: {
        useMutation: (opts: {
          onSuccess?: () => void
          onError?: (error: Error) => void
        }) => {
          mocks.declineOnSuccess = opts?.onSuccess ?? null
          mocks.declineOnError = opts?.onError ?? null
          return {
            mutate: mocks.mockInvitationsDeclineMutate,
            isPending: false,
          } as const
        },
      },
    },
    useUtils: () => ({
      account: {
        groups: {
          invalidate: mocks.mockInvalidateAccountGroups,
        },
      },
      groups: {
        get: {
          invalidate: mocks.mockInvalidateGroupsGet,
        },
      },
      invitations: {
        listForAccount: {
          invalidate: mocks.mockInvalidateInvitationsList,
        },
      },
    }),
  },
}))

vi.mock('@/components/ui/use-toast', () => ({
  useToast: () => ({ toast: mocks.mockToast }),
}))

vi.mock('@/lib/navigation', () => ({
  useRouter: () => ({
    push: mocks.mockRouterPush,
    replace: vi.fn(),
    back: vi.fn(),
    refresh: vi.fn(),
  }),
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

// ── SUT (imported after mocks) ──────────────────────────────────────────

import { RecentGroupList } from '@/app/groups/recent-group-list'

// ── Helpers ─────────────────────────────────────────────────────────────

function makeGroup(overrides: Record<string, unknown> = {}) {
  return {
    id: 'group-1',
    name: 'Test Group',
    archived: false,
    _count: { members: 4 },
    currentMemberRole: 'ADMIN' as const,
    preference: { starred: false, hidden: false, pinned: false },
    createdAt: '2026-06-01T00:00:00Z',
    ...overrides,
  }
}

function makeInvitation(overrides: Record<string, unknown> = {}) {
  return {
    id: 'inv-1',
    groupId: 'group-1',
    createdAt: '2026-06-01T00:00:00Z',
    group: { id: 'group-1', name: 'Invited Group' },
    invitedBy: { name: 'Alice', email: 'alice@example.com' },
    ...overrides,
  }
}

// ── Tests ───────────────────────────────────────────────────────────────

describe('RecentGroupList', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    // Reset mutation callbacks from previous renders
    mocks.acceptOnSuccess = null
    mocks.acceptOnError = null
    mocks.declineOnSuccess = null
    mocks.declineOnError = null

    // Default mock return values
    mocks.mockUseGroupsQuery.mockReturnValue({
      data: { groups: [] },
      isLoading: false,
    })
    mocks.mockUseInvitationsQuery.mockReturnValue({
      data: { invitations: [] },
      isLoading: false,
    })
    mocks.mockSetPreference.mockResolvedValue(undefined)
    mocks.mockArchiveGroup.mockResolvedValue(undefined)
    mocks.mockInvalidateAccountGroups.mockResolvedValue(undefined)
    mocks.mockInvalidateGroupsGet.mockResolvedValue(undefined)
    mocks.mockInvalidateInvitationsList.mockResolvedValue(undefined)
  })

  // ── Loading state ───────────────────────────────────────────────────

  it('shows loader while groups are loading', () => {
    mocks.mockUseGroupsQuery.mockReturnValue({
      data: undefined,
      isLoading: true,
    })

    render(<RecentGroupList />)

    // The component renders a Loader2 spinner with loading text
    expect(screen.getByText(/loading recent/i)).toBeInTheDocument()
  })

  // ── Empty state (no groups at all) ──────────────────────────────────

  it('shows empty state with create group link when no groups', () => {
    mocks.mockUseGroupsQuery.mockReturnValue({
      data: { groups: [] },
      isLoading: false,
    })

    render(<RecentGroupList />)

    expect(screen.getByText(/don't have any group/i)).toBeInTheDocument()
    expect(screen.getByText(/create one/i)).toBeInTheDocument()
    // The "create one" text is wrapped in a link pointing to /groups/create
    const createLink = screen.getByRole('link', { name: /create one/i })
    expect(createLink).toHaveAttribute('href', '/groups/create')
  })

  // ── Empty state with hidden groups ──────────────────────────────────

  it('shows empty with show-hidden link when all groups are hidden', () => {
    const hiddenGroup = makeGroup({
      preference: { starred: false, hidden: true, pinned: false },
    })
    mocks.mockUseGroupsQuery.mockReturnValue({
      data: { groups: [hiddenGroup] },
      isLoading: false,
    })

    render(<RecentGroupList />)

    expect(screen.getByText(/hidden all of your groups/i)).toBeInTheDocument()
    const showHiddenBtn = screen.getByRole('button', {
      name: /show hidden groups/i,
    })
    expect(showHiddenBtn).toBeInTheDocument()
  })

  // ── Starred section ─────────────────────────────────────────────────

  it('renders starred groups in starred section', () => {
    const starredGroup = makeGroup({
      id: 'g-star',
      name: 'Starred Trip',
      preference: { starred: true, hidden: false, pinned: false },
    })
    mocks.mockUseGroupsQuery.mockReturnValue({
      data: { groups: [starredGroup] },
      isLoading: false,
    })

    render(<RecentGroupList />)

    // Starred section heading
    expect(screen.getByText('Starred groups')).toBeInTheDocument()
    // Group name is rendered as a link
    expect(screen.getByText('Starred Trip')).toBeInTheDocument()
  })

  // ── Active / Recent section ─────────────────────────────────────────

  it('renders active groups in recent section', () => {
    const activeGroup = makeGroup({
      id: 'g-active',
      name: 'Active Trip',
      preference: { starred: false, hidden: false, pinned: false },
    })
    mocks.mockUseGroupsQuery.mockReturnValue({
      data: { groups: [activeGroup] },
      isLoading: false,
    })

    render(<RecentGroupList />)

    // "Recent groups" heading appears when there are active (non-starred) groups
    expect(screen.getByText('Recent groups')).toBeInTheDocument()
    expect(screen.getByText('Active Trip')).toBeInTheDocument()
  })

  // ── Archived section ────────────────────────────────────────────────

  it('renders archived groups separately', () => {
    const archivedGroup = makeGroup({
      id: 'g-arch',
      name: 'Old Trip',
      archived: true,
      preference: { starred: false, hidden: false, pinned: false },
    })
    mocks.mockUseGroupsQuery.mockReturnValue({
      data: { groups: [archivedGroup] },
      isLoading: false,
    })

    render(<RecentGroupList />)

    // Archived section heading
    expect(screen.getByText('Archived groups')).toBeInTheDocument()
    expect(screen.getByText('Old Trip')).toBeInTheDocument()
    // Archived list has opacity styling (opacity-50 class on the <ul>)
    // We verify the card is rendered and archived badge is not shown on the
    // RecentGroupList — the heading text alone confirms it's in the right section.
  })

  // ── Star toggle ─────────────────────────────────────────────────────

  it('star toggle calls setPreference and invalidates groups', async () => {
    const group = makeGroup({ id: 'g-star-toggle' })
    mocks.mockUseGroupsQuery.mockReturnValue({
      data: { groups: [group] },
      isLoading: false,
    })

    const { user } = render(<RecentGroupList />)

    // Find the star button (aria-label "Star group")
    const starButton = screen.getByRole('button', { name: /star group/i })
    await user.click(starButton)

    expect(mocks.mockSetPreference).toHaveBeenCalledWith({
      groupId: 'g-star-toggle',
      starred: true,
    })
    await waitFor(() => {
      expect(mocks.mockInvalidateAccountGroups).toHaveBeenCalled()
    })
  })

  it('un-star toggles starred off', async () => {
    const group = makeGroup({
      id: 'g-unstar',
      preference: { starred: true, hidden: false, pinned: false },
    })
    mocks.mockUseGroupsQuery.mockReturnValue({
      data: { groups: [group] },
      isLoading: false,
    })

    const { user } = render(<RecentGroupList />)

    // Star button now says "Unstar group"
    const unstarButton = screen.getByRole('button', { name: /unstar group/i })
    await user.click(unstarButton)

    expect(mocks.mockSetPreference).toHaveBeenCalledWith({
      groupId: 'g-unstar',
      starred: false,
    })
  })

  // ── Hide toggle ─────────────────────────────────────────────────────

  it('hide toggles hidden state from dropdown menu', async () => {
    const group = makeGroup({ id: 'g-hide' })
    mocks.mockUseGroupsQuery.mockReturnValue({
      data: { groups: [group] },
      isLoading: false,
    })

    const { user } = render(<RecentGroupList />)

    // Open the dropdown menu (trigger button has aria-label "Group actions")
    const actionsButton = screen.getByRole('button', { name: /group actions/i })
    await user.click(actionsButton)

    // The dropdown content renders a "Hide group" menu item
    const hideItem = screen.getByText('Hide group')
    expect(hideItem).toBeInTheDocument()
    await user.click(hideItem)

    expect(mocks.mockSetPreference).toHaveBeenCalledWith({
      groupId: 'g-hide',
      hidden: true,
    })
  })

  // ── Archive call (ADMIN only) ───────────────────────────────────────

  it('archive calls archiveGroup for ADMIN role', async () => {
    const group = makeGroup({
      id: 'g-arch-admin',
      currentMemberRole: 'ADMIN',
    })
    mocks.mockUseGroupsQuery.mockReturnValue({
      data: { groups: [group] },
      isLoading: false,
    })

    const { user } = render(<RecentGroupList />)

    // Open dropdown
    const actionsButton = screen.getByRole('button', { name: /group actions/i })
    await user.click(actionsButton)

    // Archive menu item is present for ADMINs
    const archiveItem = screen.getByText('Archive group')
    expect(archiveItem).toBeInTheDocument()
    await user.click(archiveItem)

    expect(mocks.mockArchiveGroup).toHaveBeenCalledWith({
      groupId: 'g-arch-admin',
      archived: true,
    })

    // On success, toast and invalidation happen
    await waitFor(() => {
      expect(mocks.mockToast).toHaveBeenCalledWith({
        description: 'Group archived.',
      })
    })
    expect(mocks.mockInvalidateAccountGroups).toHaveBeenCalled()
    expect(mocks.mockInvalidateGroupsGet).toHaveBeenCalledWith({
      groupId: 'g-arch-admin',
    })
  })

  it('does not show archive action for non-ADMIN members', async () => {
    const group = makeGroup({
      id: 'g-member',
      currentMemberRole: 'MEMBER',
    })
    mocks.mockUseGroupsQuery.mockReturnValue({
      data: { groups: [group] },
      isLoading: false,
    })

    const { user } = render(<RecentGroupList />)

    const actionsButton = screen.getByRole('button', { name: /group actions/i })
    await user.click(actionsButton)

    // The archive menu item should NOT appear for MEMBERs
    expect(screen.queryByText('Archive group')).not.toBeInTheDocument()
    // Hide group is still present
    expect(screen.getByText('Hide group')).toBeInTheDocument()
  })

  // ── ForceArchiveDialog on PRECONDITION_FAILED ───────────────────────

  it('opens ForceArchiveDialog when archive fails with PRECONDITION_FAILED', async () => {
    const group = makeGroup({
      id: 'g-force',
      currentMemberRole: 'ADMIN',
    })
    mocks.mockUseGroupsQuery.mockReturnValue({
      data: { groups: [group] },
      isLoading: false,
    })
    // Simulate the PRECONDITION_FAILED tRPC error shape
    mocks.mockArchiveGroup.mockRejectedValue({
      data: { code: 'PRECONDITION_FAILED' },
    })

    const { user } = render(<RecentGroupList />)

    // Trigger archive via dropdown
    const actionsButton = screen.getByRole('button', { name: /group actions/i })
    await user.click(actionsButton)
    const archiveItem = screen.getByText('Archive group')
    await user.click(archiveItem)

    // ForceArchiveDialog should appear with a dialog role
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })
    expect(
      screen.getByRole('heading', { name: /unsettled balances/i }),
    ).toBeInTheDocument()
  })

  it('shows error toast when archive fails with non-PRECONDITION_FAILED', async () => {
    const group = makeGroup({
      id: 'g-err',
      currentMemberRole: 'ADMIN',
    })
    mocks.mockUseGroupsQuery.mockReturnValue({
      data: { groups: [group] },
      isLoading: false,
    })
    mocks.mockArchiveGroup.mockRejectedValue(new Error('Server error'))

    const { user } = render(<RecentGroupList />)

    const actionsButton = screen.getByRole('button', { name: /group actions/i })
    await user.click(actionsButton)
    const archiveItem = screen.getByText('Archive group')
    await user.click(archiveItem)

    await waitFor(() => {
      expect(mocks.mockToast).toHaveBeenCalledWith({
        description: 'Server error',
        variant: 'destructive',
      })
    })
    // Dialog should NOT open for non-PRECONDITION_FAILED errors
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  // ── PendingInvitations card ─────────────────────────────────────────

  it('shows pending invitations card with accept and decline buttons', () => {
    const invitation = makeInvitation()
    mocks.mockUseInvitationsQuery.mockReturnValue({
      data: { invitations: [invitation] },
      isLoading: false,
    })

    render(<RecentGroupList />)

    expect(screen.getByText('Pending invitations')).toBeInTheDocument()
    // Group name from the invitation
    expect(screen.getByText('Invited Group')).toBeInTheDocument()
    // Invited by line
    expect(screen.getByText(/invited by alice/i)).toBeInTheDocument()
    // Action buttons
    expect(screen.getByRole('button', { name: /accept/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /decline/i })).toBeInTheDocument()
  })

  it('accept invitation calls accept mutation and navigates', async () => {
    const invitation = makeInvitation()
    mocks.mockUseInvitationsQuery.mockReturnValue({
      data: { invitations: [invitation] },
      isLoading: false,
    })

    const { user } = render(<RecentGroupList />)

    // Click Accept
    const acceptBtn = screen.getByRole('button', { name: /accept/i })
    await user.click(acceptBtn)

    // The mutation's mutate function was called with the invitation id
    expect(mocks.mockInvitationsAcceptMutate).toHaveBeenCalledWith({
      invitationId: 'inv-1',
    })

    // Simulate the onSuccess callback (fires after the real mutation succeeds)
    await mocks.acceptOnSuccess?.({ groupId: 'group-1' })

    // After success: navigate to the group
    await waitFor(() => {
      expect(mocks.mockRouterPush).toHaveBeenCalledWith({
        to: '/groups/$groupId',
        params: { groupId: 'group-1' },
      })
    })
    // Also invalidates account groups and invitations list
    expect(mocks.mockInvalidateAccountGroups).toHaveBeenCalled()
    expect(mocks.mockInvalidateInvitationsList).toHaveBeenCalled()
  })

  it('decline invitation calls decline mutation', async () => {
    const invitation = makeInvitation()
    mocks.mockUseInvitationsQuery.mockReturnValue({
      data: { invitations: [invitation] },
      isLoading: false,
    })

    const { user } = render(<RecentGroupList />)

    // Click Decline
    const declineBtn = screen.getByRole('button', { name: /decline/i })
    await user.click(declineBtn)

    expect(mocks.mockInvitationsDeclineMutate).toHaveBeenCalledWith({
      invitationId: 'inv-1',
    })

    // Simulate the onSuccess callback
    await mocks.declineOnSuccess?.()

    await waitFor(() => {
      expect(mocks.mockInvalidateInvitationsList).toHaveBeenCalled()
    })
  })

  it('shows skeleton loading state for pending invitations', () => {
    mocks.mockUseInvitationsQuery.mockReturnValue({
      data: undefined,
      isLoading: true,
    })

    const { container } = render(<RecentGroupList />)

    // PendingInvitations shows skeleton cards while loading
    const skeletons = container.querySelectorAll('[class*="animate-pulse"]')
    // The PendingInvitations skeleton renders two skeleton rows inside the card
    expect(skeletons.length).toBeGreaterThan(0)
    // The title should still be visible
    expect(screen.getByText('Pending invitations')).toBeInTheDocument()
  })
})
