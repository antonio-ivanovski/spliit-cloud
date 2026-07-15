import { CreateReimbursementModal } from '@/app/groups/[groupId]/balances/create-reimbursement-modal'
import {
  useCurrentGroup,
  useIsPendingInvitee,
} from '@/app/groups/[groupId]/current-group-context'
import { render, screen, waitFor, within } from '@/test/test-utils'
import { PAYMENT_CATEGORY_ID, RecurrenceRule } from '@spliit/domain'
import { describe, expect, it, vi } from 'vitest'

// ── Mocks ───────────────────────────────────────────────────────────────

const mockMutateAsync = vi.fn()
const mockInvalidateBalances = vi.fn()
const mockToast = vi.fn()
const mockNavigate = vi.fn()

vi.mock('@/app/groups/[groupId]/current-group-context', () => ({
  useCurrentGroup: vi.fn(),
  useCurrentGroupOrNull: vi.fn().mockReturnValue(null),
  useIsPendingInvitee: vi.fn(),
}))

vi.mock('@/app/groups/[groupId]/use-link-invite-token', () => ({
  useLinkInviteToken: vi.fn(() => undefined),
}))

vi.mock('@/app/groups/[groupId]/expenses/expense-mutation-hooks', () => ({
  useCreateExpenseMutation: () => ({
    mutateAsync: mockMutateAsync,
    isPending: false,
  }),
}))

vi.mock('@/trpc/client', () => ({
  trpc: {
    useUtils: () => ({
      groups: { balances: { invalidate: mockInvalidateBalances } },
    }),
  },
}))

vi.mock('@/components/ui/use-toast', () => ({
  useToast: () => ({ toast: mockToast }),
}))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mockNavigate,
  useRouter: () => ({}),
}))

// ── Fixtures ────────────────────────────────────────────────────────────

const EUR = { code: 'EUR', symbol: '€', decimal_digits: 2, rounding: 0 }
const USD = { code: 'USD', symbol: '$', decimal_digits: 2, rounding: 0 }

const reimbursement = { from: 'alice-id', to: 'bob-id', amount: 2500 }

function makeGroup({
  currencyCode = 'EUR',
  archived = false,
  participants = [
    { id: 'alice-id', name: 'Alice' },
    { id: 'bob-id', name: 'Bob' },
  ],
}: {
  currencyCode?: string
  archived?: boolean
  participants?: Array<{ id: string; name: string }>
} = {}) {
  return {
    id: 'group-1',
    name: 'Trip',
    information: null,
    archived,
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
    ledgerId: 'ledger-1',
    currency: currencyCode,
    currencyCode,
    groupType: 'GROUP' as const,
    friendPairKey: null,
    ledger: {
      id: 'ledger-1',
      currency: currencyCode,
      currencyCode,
      groupId: 'group-1',
      createdAt: new Date('2025-01-01'),
      updatedAt: new Date('2025-01-01'),
    },
    participants: participants.map((p, i) => ({
      id: p.id,
      name: p.name,
      ledgerId: 'ledger-1',
      groupId: 'group-1',
      createdAt: new Date('2025-01-01'),
      updatedAt: new Date('2025-01-01'),
      active: true,
      order: i,
      account: null,
    })),
    currentMember: null,
  }
}

function setupCurrentGroup({
  archived = false,
  currencyCode = 'EUR',
  participants = [
    { id: 'alice-id', name: 'Alice' },
    { id: 'bob-id', name: 'Bob' },
  ],
  isPendingInvitee = false,
}: {
  archived?: boolean
  currencyCode?: string
  participants?: Array<{ id: string; name: string }>
  isPendingInvitee?: boolean
} = {}) {
  vi.mocked(useCurrentGroup).mockReturnValue({
    isLoading: false,
    groupId: 'group-1',
    group: makeGroup({ archived, currencyCode, participants }) as never,
    displayName: 'Trip',
    currentLedgerParticipantId: null,
    currentMember: null,
    currentInvitation: isPendingInvitee ? ({} as never) : null,
    linkInviteState: null,
  })
  vi.mocked(useIsPendingInvitee).mockReturnValue(isPendingInvitee)
}

// ── Tests ───────────────────────────────────────────────────────────────

describe('CreateReimbursementModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupCurrentGroup()
  })

  it('renders a view-only summary of the reimbursement', () => {
    render(
      <CreateReimbursementModal
        groupId="group-1"
        reimbursement={reimbursement}
        currency={EUR}
        open={true}
        onOpenChange={vi.fn()}
      />,
    )

    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('Settlement payment')).toBeInTheDocument()
    expect(within(dialog).getByText('€25.00')).toBeInTheDocument()
    expect(within(dialog).getByText('Alice pays Bob')).toBeInTheDocument()
    expect(within(dialog).getByText('Alice')).toBeInTheDocument()
    expect(within(dialog).getByText('Bob')).toBeInTheDocument()
    expect(within(dialog).getByText('Payment')).toBeInTheDocument()
  })

  it('renders nothing actionable when reimbursement is null', () => {
    render(
      <CreateReimbursementModal
        groupId="group-1"
        reimbursement={null}
        currency={EUR}
        open={true}
        onOpenChange={vi.fn()}
      />,
    )

    expect(screen.queryByText('Alice pays Bob')).not.toBeInTheDocument()
    expect(screen.queryByTestId('reimbursement-create')).not.toBeInTheDocument()
    expect(screen.queryByTestId('reimbursement-edit')).not.toBeInTheDocument()
  })

  it('creates a reimbursement via mutation when clicking Create', async () => {
    mockMutateAsync.mockResolvedValue({ expenseId: 'new-expense' })
    mockInvalidateBalances.mockResolvedValue(undefined)

    const onOpenChange = vi.fn()
    const { user } = render(
      <CreateReimbursementModal
        groupId="group-1"
        reimbursement={reimbursement}
        currency={EUR}
        open={true}
        onOpenChange={onOpenChange}
      />,
    )

    await user.click(screen.getByTestId('reimbursement-create'))

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledTimes(1)
    })

    const call = mockMutateAsync.mock.calls[0][0]
    expect(call.groupId).toBe('group-1')
    expect(call.expense.category).toBe(PAYMENT_CATEGORY_ID)
    expect(call.expense.amount).toBe(2500)
    expect(call.expense.isReimbursement).toBe(true)
    expect(call.expense.paidBySplitMode).toBe('BY_AMOUNT')
    expect(call.expense.splitMode).toBe('EVENLY')
    expect(call.expense.isMultiPayer).toBe(false)
    expect(call.expense.documents).toEqual([])
    expect(call.expense.recurrenceRule).toBe(RecurrenceRule.NONE)
    expect(call.expense.paidByList).toEqual([
      { participant: 'alice-id', shares: 2500 },
    ])
    expect(call.expense.paidFor).toEqual([{ participant: 'bob-id', shares: 1 }])
    expect(call.expense.conversion).toBeUndefined()
    expect(mockInvalidateBalances).toHaveBeenCalledTimes(1)
    expect(mockToast).toHaveBeenCalledWith({
      description: 'Settlement payment recorded',
    })
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('includes exchange conversion when originalCurrencyCode differs from group currency', async () => {
    setupCurrentGroup({ currencyCode: 'EUR' })
    mockMutateAsync.mockResolvedValue({ expenseId: 'new-expense' })

    const { user } = render(
      <CreateReimbursementModal
        groupId="group-1"
        reimbursement={reimbursement}
        currency={USD}
        originalCurrencyCode="USD"
        open={true}
        onOpenChange={vi.fn()}
      />,
    )

    await user.click(screen.getByTestId('reimbursement-create'))

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledTimes(1)
    })

    expect(mockMutateAsync.mock.calls[0][0].expense.conversion).toEqual({
      type: 'exchange',
      currency: 'USD',
    })
  })

  it('navigates to the full create form with search params when clicking Edit', async () => {
    const onOpenChange = vi.fn()
    const { user } = render(
      <CreateReimbursementModal
        groupId="group-1"
        reimbursement={reimbursement}
        currency={USD}
        originalCurrencyCode="USD"
        open={true}
        onOpenChange={onOpenChange}
      />,
    )

    await user.click(screen.getByTestId('reimbursement-edit'))

    expect(mockNavigate).toHaveBeenCalledWith({
      to: '/groups/$groupId/expenses/create',
      params: { groupId: 'group-1' },
      search: {
        reimbursement: 'yes',
        from: 'alice-id',
        to: 'bob-id',
        amount: '2500',
        originalCurrency: 'USD',
      },
    })
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('hides actions when group is archived', () => {
    setupCurrentGroup({ archived: true })

    render(
      <CreateReimbursementModal
        groupId="group-1"
        reimbursement={reimbursement}
        currency={EUR}
        open={true}
        onOpenChange={vi.fn()}
      />,
    )

    expect(screen.queryByTestId('reimbursement-create')).not.toBeInTheDocument()
    expect(screen.queryByTestId('reimbursement-edit')).not.toBeInTheDocument()
  })

  it('hides actions when viewer is a pending invitee', () => {
    setupCurrentGroup({ isPendingInvitee: true })

    render(
      <CreateReimbursementModal
        groupId="group-1"
        reimbursement={reimbursement}
        currency={EUR}
        open={true}
        onOpenChange={vi.fn()}
      />,
    )

    expect(screen.queryByTestId('reimbursement-create')).not.toBeInTheDocument()
    expect(screen.queryByTestId('reimbursement-edit')).not.toBeInTheDocument()
  })

  it('closes the modal when open changes to false', async () => {
    const onOpenChange = vi.fn()
    render(
      <CreateReimbursementModal
        groupId="group-1"
        reimbursement={reimbursement}
        currency={EUR}
        open={true}
        onOpenChange={onOpenChange}
      />,
    )

    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})
