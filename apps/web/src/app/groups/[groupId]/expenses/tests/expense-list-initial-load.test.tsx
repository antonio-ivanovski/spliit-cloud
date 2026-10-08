import { beforeEach, describe, expect, it, vi } from 'vitest'

import { render, screen } from '@/test/test-utils'

const mocks = vi.hoisted(() => ({
  mockUseOfflineExpenses: vi.fn(),
  mockUseInfiniteQuery: vi.fn(),
  mockUseCurrentGroup: vi.fn(),
  mockUseCurrentGroupOrNull: vi.fn(),
  mockUseCurrentAccount: vi.fn(() => ({ data: null })),
  mockUseSyncedAccountPreferences: vi.fn(() => null),
}))

// Single source: ExpenseList no longer runs its own tRPC infinite query.
// The unified offline-first hook owns the network query internally.
vi.mock('@/lib/offline/read-hooks', () => ({
  useOfflineExpenses: mocks.mockUseOfflineExpenses,
}))

vi.mock('@/trpc/client', () => ({
  trpc: {
    groups: {
      expenses: {
        list: {
          useInfiniteQuery: mocks.mockUseInfiniteQuery,
        },
        commonCurrencies: {
          useQuery: () => ({ data: { currencies: ['EUR'] }, isLoading: false }),
        },
      },
    },
    useUtils: () => ({
      groups: { expenses: { invalidate: vi.fn() } },
    }),
  },
}))

vi.mock('@/app/groups/[groupId]/current-group-context', () => ({
  useCurrentGroup: mocks.mockUseCurrentGroup,
  useCurrentGroupOrNull: mocks.mockUseCurrentGroupOrNull,
  useIsReadOnlyGroupViewer: () => false,
}))

vi.mock('@/lib/use-current-account', () => ({
  useCurrentAccount: mocks.mockUseCurrentAccount,
}))

vi.mock('@/components/account-preferences-sync', () => ({
  useSyncedAccountPreferences: mocks.mockUseSyncedAccountPreferences,
}))

vi.mock('react-intersection-observer', () => ({
  useInView: () => ({ ref: vi.fn(), inView: false }),
}))

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => (
    <a href={to}>{children}</a>
  ),
  useNavigate: vi.fn(),
  useSearch: vi.fn(() => ({})),
  useLocation: vi.fn(() => ({ pathname: '/groups/group-1', searchStr: '' })),
}))

import { ExpenseList } from '@/app/groups/[groupId]/expenses/expense-list'

function loadingGroup() {
  const value = {
    isLoading: true as const,
    groupId: 'group-1',
    group: undefined,
    displayName: undefined,
    currentLedgerParticipantId: undefined,
    currentMember: undefined,
    currentInvitation: undefined,
    linkInviteState: undefined,
    viewer: undefined,
  }
  mocks.mockUseCurrentGroup.mockReturnValue(value)
  mocks.mockUseCurrentGroupOrNull.mockReturnValue(value)
}

function loadedGroup() {
  const value = {
    isLoading: false as const,
    groupId: 'group-1',
    group: {
      id: 'group-1',
      name: 'Test Group',
      archived: false,
      currency: 'EUR',
      currencyCode: 'EUR',
      participants: [
        {
          id: 'lp1',
          name: 'Alice',
          account: null,
          pending: false,
          unlinked: false,
        },
        {
          id: 'lp2',
          name: 'Bob',
          account: null,
          pending: false,
          unlinked: false,
        },
      ],
    },
    displayName: 'Test Group',
    currentLedgerParticipantId: 'lp1',
    currentMember: { id: 'cm-1', role: 'ADMIN', status: 'ACTIVE' },
    currentInvitation: null,
    linkInviteState: null,
    viewer: undefined,
  }
  mocks.mockUseCurrentGroup.mockReturnValue(value)
  mocks.mockUseCurrentGroupOrNull.mockReturnValue(value)
}

function emptyReady() {
  return {
    data: { pages: [{ expenses: [], hasMore: false, nextOffset: null }] },
    meta: { availability: 'ready', source: 'network', refreshing: false },
    hasMore: false,
    isLoading: false,
    fetchNextPage: vi.fn(),
    refetch: vi.fn(),
  }
}

describe('ExpenseList initial load', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: true,
    })
    mocks.mockUseCurrentAccount.mockReturnValue({ data: null })
    mocks.mockUseSyncedAccountPreferences.mockReturnValue(null)
    mocks.mockUseOfflineExpenses.mockReturnValue({
      data: undefined,
      meta: { availability: 'loading', source: 'download', refreshing: true },
      hasMore: false,
      isLoading: true,
      fetchNextPage: vi.fn(),
      refetch: vi.fn(),
    })
    mocks.mockUseInfiniteQuery.mockReturnValue({
      data: undefined,
      isLoading: true,
      isPlaceholderData: false,
      fetchNextPage: vi.fn(),
      refetch: vi.fn(),
    })
  })

  it('does not fire the expenses query until the group identity is ready', () => {
    loadingGroup()
    render(<ExpenseList />)

    expect(mocks.mockUseOfflineExpenses).toHaveBeenCalled()
    const options = mocks.mockUseOfflineExpenses.mock.calls.at(-1)?.[0] as {
      enabled?: boolean
    }
    // Bug reproduction: before the fix the query is enabled while the group
    // is still loading, so it fetches once with hideNotInvolving=undefined
    // and again with hideNotInvolving=true after the group resolves.
    expect(options?.enabled).toBe(false)
  })

  it('fetches once with involvement paging after the group resolves', () => {
    loadingGroup()
    const view = render(<ExpenseList />)
    vi.clearAllMocks()

    loadedGroup()
    mocks.mockUseOfflineExpenses.mockReturnValue(emptyReady())
    view.rerender(<ExpenseList />)

    expect(mocks.mockUseOfflineExpenses).toHaveBeenCalled()
    const options = mocks.mockUseOfflineExpenses.mock.calls.at(-1)?.[0] as {
      enabled?: boolean
      collapseInvolving?: boolean
    }
    expect(options?.enabled ?? true).toBe(true)
    expect(options?.collapseInvolving).toBe(true)
    expect(screen.getByText(/any expense/i)).toBeInTheDocument()
  })
})
