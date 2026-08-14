import { beforeEach, describe, expect, it, vi } from 'vitest'

import { BudgetFormPage } from '@/app/groups/[groupId]/budgets/budget-form-page'
import { render, screen } from '@/test/test-utils'

const mockToast = vi.fn()
const mockNavigate = vi.fn()
const mockCreateMutateAsync = vi.fn()
const mockUpdateMutateAsync = vi.fn()
const mockInvalidate = vi.fn()
const mockCreateAttemptRun = vi.fn()

vi.mock(import('@/lib/hooks'), async (importActual) => {
  const actual = await importActual()
  return { ...actual, useMediaQuery: () => true }
})

vi.mock('@/components/ui/use-toast', () => ({
  useToast: () => ({ toast: mockToast }),
}))

vi.mock('@/lib/use-idempotent-create', () => ({
  useIdempotentCreate: () => ({ run: mockCreateAttemptRun }),
}))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mockNavigate,
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

let mockMemberRole = 'ADMIN'
vi.mock('@/app/groups/[groupId]/current-group-context', () => ({
  useCurrentGroup: () => ({
    groupId: 'group-1',
    group: fakeGroup,
    currentMember: { role: mockMemberRole },
  }),
  useIsReadOnlyGroupViewer: () => false,
}))

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
    committed: 0,
    history: [],
    matchingExpenses: [],
    upcomingExpenses: [],
  },
}

vi.mock('@/trpc/client', () => ({
  trpc: {
    useUtils: () => ({
      groups: {
        budgets: {
          get: { invalidate: mockInvalidate },
          list: { invalidate: mockInvalidate },
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
        create: {
          useMutation: () => ({
            mutateAsync: mockCreateMutateAsync,
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

describe('BudgetFormPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCreateAttemptRun.mockImplementation(
      (create: (requestId: string) => Promise<unknown>) =>
        create('00000000-0000-4000-8000-000000000001'),
    )
  })

  it('renders an empty create form when no budgetId is given', () => {
    render(<BudgetFormPage groupId="group-1" />)
    expect(screen.getByLabelText('Budget name')).toHaveValue('')
    expect(
      screen.getByRole('heading', { name: 'Create budget' }),
    ).toBeInTheDocument()
    expect(screen.getByTitle('Back to budgets')).toHaveAttribute(
      'href',
      '/groups/$groupId/budgets',
    )
  })

  it('prefills the form in edit mode', () => {
    render(<BudgetFormPage groupId="group-1" budgetId="budget-1" />)
    expect(screen.getByLabelText('Budget name')).toHaveValue('Groceries')
    expect(screen.getByRole('heading', { name: 'Edit' })).toBeInTheDocument()
  })

  it('lets members create budgets', () => {
    mockMemberRole = 'MEMBER'
    render(<BudgetFormPage groupId="group-1" />)
    expect(screen.getByLabelText('Budget name')).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'Create budget' }),
    ).toBeInTheDocument()
    mockMemberRole = 'ADMIN'
  })

  it('does not navigate when the single-flight guard ignores a submit', async () => {
    mockCreateAttemptRun.mockResolvedValue(null)
    const { user } = render(<BudgetFormPage groupId="group-1" />)

    await user.type(screen.getByLabelText('Budget name'), 'Groceries')
    await user.type(screen.getByLabelText('Amount'), '500')
    await user.click(screen.getByRole('button', { name: 'Save budget' }))

    await vi.waitFor(() => expect(mockCreateAttemptRun).toHaveBeenCalledOnce())
    expect(mockCreateMutateAsync).not.toHaveBeenCalled()
    expect(mockNavigate).not.toHaveBeenCalled()
  })
})
