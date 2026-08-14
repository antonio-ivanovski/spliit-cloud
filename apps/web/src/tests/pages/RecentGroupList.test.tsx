import { beforeEach, describe, expect, it, vi } from 'vitest'

import { render, screen, waitFor, within } from '@/test/test-utils'

/**
 * BLOCK A: Mock-based tests for RecentGroupList
 *
 * Tests cover: loading, empty, empty-with-hidden,
 * starred/active/archived/hidden partitioning, star toggle, hide toggle,
 * archive toggle (ADMIN only), ForceArchiveDialog on PRECONDITION_FAILED, and
 * PendingInvitations with accept/decline.
 */

// ── Hoisted mocks ───────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  // Queries
  mockUseOverviewQuery: vi.fn(),
  mockUseInvitationsQuery: vi.fn(),
  // Mutations (simple mutateAsync)
  mockSetPreference: vi.fn(),
  mockArchiveGroup: vi.fn(),
  mockRemoveSavedView: vi.fn(),
  // Mutation callbacks (accept / decline use onSuccess/onError options)
  mockInvitationsAcceptMutate: vi.fn(),
  mockInvitationsDeclineMutate: vi.fn(),
  // Invalidation
  mockInvalidateOverview: vi.fn(),
  mockInvalidateAccountGroups: vi.fn(),
  mockInvalidateGroupsGet: vi.fn(),
  mockInvalidateInvitationsList: vi.fn(),
  // Toast
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
    overview: {
      get: {
        useQuery: mocks.mockUseOverviewQuery,
      },
    },
    account: {
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
      savedViews: {
        remove: {
          useMutation: () => ({
            mutateAsync: mocks.mockRemoveSavedView,
          }),
        },
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
      overview: {
        get: {
          invalidate: mocks.mockInvalidateOverview,
        },
      },
      account: {
        overview: {
          invalidate: mocks.mockInvalidateOverview,
        },
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

vi.mock('@/lib/use-current-account', () => ({
  useCurrentAccount: () => ({
    data: { name: 'Alice' },
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
  useNavigate: () => mocks.mockRouterPush,
}))

// ── SUT (imported after mocks) ──────────────────────────────────────────

import { RecentGroupList } from '@/app/groups/recent-group-list'

// ── Helpers ─────────────────────────────────────────────────────────────

function makeGroup(overrides: Record<string, unknown> = {}) {
  const name = (overrides.name as string | undefined) ?? 'Test Group'
  return {
    id: 'group-1',
    name,
    archived: false,
    groupType: 'GROUP' as const,
    displayName: name,
    memberCount: 4,
    currentMemberRole: 'ADMIN' as const,
    preference: { starred: false, hidden: false },
    createdAt: '2026-06-01T00:00:00Z',
    ledger: { currency: '$', currencyCode: 'USD' },
    memberAccounts: [],
    financialSummary: {
      expenseCount: 0,
      netBalance: 0,
      state: 'NO_EXPENSES' as const,
      latestExpenseCreatedAt: null,
    },
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
    mocks.mockUseOverviewQuery.mockReturnValue({
      data: {
        groups: [],
        stats: {
          balanceSummaries: [],
        },
      },
      isLoading: false,
    })
    mocks.mockUseInvitationsQuery.mockReturnValue({
      data: { invitations: [] },
      isLoading: false,
    })
    mocks.mockSetPreference.mockResolvedValue(undefined)
    mocks.mockArchiveGroup.mockResolvedValue(undefined)
    mocks.mockRemoveSavedView.mockResolvedValue(undefined)
    mocks.mockInvalidateAccountGroups.mockResolvedValue(undefined)
    mocks.mockInvalidateOverview.mockResolvedValue(undefined)
    mocks.mockInvalidateGroupsGet.mockResolvedValue(undefined)
    mocks.mockInvalidateInvitationsList.mockResolvedValue(undefined)
  })

  it('groups cross-group balances by direction and currency', async () => {
    mocks.mockUseOverviewQuery.mockReturnValue({
      data: {
        groups: [
          makeGroup({
            id: 'group-owed-1',
            name: 'Beach trip',
            displayName: 'Beach trip',
            ledger: { currency: '$', currencyCode: 'USD' },
            financialSummary: {
              expenseCount: 2,
              netBalance: 700,
              state: 'OWED_TO_YOU',
              latestExpenseCreatedAt: null,
            },
          }),
          makeGroup({
            id: 'group-owed-2',
            name: 'Cabin weekend',
            displayName: 'Cabin weekend',
            ledger: { currency: '$', currencyCode: 'USD' },
            financialSummary: {
              expenseCount: 1,
              netBalance: 500,
              state: 'OWED_TO_YOU',
              latestExpenseCreatedAt: null,
            },
          }),
          makeGroup({
            id: 'group-euro',
            name: 'Paris trip',
            displayName: 'Paris trip',
            ledger: { currency: '€', currencyCode: 'EUR' },
            financialSummary: {
              expenseCount: 1,
              netBalance: 1000,
              state: 'OWED_TO_YOU',
              latestExpenseCreatedAt: null,
            },
          }),
        ],
        stats: {
          balanceSummaries: [
            {
              currency: '$',
              currencyCode: 'USD',
              owedToYou: 1200,
              owedToYouGroupCount: 2,
              youOwe: 0,
              youOweGroupCount: 0,
            },
            {
              currency: '€',
              currencyCode: 'EUR',
              owedToYou: 1000,
              owedToYouGroupCount: 1,
              youOwe: 0,
              youOweGroupCount: 0,
            },
          ],
        },
      },
      isLoading: false,
    })

    const { user } = render(<RecentGroupList />)
    const overview = within(screen.getByRole('region', { name: 'Balances' }))

    expect(overview.getByText('Across your groups')).toBeInTheDocument()
    expect(overview.getByText('You are owed')).toBeInTheDocument()
    expect(overview.getByText('You owe')).toBeInTheDocument()
    expect(overview.getByText("You don't owe anyone")).toBeInTheDocument()
    expect(overview.queryByText(/friend/i)).not.toBeInTheDocument()
    expect(overview.getByTestId('overview-groups-owed-rows')).toHaveClass(
      'max-h-[min(65vh,32rem)]',
      'overflow-y-auto',
    )
    expect(overview.getByText('$12.00')).toBeInTheDocument()
    expect(overview.getByText('$12.00').parentElement).toHaveTextContent(
      '2 groups',
    )
    expect(overview.getByText('€10.00').parentElement).toHaveTextContent(
      '1 group',
    )
    await user.click(screen.getAllByRole('button', { name: 'View groups' })[0])
    expect(screen.getAllByRole('link', { name: /Beach trip/ })).toHaveLength(1)
    expect(screen.getAllByRole('link', { name: /Cabin weekend/ })).toHaveLength(
      1,
    )
  })

  it('switches to people balances and drills into contributing groups', async () => {
    mocks.mockUseOverviewQuery.mockReturnValue({
      data: {
        groups: [makeGroup()],
        stats: {
          balanceSummaries: [],
          peopleBalances: [
            {
              key: 'account-bob',
              name: 'Bob',
              account: { id: 'account-bob', name: 'Bob', image: null },
              currencies: [
                {
                  currency: '$',
                  currencyCode: 'USD',
                  netAmount: 600,
                  groups: [
                    {
                      groupId: 'group-1',
                      groupName: 'Beach trip',
                      amount: 800,
                    },
                    {
                      groupId: 'group-2',
                      groupName: 'Cabin weekend',
                      amount: -200,
                    },
                  ],
                },
                {
                  currency: '€',
                  currencyCode: 'EUR',
                  netAmount: 500,
                  groups: [
                    {
                      groupId: 'group-3',
                      groupName: 'Paris trip',
                      amount: 500,
                    },
                  ],
                },
              ],
            },
          ],
        },
      },
      isLoading: false,
    })

    const { user } = render(<RecentGroupList />)
    await user.click(screen.getByRole('tab', { name: 'People' }))

    const overview = within(screen.getByRole('region', { name: 'Balances' }))
    expect(overview.getByText('Bob')).toBeInTheDocument()
    expect(overview.getByText('$6.00')).toBeInTheDocument()
    expect(overview.getByText('€5.00')).toBeInTheDocument()
    expect(overview.getByTestId('overview-people-owed-rows')).toHaveClass(
      'max-h-[min(65vh,32rem)]',
      'overflow-y-auto',
    )
    expect(
      overview.getAllByRole('button', { name: /View groups for Bob/ }),
    ).toHaveLength(2)

    await user.click(
      overview.getAllByRole('button', { name: /View groups for Bob/ })[0],
    )
    expect(screen.getByRole('link', { name: /Beach trip/ })).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: /Cabin weekend/ }),
    ).toBeInTheDocument()
  })

  it('keeps each populated direction independently scrollable', async () => {
    mocks.mockUseOverviewQuery.mockReturnValue({
      data: {
        groups: [
          makeGroup({
            id: 'group-owed',
            financialSummary: {
              expenseCount: 1,
              netBalance: 100,
              state: 'OWED_TO_YOU',
              latestExpenseCreatedAt: null,
            },
          }),
          makeGroup({
            id: 'group-owe',
            financialSummary: {
              expenseCount: 1,
              netBalance: -100,
              state: 'YOU_OWE',
              latestExpenseCreatedAt: null,
            },
          }),
        ],
        stats: {
          balanceSummaries: [
            {
              currency: '$',
              currencyCode: 'USD',
              owedToYou: 100,
              owedToYouGroupCount: 1,
              youOwe: 100,
              youOweGroupCount: 1,
            },
          ],
          peopleBalances: [
            {
              key: 'account-bob',
              name: 'Bob',
              account: { id: 'account-bob', name: 'Bob', image: null },
              currencies: [
                {
                  currency: '$',
                  currencyCode: 'USD',
                  netAmount: 100,
                  groups: [
                    { groupId: 'group-owed', groupName: 'Owed', amount: 100 },
                  ],
                },
              ],
            },
            {
              key: 'account-cara',
              name: 'Cara',
              account: { id: 'account-cara', name: 'Cara', image: null },
              currencies: [
                {
                  currency: '$',
                  currencyCode: 'USD',
                  netAmount: -100,
                  groups: [
                    { groupId: 'group-owe', groupName: 'Owe', amount: -100 },
                  ],
                },
              ],
            },
          ],
        },
      },
      isLoading: false,
    })

    const { user } = render(<RecentGroupList />)
    const overview = within(screen.getByRole('region', { name: 'Balances' }))
    const scrollClasses = [
      'max-h-[min(65vh,32rem)]',
      'overflow-y-auto',
    ] as const

    expect(overview.getByTestId('overview-groups-owed-rows')).toHaveClass(
      ...scrollClasses,
    )
    expect(overview.getByTestId('overview-groups-owe-rows')).toHaveClass(
      ...scrollClasses,
    )

    await user.click(screen.getByRole('tab', { name: 'People' }))

    expect(overview.getByTestId('overview-people-owed-rows')).toHaveClass(
      ...scrollClasses,
    )
    expect(overview.getByTestId('overview-people-owe-rows')).toHaveClass(
      ...scrollClasses,
    )
  })

  it('shows settled status when groups exist without rendering zero friend text', () => {
    mocks.mockUseOverviewQuery.mockReturnValue({
      data: {
        groups: [makeGroup()],
        stats: { balanceSummaries: [] },
      },
      isLoading: false,
    })

    render(<RecentGroupList />)

    const summary = within(screen.getByRole('region', { name: 'Balances' }))
    expect(summary.getByText('No one owes you')).toBeInTheDocument()
    expect(summary.getByText("You don't owe anyone")).toBeInTheDocument()
    expect(summary.getByText('Settled up')).toBeInTheDocument()
    expect(summary.queryByText(/friend/i)).not.toBeInTheDocument()
  })

  // ── Loading state ───────────────────────────────────────────────────

  it('shows loader while groups are loading', () => {
    mocks.mockUseOverviewQuery.mockReturnValue({
      data: undefined,
      isLoading: true,
    })

    render(<RecentGroupList />)

    // The component renders a Loader2 spinner with loading text
    expect(screen.getByText(/loading recent/i)).toBeInTheDocument()
  })

  // ── Empty state (no groups at all) ──────────────────────────────────

  it('shows inline create cards when no groups at all', () => {
    mocks.mockUseOverviewQuery.mockReturnValue({
      data: {
        groups: [],
        stats: {
          balanceSummaries: [],
        },
      },
      isLoading: false,
    })

    render(<RecentGroupList />)

    // The Groups and Friends sections are always shown with their
    // inline create cards as the first card.
    expect(screen.getByTestId('create-group-card')).toBeInTheDocument()
    expect(screen.getByTestId('create-friend-ledger-card')).toBeInTheDocument()
    expect(screen.getByTestId('create-group-card')).toHaveAttribute(
      'href',
      '/groups/create',
    )
    expect(screen.getByTestId('create-friend-ledger-card')).toHaveAttribute(
      'href',
      '/friends/create',
    )
    // Import is now an action inside the create group card.
    const importLink = screen.getByTestId('import-group-action')
    expect(importLink).toHaveAttribute('href', '/groups/import')
    // No standalone EmptyState copy remains for the "zero items" case.
    expect(screen.queryByText(/no groups yet/i)).not.toBeInTheDocument()
    expect(
      screen.queryByText(/create your first group/i),
    ).not.toBeInTheDocument()
  })

  // ── Empty state with hidden groups ──────────────────────────────────

  it('keeps the Groups section visible and shows the Hidden section collapsed when only hidden groups exist', () => {
    const hiddenGroup = makeGroup({
      preference: { starred: false, hidden: true },
    })
    mocks.mockUseOverviewQuery.mockReturnValue({
      data: {
        groups: [hiddenGroup],
        stats: {
          balanceSummaries: [],
        },
      },
      isLoading: false,
    })

    render(<RecentGroupList />)

    // Groups section heading is always visible even when Groups is empty.
    expect(screen.getByRole('button', { name: 'Groups' })).toBeInTheDocument()
    // The Hidden section exists with its heading trigger collapsed.
    const hiddenHeading = screen.getByText('Hidden')
    const hiddenTrigger = hiddenHeading.closest('button')!
    expect(hiddenTrigger).toHaveAttribute('aria-expanded', 'false')
    // No "all your groups are hidden" empty-state banner.
    expect(
      screen.queryByText(/all your groups are hidden/i),
    ).not.toBeInTheDocument()
  })

  // ── Starred section ─────────────────────────────────────────────────

  it('renders starred groups in starred section', () => {
    const starredGroup = makeGroup({
      id: 'g-star',
      name: 'Starred Trip',
      displayName: 'Starred Trip',
      preference: { starred: true, hidden: false },
    })
    mocks.mockUseOverviewQuery.mockReturnValue({
      data: {
        groups: [starredGroup],
        stats: {
          balanceSummaries: [],
        },
      },
      isLoading: false,
    })

    render(<RecentGroupList />)

    // Starred section heading
    expect(screen.getByText('Starred')).toBeInTheDocument()
    // Group displayName is rendered as a link
    expect(screen.getByText('Starred Trip')).toBeInTheDocument()
  })

  // ── Active / Recent section ─────────────────────────────────────────

  it('renders active groups in Groups section', () => {
    const activeGroup = makeGroup({
      id: 'g-active',
      name: 'Active Trip',
      displayName: 'Active Trip',
      preference: { starred: false, hidden: false },
    })
    mocks.mockUseOverviewQuery.mockReturnValue({
      data: {
        groups: [activeGroup],
        stats: {
          balanceSummaries: [],
        },
      },
      isLoading: false,
    })

    render(<RecentGroupList />)

    // "Groups" heading appears when there are non-starred groups
    expect(screen.getByRole('button', { name: 'Groups' })).toBeInTheDocument()
    expect(screen.getByText('Active Trip')).toBeInTheDocument()
  })

  // ── Archived section ────────────────────────────────────────────────

  it('renders archived groups in a collapsed section with a chevron toggle', () => {
    const archivedGroup = makeGroup({
      id: 'g-arch',
      name: 'Old Trip',
      displayName: 'Old Trip',
      archived: true,
      preference: { starred: false, hidden: false },
    })
    mocks.mockUseOverviewQuery.mockReturnValue({
      data: {
        groups: [archivedGroup],
        stats: {
          balanceSummaries: [],
        },
      },
      isLoading: false,
    })

    render(<RecentGroupList />)

    // Archived heading is rendered; the trigger button is collapsed.
    const archivedHeading = screen.getByText('Archived groups')
    expect(archivedHeading).toBeInTheDocument()
    const trigger = archivedHeading.closest('button')!
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
  })

  // ── Star toggle ─────────────────────────────────────────────────────

  it('star toggle calls setPreference and invalidates groups', async () => {
    const group = makeGroup({ id: 'g-star-toggle' })
    mocks.mockUseOverviewQuery.mockReturnValue({
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
      expect(mocks.mockInvalidateOverview).toHaveBeenCalled()
    })
  })

  it('un-star toggles starred off', async () => {
    const group = makeGroup({
      id: 'g-unstar',
      preference: { starred: true, hidden: false },
    })
    mocks.mockUseOverviewQuery.mockReturnValue({
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

  it('lets a signed-in user star, hide, and remove a view-only bookmark', async () => {
    const group = makeGroup({
      id: 'g-view-only',
      name: 'Cabin trip',
      displayName: 'Cabin trip',
      access: 'VIEW_ONLY',
      viewKey: 'secret',
    })
    mocks.mockUseOverviewQuery.mockReturnValue({
      data: { groups: [group] },
      isLoading: false,
    })

    const { user } = render(<RecentGroupList />)

    await user.click(screen.getByRole('button', { name: /star group/i }))
    expect(mocks.mockSetPreference).toHaveBeenCalledWith({
      groupId: 'g-view-only',
      starred: true,
    })

    await user.click(screen.getByRole('button', { name: /group actions/i }))
    await user.click(screen.getByText('Hide group'))
    expect(mocks.mockSetPreference).toHaveBeenCalledWith({
      groupId: 'g-view-only',
      hidden: true,
    })

    await user.click(screen.getByRole('button', { name: /group actions/i }))
    await user.click(screen.getByText('Remove'))
    expect(mocks.mockRemoveSavedView).toHaveBeenCalledWith({
      groupId: 'g-view-only',
    })
  })

  // ── Hide toggle ─────────────────────────────────────────────────────

  it('hide toggles hidden state from dropdown menu', async () => {
    const group = makeGroup({ id: 'g-hide' })
    mocks.mockUseOverviewQuery.mockReturnValue({
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
    mocks.mockUseOverviewQuery.mockReturnValue({
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
    expect(mocks.mockInvalidateOverview).toHaveBeenCalled()
    expect(mocks.mockInvalidateGroupsGet).toHaveBeenCalledWith({
      groupId: 'g-arch-admin',
    })
  })

  it('does not show archive action for non-ADMIN members', async () => {
    const group = makeGroup({
      id: 'g-member',
      currentMemberRole: 'MEMBER',
    })
    mocks.mockUseOverviewQuery.mockReturnValue({
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
    mocks.mockUseOverviewQuery.mockReturnValue({
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
    mocks.mockUseOverviewQuery.mockReturnValue({
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
    mocks.acceptOnSuccess?.({ groupId: 'group-1' })

    // After success: navigate to the group
    await waitFor(() => {
      expect(mocks.mockRouterPush).toHaveBeenCalledWith({
        to: '/groups/$groupId',
        params: { groupId: 'group-1' },
      })
    })
    // Also invalidates account groups and invitations list
    expect(mocks.mockInvalidateAccountGroups).toHaveBeenCalled()
    expect(mocks.mockInvalidateOverview).toHaveBeenCalled()
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
    mocks.declineOnSuccess?.()

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
