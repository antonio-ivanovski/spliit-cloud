import { beforeEach, describe, expect, it, vi } from 'vitest'

import GroupBudgetsPageClient from '@/app/groups/[groupId]/budgets/page.client'
import { render, screen } from '@/test/test-utils'

const mocks = vi.hoisted(() => ({
  mockBudgetsListQuery: vi.fn(),
  mockUseOnlineStatus: vi.fn(() => true),
  mockUseOfflineBudgets: vi.fn(),
  mockUseOfflineWithoutData: vi.fn(() => false),
  mockUseServerUnreachableWithoutData: vi.fn(() => false),
}))

vi.mock('@/app/groups/[groupId]/current-group-context', () => ({
  useCurrentGroup: () => ({
    groupId: 'group-1',
    group: { archived: false },
    currentMember: { id: 'member-1', role: 'ADMIN' },
  }),
  useIsReadOnlyGroupViewer: () => false,
}))

vi.mock('@/app/groups/[groupId]/use-group-access-search', () => ({
  useGroupAccessSearch: () => ({
    linkInviteToken: undefined,
    viewKey: undefined,
  }),
}))

vi.mock('@/lib/use-online-status', () => ({
  useOnlineStatus: mocks.mockUseOnlineStatus,
  useOfflineWithoutData: mocks.mockUseOfflineWithoutData,
  useServerUnreachableWithoutData: mocks.mockUseServerUnreachableWithoutData,
}))

vi.mock('@/lib/offline/read-hooks', () => ({
  useOfflineBudgets: mocks.mockUseOfflineBudgets,
}))

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => (
    <span>{children}</span>
  ),
}))

vi.mock('@/trpc/client', () => ({
  trpc: {
    groups: {
      budgets: {
        list: { useQuery: mocks.mockBudgetsListQuery },
      },
    },
  },
}))

function budget(id: string, name: string, archived = false) {
  return {
    id,
    name,
    amount: 50000,
    periodType: 'MONTHLY',
    archived,
    categoryScope: 'ALL',
    categoryNodeIds: [],
    participantScope: 'ALL',
    participantIds: [],
    permissions: { canEdit: true, canArchive: true, canDelete: true },
    period: {
      from: '2026-07-01',
      to: '2026-07-31',
      used: 20000,
      limit: 50000,
      remaining: 30000,
      percentage: 40,
      projected: null,
      trendStatus: 'ON_TRACK',
      lifecycle: archived ? 'ARCHIVED' : 'ACTIVE',
      daysRemaining: 10,
      daysUntilStart: 0,
      daysTotal: 31,
      committed: 0,
      matchingExpensesTotal: 0,
      upcomingExpensesTotal: 0,
      daily: [],
    },
  }
}

function mockOnlineBudgets() {
  mocks.mockBudgetsListQuery.mockReturnValue({
    data: { budgets: [budget('bud-1', 'Groceries')] },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  })
}

function mockOfflineBudgets(dirtySince: Date | null = null) {
  mocks.mockBudgetsListQuery.mockReturnValue({
    data: undefined,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  })
  mocks.mockUseOfflineBudgets.mockReturnValue({
    data: {
      budgets: [budget('bud-1', 'Groceries'), budget('bud-old', 'Old', true)],
      dirtySince,
    },
    meta: {
      source: 'download',
      capturedAt: new Date('2026-07-01T00:00:00Z'),
      availability: 'ready',
      refreshing: false,
      incompleteGroupCount: 0,
    },
  })
}

describe('GroupBudgetsPageClient offline read-only', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.mockUseOnlineStatus.mockReturnValue(true)
    mocks.mockUseOfflineWithoutData.mockReturnValue(false)
    mocks.mockUseServerUnreachableWithoutData.mockReturnValue(false)
    mocks.mockUseOfflineBudgets.mockReturnValue({
      data: undefined,
      meta: {
        source: 'download',
        capturedAt: null,
        availability: 'missing',
        refreshing: false,
        incompleteGroupCount: 0,
      },
    })
    mockOnlineBudgets()
  })

  it('renders the live list online', () => {
    render(<GroupBudgetsPageClient />)

    expect(screen.getByText('Groceries')).toBeInTheDocument()
  })

  it('renders downloaded budgets read-only while offline', async () => {
    mocks.mockUseOnlineStatus.mockReturnValue(false)
    mocks.mockUseOfflineWithoutData.mockReturnValue(true)
    mockOfflineBudgets()
    const { user } = render(<GroupBudgetsPageClient />)

    expect(screen.getByText('Groceries')).toBeInTheDocument()
    // Archived budgets are included (the page requests includeArchived).
    await user.click(screen.getByRole('button', { name: 'Archived budgets' }))
    expect(screen.getByText('Old')).toBeInTheDocument()
    expect(screen.getByText('Reconnect to make changes')).toBeInTheDocument()
    expect(screen.queryByTestId('offline-empty-state')).not.toBeInTheDocument()
  })

  it('warns when the downloaded budgets may be out of date', () => {
    mocks.mockUseOnlineStatus.mockReturnValue(false)
    mocks.mockUseOfflineWithoutData.mockReturnValue(true)
    mockOfflineBudgets(new Date('2026-07-02T00:00:00Z'))
    render(<GroupBudgetsPageClient />)

    expect(
      screen.getByText('Some data may be out of date.'),
    ).toBeInTheDocument()
  })
})
