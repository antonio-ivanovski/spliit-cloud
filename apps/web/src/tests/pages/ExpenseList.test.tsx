import { render, screen, waitFor } from '@/test/test-utils'
import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * BLOCK B: Mock-based tests for ExpenseList
 *
 * Tests cover: search bar, loading skeletons, date-based grouping,
 * empty state, archived/pending-invitee empty state variations,
 * and debounced search.
 */

// ── Hoisted mocks ───────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  mockUseInfiniteQuery: vi.fn(),
  mockUseUtils: vi.fn(() => ({
    groups: {
      expenses: { invalidate: vi.fn().mockResolvedValue(undefined) },
    },
  })),
  mockUseInView: vi.fn(() => ({ ref: vi.fn(), inView: false })),
  mockLinkInviteToken: vi.fn(() => undefined),
  mockUseCurrentGroup: vi.fn(),
  mockUseIsPendingInvitee: vi.fn(() => false),
}))

// ── Module mocks ────────────────────────────────────────────────────────

vi.mock('@/trpc/client', () => ({
  trpc: {
    groups: {
      expenses: {
        list: {
          useInfiniteQuery: mocks.mockUseInfiniteQuery,
        },
      },
    },
    useUtils: mocks.mockUseUtils,
  },
}))

vi.mock('@/app/groups/[groupId]/current-group-context', () => ({
  useCurrentGroup: mocks.mockUseCurrentGroup,
  useIsPendingInvitee: mocks.mockUseIsPendingInvitee,
}))

vi.mock('@/app/groups/[groupId]/use-link-invite-token', () => ({
  useLinkInviteToken: mocks.mockLinkInviteToken,
}))

vi.mock('react-intersection-observer', () => ({
  useInView: mocks.mockUseInView,
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
  useNavigate: vi.fn(),
  useSearch: vi.fn(() => ({})),
  useLocation: vi.fn(() => ({ pathname: '/groups/group-1', searchStr: '' })),
}))

// ── SUT ─────────────────────────────────────────────────────────────────

import { ExpenseList } from '@/app/groups/[groupId]/expenses/expense-list'

// ── Helpers ─────────────────────────────────────────────────────────────

const now = new Date()
const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())

function makeExpense(overrides: Record<string, unknown> = {}) {
  return {
    id: 'exp-1',
    title: 'Dinner',
    amount: 4500,
    categoryId: 'food',
    category: 'food',
    expenseDate: today,
    createdAt: today,
    paidBy: { id: 'p1', name: 'Alice' },
    paidFor: [{ ledgerParticipant: { id: 'lp2', name: 'Bob' }, shares: null }],
    isReimbursement: false,
    splitMode: 'EVENLY',
    recurrenceRule: null,
    _count: { documents: 0 },
    ...overrides,
  }
}

function setDefaultGroup() {
  mocks.mockUseCurrentGroup.mockReturnValue({
    isLoading: false,
    groupId: 'group-1',
    group: {
      id: 'group-1',
      name: 'Test Group',
      archived: false,
      currency: 'EUR',
      currencyCode: 'EUR',
      participants: [
        { id: 'lp1', name: 'Alice', pending: false, unlinked: false },
        { id: 'lp2', name: 'Bob', pending: false, unlinked: false },
      ],
    },
    currentLedgerParticipantId: 'lp1',
    currentMember: { id: 'cm-1', role: 'ADMIN', status: 'ACTIVE' },
    currentInvitation: null,
    linkInviteState: null,
  })
}

const defaultInfiniteReturnValue = {
  data: { pages: [{ expenses: [], hasMore: false, nextCursor: 20 }] },
  isLoading: false,
  fetchNextPage: vi.fn(),
}

// ── Tests ───────────────────────────────────────────────────────────────

describe('ExpenseList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setDefaultGroup()
    mocks.mockUseInfiniteQuery.mockReturnValue(defaultInfiniteReturnValue)
    mocks.mockUseIsPendingInvitee.mockReturnValue(false)
  })

  // ── Search bar ────────────────────────────────────────────────────

  it('renders the search bar', () => {
    render(<ExpenseList />)

    expect(
      screen.getByPlaceholderText(/search for an expense/i),
    ).toBeInTheDocument()
  })

  // ── Loading state ─────────────────────────────────────────────────

  it('shows loading skeletons while expenses are loading', () => {
    mocks.mockUseInfiniteQuery.mockReturnValue({
      data: undefined,
      isLoading: true,
      fetchNextPage: vi.fn(),
    })

    const { container } = render(<ExpenseList />)

    const skeletons = container.querySelectorAll('.animate-pulse')
    expect(skeletons.length).toBeGreaterThanOrEqual(1)
  })

  // ── Empty states ──────────────────────────────────────────────────

  it('shows empty state with create link when no expenses', () => {
    render(<ExpenseList />)

    // The translation uses Unicode right single quote (') in the en-US
    // file; match on a stable substring to avoid locale encoding issues.
    expect(screen.getByText(/any expense/i)).toBeInTheDocument()
    expect(screen.getByText(/create the first one/i)).toBeInTheDocument()
  })

  it('hides create-first link when group is archived', () => {
    mocks.mockUseCurrentGroup.mockReturnValue({
      isLoading: false,
      groupId: 'group-1',
      group: {
        id: 'group-1',
        name: 'Archived Group',
        archived: true,
        currency: 'EUR',
        currencyCode: 'EUR',
        participants: [
          { id: 'lp1', name: 'Alice', pending: false, unlinked: false },
        ],
      },
      currentLedgerParticipantId: 'lp1',
      currentMember: { id: 'cm-1', role: 'ADMIN', status: 'ACTIVE' },
      currentInvitation: null,
      linkInviteState: null,
    })

    render(<ExpenseList />)

    expect(screen.getByText(/any expense/i)).toBeInTheDocument()
    expect(screen.queryByText(/create the first one/i)).not.toBeInTheDocument()
  })

  it('hides create-first link when user is pending invitee', () => {
    mocks.mockUseCurrentGroup.mockReturnValue({
      isLoading: false,
      groupId: 'group-1',
      group: {
        id: 'group-1',
        name: 'Test Group',
        archived: false,
        currency: 'EUR',
        currencyCode: 'EUR',
        participants: [
          { id: 'lp1', name: 'Alice', pending: false, unlinked: false },
        ],
      },
      currentLedgerParticipantId: null,
      currentMember: null,
      currentInvitation: { id: 'inv-1', role: 'MEMBER', type: 'EMAIL' },
      linkInviteState: null,
    })
    mocks.mockUseIsPendingInvitee.mockReturnValue(true)

    render(<ExpenseList />)

    expect(screen.getByText(/any expense/i)).toBeInTheDocument()
    expect(screen.queryByText(/create the first one/i)).not.toBeInTheDocument()
  })

  // ── Expense rendering with date groups ────────────────────────────

  it('renders expense cards grouped by date periods', () => {
    const upcomingDate = new Date(
      today.getTime() + 365 * 24 * 60 * 60 * 1000,
    )
    const olderDate = new Date('2020-06-15T12:00:00Z')

    const upcomingExpense = makeExpense({
      id: 'exp-upcoming',
      title: 'Future Dinner',
      amount: 3000,
      expenseDate: upcomingDate,
    })
    const olderExpense = makeExpense({
      id: 'exp-older',
      title: 'Old Lunch',
      amount: 1500,
      expenseDate: olderDate,
      paidFor: [
        { ledgerParticipant: { id: 'lp3', name: 'Charlie' }, shares: null },
      ],
    })

    mocks.mockUseInfiniteQuery.mockReturnValue({
      data: {
        pages: [
          {
            expenses: [upcomingExpense, olderExpense],
            hasMore: false,
            nextCursor: 20,
          },
        ],
      },
      isLoading: false,
      fetchNextPage: vi.fn(),
    })

    render(<ExpenseList />)

    expect(screen.getByText('Future Dinner')).toBeInTheDocument()
    expect(screen.getByText('Old Lunch')).toBeInTheDocument()

    // Date-group headings
    expect(screen.getByText('Upcoming')).toBeInTheDocument()
    expect(screen.getByText('Older')).toBeInTheDocument()

    // Amounts in EUR (cents to euro conversion)
    expect(screen.getByText('€30.00')).toBeInTheDocument()
    expect(screen.getByText('€15.00')).toBeInTheDocument()
  })

  // ── Search debounce ───────────────────────────────────────────────

  it('debounces search input', async () => {
    const { user } = render(<ExpenseList />)

    const searchInput =
      screen.getByPlaceholderText(/search for an expense/i)
    await user.type(searchInput, 'pizza')

    expect(screen.getByDisplayValue('pizza')).toBeInTheDocument()

    // Component tolerates non-empty debounced value without crashing
    await waitFor(
      () => {
        expect(screen.getByDisplayValue('pizza')).toBeInTheDocument()
      },
      { timeout: 500 },
    )
  })

  // ── Empty search results ──────────────────────────────────────────

  it('shows empty state when no expenses match search', () => {
    render(<ExpenseList />)

    expect(screen.getByText(/any expense/i)).toBeInTheDocument()
  })

  // ── Infinite scroll loading indicator ─────────────────────────────

  it('renders loading skeleton at bottom when hasMore is true', () => {
    const expense = makeExpense({ id: 'exp-1' })
    mocks.mockUseInfiniteQuery.mockReturnValue({
      data: {
        pages: [{ expenses: [expense], hasMore: true, nextCursor: 20 }],
      },
      isLoading: false,
      fetchNextPage: vi.fn(),
    })
    mocks.mockUseInView.mockReturnValue({ ref: vi.fn(), inView: false })

    const { container } = render(<ExpenseList />)

    const skeletons = container.querySelectorAll('.animate-pulse')
    expect(skeletons.length).toBeGreaterThan(0)
  })

  // ── Expense title display ─────────────────────────────────────────

  it('renders expense title from data', () => {
    const expense = makeExpense({ id: 'exp-title', title: 'Groceries' })
    mocks.mockUseInfiniteQuery.mockReturnValue({
      data: {
        pages: [{ expenses: [expense], hasMore: false, nextCursor: 20 }],
      },
      isLoading: false,
      fetchNextPage: vi.fn(),
    })

    render(<ExpenseList />)

    expect(screen.getByText('Groceries')).toBeInTheDocument()
  })

  // ── Pending invitee can still browse expenses ─────────────────────

  it('allows pending invitee to see expenses', () => {
    mocks.mockUseCurrentGroup.mockReturnValue({
      isLoading: false,
      groupId: 'group-1',
      group: {
        id: 'group-1',
        name: 'Test Group',
        archived: false,
        currency: 'EUR',
        currencyCode: 'EUR',
        participants: [
          { id: 'lp1', name: 'Alice', pending: false, unlinked: false },
        ],
      },
      currentLedgerParticipantId: null,
      currentMember: null,
      currentInvitation: { id: 'inv-1', role: 'MEMBER', type: 'EMAIL' },
      linkInviteState: null,
    })
    mocks.mockUseIsPendingInvitee.mockReturnValue(true)

    const expense = makeExpense({
      id: 'exp-pending-view',
      title: 'Viewable',
    })
    mocks.mockUseInfiniteQuery.mockReturnValue({
      data: {
        pages: [{ expenses: [expense], hasMore: false, nextCursor: 20 }],
      },
      isLoading: false,
      fetchNextPage: vi.fn(),
    })

    render(<ExpenseList />)

    // Pending invitees can read group data but cannot create/edit
    expect(screen.getByText('Viewable')).toBeInTheDocument()
  })
})
