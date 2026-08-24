import { describe, expect, it, vi } from 'vitest'

import { BudgetDetailModal } from '@/app/groups/[groupId]/budgets/detail.client'
import { render, screen } from '@/test/test-utils'

const mockToast = vi.fn()
const mockInvalidateGet = vi.fn()
const mockInvalidateList = vi.fn()
const mockArchiveMutate = vi.fn()
const mockDeleteMutate = vi.fn()
const mockUpdateMutateAsync = vi.fn()
const mockNavigate = vi.fn()

vi.mock(import('@/lib/hooks'), async (importActual) => {
  const actual = await importActual()
  return {
    ...actual,
    useMediaQuery: () => true,
    useActiveUser: () => null,
  }
})

vi.mock('@/components/ui/use-toast', () => ({
  useToast: () => ({ toast: mockToast }),
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
  useNavigate: () => mockNavigate,
}))

vi.mock('@/app/groups/[groupId]/use-group-access-search', () => ({
  useGroupAccessSearch: () => ({
    linkInviteToken: undefined,
    viewKey: undefined,
  }),
}))

const fakeGroup = {
  currency: '$',
  currencyCode: 'USD',
  archived: false,
  participants: [
    { id: 'p1', name: 'Alice' },
    { id: 'p2', name: 'Bob' },
  ],
}

vi.mock('@/app/groups/[groupId]/current-group-context', () => ({
  useCurrentGroup: () => ({
    groupId: 'group-1',
    group: fakeGroup,
    currentMember: { role: 'ADMIN' },
  }),
  useCurrentGroupOrNull: () => ({
    groupId: 'group-1',
    group: fakeGroup,
    currentMember: { role: 'ADMIN' },
  }),
  useIsReadOnlyGroupViewer: () => false,
}))

function buildExpense(overrides: Record<string, unknown>) {
  return {
    id: 'expense-1',
    title: 'Supermarket',
    amount: 20000,
    createdAt: '2026-07-10T00:00:00Z',
    expenseDate: '2026-07-10',
    expenseTimeZone: 'UTC',
    categoryId: 'groceries',
    category: {
      id: 'groceries',
      grouping: 'Food and Drink',
      name: 'Groceries',
    },
    splitMode: 'EVENLY',
    paidBySplitMode: 'BY_AMOUNT',
    originalAmount: null,
    originalCurrency: null,
    conversionRate: null,
    conversionSource: null,
    recurrenceSequence: null,
    items: [],
    paidByList: [
      {
        ledgerParticipant: {
          id: 'p1',
          name: 'Alice',
          account: null,
          removed: false,
        },
        shares: 20000,
      },
    ],
    paidFor: [
      {
        ledgerParticipant: {
          id: 'p1',
          name: 'Alice',
          account: null,
          removed: false,
        },
        shares: 1,
      },
      {
        ledgerParticipant: {
          id: 'p2',
          name: 'Bob',
          account: null,
          removed: false,
        },
        shares: 1,
      },
    ],
    recurringSeriesId: null,
    recurringSeriesStatus: null,
    documentCount: 0,
    permissions: {
      canEdit: true,
      canDelete: true,
      canManageRecurrence: false,
    },
    contribution: 20000,
    ...overrides,
  }
}

const fakeBudget = {
  id: 'budget-1',
  name: 'Groceries',
  amount: 50000,
  periodType: 'MONTHLY',
  customStart: null,
  customEnd: null,
  categoryScope: 'ALL',
  categoryNodeIds: [],
  participantScope: 'ALL',
  participantIds: [],
  archived: false,
  notifyTrending: true,
  notifyOver: false,
  permissions: {
    canEdit: true,
    canArchive: true,
    canDelete: true,
  },
  period: {
    from: '2026-07-01',
    to: '2026-07-31',
    used: 20000,
    limit: 50000,
    remaining: 30000,
    percentage: 40,
    projected: 45000,
    trendStatus: 'ON_TRACK',
    daysRemaining: 10,
    daysTotal: 31,
    committed: 10000,
    history: [],
    matchingExpenses: [buildExpense({})],
    upcomingExpenses: [
      buildExpense({
        id: 'expense-2',
        title: 'Future rent',
        amount: 10000,
        contribution: 10000,
        expenseDate: '2030-07-25',
      }),
    ],
  },
}

vi.mock('@/trpc/client', () => ({
  trpc: {
    useUtils: () => ({
      groups: {
        budgets: {
          get: { invalidate: mockInvalidateGet },
          list: { invalidate: mockInvalidateList },
        },
      },
    }),
    groups: {
      budgets: {
        get: {
          useQuery: () => ({
            data: { budget: fakeBudget },
            isLoading: false,
            error: null,
          }),
        },
        archive: {
          useMutation: () => ({ mutate: mockArchiveMutate, isPending: false }),
        },
        delete: {
          useMutation: () => ({
            mutate: mockDeleteMutate,
            mutateAsync: mockDeleteMutate,
            isPending: false,
          }),
        },
        update: {
          useMutation: () => ({
            mutateAsync: mockUpdateMutateAsync,
            isPending: false,
          }),
        },
      },
    },
  },
}))

describe('BudgetDetailModal', () => {
  it('renders the budget hero, sections, and matching expenses', () => {
    render(<BudgetDetailModal budgetId="budget-1" onClose={vi.fn()} />)

    expect(
      screen.getByRole('heading', { name: 'Groceries' }),
    ).toBeInTheDocument()
    expect(screen.getByText('On track')).toBeInTheDocument()
    expect(screen.getByText('Notifications')).toBeInTheDocument()
    expect(screen.getByText('Trending over budget')).toBeInTheDocument()
    expect(screen.getByText('Matching expenses')).toBeInTheDocument()
    expect(screen.getByText('Upcoming expenses')).toBeInTheDocument()
    expect(screen.getByText('Supermarket')).toBeInTheDocument()
    expect(screen.getByText('Future rent')).toBeInTheDocument()
    expect(screen.getByText('Period history')).toBeInTheDocument()
    expect(screen.getByText('No completed periods yet.')).toBeInTheDocument()
  })

  it('shows the scope section with All chips and no usage bar', () => {
    render(<BudgetDetailModal budgetId="budget-1" onClose={vi.fn()} />)

    expect(screen.getByText('Scope')).toBeInTheDocument()
    expect(screen.getByText('All categories')).toBeInTheDocument()
    expect(screen.getByText('All participants')).toBeInTheDocument()
    expect(screen.queryByTestId('budget-usage-track')).toBeNull()
  })

  it('shows edit, archive, and delete actions for admins', () => {
    render(<BudgetDetailModal budgetId="budget-1" onClose={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'Edit' })).toHaveAttribute(
      'href',
      '/groups/$groupId/budgets/$budgetId/edit',
    )
    expect(screen.getByRole('button', { name: 'Archive' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument()
  })

  it('links to the edit page', () => {
    render(<BudgetDetailModal budgetId="budget-1" onClose={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'Edit' })).toHaveAttribute(
      'href',
      '/groups/$groupId/budgets/$budgetId/edit',
    )
  })

  it('archives via the archive mutation', async () => {
    const { user } = render(
      <BudgetDetailModal budgetId="budget-1" onClose={vi.fn()} />,
    )

    await user.click(screen.getByRole('button', { name: 'Archive' }))

    expect(mockArchiveMutate).toHaveBeenCalledWith({
      groupId: 'group-1',
      budgetId: 'budget-1',
      archived: true,
    })
  })

  it('confirms deletion through the delete dialog', async () => {
    const { user } = render(
      <BudgetDetailModal budgetId="budget-1" onClose={vi.fn()} />,
    )

    // DeletePopup trigger.
    await user.click(screen.getByRole('button', { name: /Delete/i }))
    // Confirm button inside the popup: matches `Yes` (en-US strings).
    const confirm = await screen.findByRole('button', { name: /Yes/i })
    await user.click(confirm)

    expect(mockDeleteMutate).toHaveBeenCalledWith({
      groupId: 'group-1',
      budgetId: 'budget-1',
    })
  })
})
