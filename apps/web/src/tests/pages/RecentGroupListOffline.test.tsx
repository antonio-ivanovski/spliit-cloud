import { beforeEach, describe, expect, it, vi } from 'vitest'

import { render, screen } from '@/test/test-utils'

const mocks = vi.hoisted(() => ({
  mockUseOverviewQuery: vi.fn(),
  mockUseInvitationsQuery: vi.fn(),
  mockUseOfflineOverview: vi.fn(),
  mockSetPreference: vi.fn(),
  mockArchiveGroup: vi.fn(),
  mockRemoveSavedView: vi.fn(),
}))

vi.mock('@/trpc/client', () => ({
  trpc: {
    overview: { get: { useQuery: mocks.mockUseOverviewQuery } },
    account: {
      setPreference: {
        useMutation: () => ({ mutateAsync: mocks.mockSetPreference }),
      },
    },
    groups: {
      archive: { useMutation: () => ({ mutateAsync: mocks.mockArchiveGroup }) },
      savedViews: {
        remove: {
          useMutation: () => ({ mutateAsync: mocks.mockRemoveSavedView }),
        },
      },
    },
    invitations: {
      listForAccount: { useQuery: mocks.mockUseInvitationsQuery },
      accept: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      decline: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
    useUtils: () => ({
      overview: { get: { invalidate: vi.fn() } },
      account: {
        overview: { invalidate: vi.fn() },
        groups: { invalidate: vi.fn() },
      },
      groups: { get: { invalidate: vi.fn() } },
      invitations: { listForAccount: { invalidate: vi.fn() } },
    }),
  },
}))

vi.mock('@/lib/offline/read-hooks', async (importOriginal) => {
  const original = (await importOriginal()) as Record<string, unknown>
  return {
    ...original,
    useOfflineOverview: mocks.mockUseOfflineOverview,
  }
})

vi.mock('@/lib/use-current-account', () => ({
  useCurrentAccount: () => ({ data: { name: 'Alice' } }),
}))

vi.mock('@/components/ui/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
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
  useNavigate: () => vi.fn(),
}))

import { RecentGroupList } from '@/app/groups/recent-group-list'

function makeGroup(overrides: Record<string, unknown> = {}) {
  const name = (overrides.name as string | undefined) ?? 'Offline Group'
  return {
    id: 'group-offline-1',
    name,
    archived: false,
    groupType: 'GROUP' as const,
    displayName: name,
    memberCount: 2,
    currentMemberRole: 'MEMBER' as const,
    preference: { starred: false, hidden: false },
    createdAt: '2026-06-01T00:00:00Z',
    ledger: { currency: '$', currencyCode: 'USD' },
    memberAccounts: [],
    financialSummary: {
      expenseCount: 1,
      netBalance: 100,
      state: 'OWED_TO_YOU' as const,
      latestExpenseCreatedAt: null,
    },
    ...overrides,
  }
}

describe('RecentGroupList offline fallback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: true,
    })
    mocks.mockUseInvitationsQuery.mockReturnValue({
      data: { invitations: [] },
      isLoading: false,
    })
    mocks.mockUseOfflineOverview.mockReturnValue({
      data: undefined,
      meta: { availability: 'loading', incompleteGroupCount: 0 },
    })
  })

  it('falls back to the offline download on online failure when ready', () => {
    // Online (navigator true) but the network query failed; offline is ready.
    mocks.mockUseOverviewQuery.mockReturnValue({
      data: undefined,
      error: new Error('Failed to fetch'),
      isLoading: false,
      refetch: vi.fn(),
    })
    mocks.mockUseOfflineOverview.mockReturnValue({
      data: {
        groups: [makeGroup({ name: 'Cached Trip' })],
        stats: { balanceSummaries: [], peopleBalances: [] },
        totalsAvailable: true,
        oldestCapturedAt: new Date(),
        dirtyGroupCount: 0,
      },
      meta: {
        source: 'download',
        availability: 'ready',
        refreshing: false,
        incompleteGroupCount: 0,
      },
    })

    render(<RecentGroupList />)

    // Offline branch renders cached groups even though we are online.
    expect(screen.getByText('Cached Trip')).toBeInTheDocument()
    // Online error copy must not win over the offline download.
    expect(screen.queryByText(/try again/i)).not.toBeInTheDocument()
  })

  it('hides the across-groups balance card when totals are incomplete', () => {
    mocks.mockUseOverviewQuery.mockReturnValue({
      data: undefined,
      error: new Error('Failed to fetch'),
      isLoading: false,
      refetch: vi.fn(),
    })
    mocks.mockUseOfflineOverview.mockReturnValue({
      data: {
        groups: [makeGroup({ name: 'Partial Trip' })],
        stats: { balanceSummaries: [], peopleBalances: [] },
        totalsAvailable: false,
        oldestCapturedAt: new Date(),
        dirtyGroupCount: 1,
      },
      meta: {
        source: 'download',
        availability: 'ready',
        refreshing: false,
        incompleteGroupCount: 1,
      },
    })

    render(<RecentGroupList />)

    expect(screen.getByText('Partial Trip')).toBeInTheDocument()
    // Reconnect hint shows, but settled-up balances never render from partial data.
    expect(screen.getByText(/reconnect to update totals/i)).toBeInTheDocument()
    expect(screen.queryByText('Settled up')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('region', { name: 'Balances' }),
    ).not.toBeInTheDocument()
  })

  it('flags dirty home cards as possibly out of date (P1-7)', () => {
    mocks.mockUseOverviewQuery.mockReturnValue({
      data: undefined,
      error: new Error('Failed to fetch'),
      isLoading: false,
      refetch: vi.fn(),
    })
    mocks.mockUseOfflineOverview.mockReturnValue({
      data: {
        groups: [
          makeGroup({ name: 'Stale Trip', dirtySince: new Date() }),
          makeGroup({
            id: 'group-offline-2',
            name: 'Fresh Trip',
            dirtySince: null,
          }),
        ],
        stats: { balanceSummaries: [], peopleBalances: [] },
        totalsAvailable: false,
        oldestCapturedAt: new Date(),
        dirtyGroupCount: 1,
      },
      meta: {
        source: 'download',
        availability: 'ready',
        refreshing: false,
        incompleteGroupCount: 0,
      },
    })

    render(<RecentGroupList />)

    expect(screen.getByText('Stale Trip')).toBeInTheDocument()
    expect(screen.getByText('Fresh Trip')).toBeInTheDocument()
    // Per-card stale flag mirrors the balances page copy.
    const staleNotes = screen.getAllByText(/balances may be out of date/i)
    expect(staleNotes).toHaveLength(1)
    expect(
      screen.getByTestId('group-card-stale-group-offline-1'),
    ).toBeInTheDocument()
    expect(
      screen.queryByTestId('group-card-stale-group-offline-2'),
    ).not.toBeInTheDocument()
  })
})
