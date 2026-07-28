import { describe, expect, it, vi } from 'vitest'

import {
  useCurrentGroup,
  useIsPendingInvitee,
} from '@/app/groups/[groupId]/current-group-context'
import { ReimbursementList } from '@/app/groups/[groupId]/reimbursement-list'
import { render, screen, waitFor, within } from '@/test/test-utils'

// ── Module mocks ────────────────────────────────────────────────────────

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
      groups: {
        balances: {
          invalidate: mockInvalidateBalances,
        },
      },
    }),
  },
}))

vi.mock('@/components/ui/use-toast', () => ({
  useToast: () => ({
    toast: mockToast,
  }),
}))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mockNavigate,
}))

import { PAYMENT_CATEGORY_ID } from '@spliit/domain'

// ── Fixtures ────────────────────────────────────────────────────────────

const EUR = { code: 'EUR', symbol: '€', decimal_digits: 2, rounding: 0 }

function makeGroup(participants: Array<{ id: string; name: string }>) {
  return {
    id: 'group-1',
    name: 'Trip',
    information: null,
    archived: false,
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
    ledgerId: 'ledger-1',
    currency: 'EUR',
    currencyCode: 'EUR',
    groupType: 'GROUP' as const,
    friendPairKey: null,
    ledger: {
      id: 'ledger-1',
      currency: 'EUR',
      currencyCode: 'EUR',
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

function makeParticipant(id: string, name: string) {
  return { id, name }
}

function setupCurrentGroup(participants: ReturnType<typeof makeParticipant>[]) {
  const group = makeGroup(participants)
  vi.mocked(useCurrentGroup).mockReturnValue({
    isLoading: false,
    groupId: 'group-1',
    group: group as never,
    displayName: group.name,
    currentLedgerParticipantId: null,
    currentMember: null,
    currentInvitation: null,
    linkInviteState: null,
  })
  vi.mocked(useIsPendingInvitee).mockReturnValue(false)
}

// ── Tests ───────────────────────────────────────────────────────────────

describe('ReimbursementList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("shows 'no reimbursements' message when list is empty", () => {
    setupCurrentGroup([])
    render(
      <ReimbursementList
        reimbursements={[]}
        participants={[]}
        currency={EUR}
        groupId="group-1"
      />,
    )

    expect(screen.getByTestId('no-reimbursements')).toBeInTheDocument()
    expect(
      screen.getByText('Everyone in your group is settled up \uD83D\uDE01'),
    ).toBeInTheDocument()
    expect(screen.queryByTestId('reimbursements-list')).not.toBeInTheDocument()
  })

  it('shows reimbursement rows with from/to names', () => {
    const participants = [
      makeParticipant('alice-id', 'Alice'),
      makeParticipant('bob-id', 'Bob'),
    ]
    setupCurrentGroup(participants)
    const reimbursements = [{ from: 'alice-id', to: 'bob-id', amount: 1500 }]

    render(
      <ReimbursementList
        reimbursements={reimbursements}
        participants={participants}
        currency={EUR}
        groupId="group-1"
      />,
    )

    expect(screen.getByTestId('reimbursements-list')).toBeInTheDocument()
    expect(
      screen.getByTestId('reimbursement-row-Alice-Bob'),
    ).toBeInTheDocument()
    expect(screen.getAllByText('Alice').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Bob').length).toBeGreaterThan(0)
  })

  it('shows amount formatted in currency', () => {
    const participants = [
      makeParticipant('alice-id', 'Alice'),
      makeParticipant('bob-id', 'Bob'),
    ]
    setupCurrentGroup(participants)
    const reimbursements = [{ from: 'alice-id', to: 'bob-id', amount: 1500 }]

    render(
      <ReimbursementList
        reimbursements={reimbursements}
        participants={participants}
        currency={EUR}
        groupId="group-1"
      />,
    )

    expect(screen.getByText('€15.00')).toBeInTheDocument()
  })

  it("shows 'Mark as paid' button for each reimbursement", () => {
    const participants = [
      makeParticipant('alice-id', 'Alice'),
      makeParticipant('bob-id', 'Bob'),
    ]
    setupCurrentGroup(participants)
    const reimbursements = [{ from: 'alice-id', to: 'bob-id', amount: 2000 }]

    render(
      <ReimbursementList
        reimbursements={reimbursements}
        participants={participants}
        currency={EUR}
        groupId="group-1"
      />,
    )

    expect(screen.getByText('Mark as paid')).toBeInTheDocument()
  })

  it('opens the create reimbursement modal when clicking Mark as paid', async () => {
    const participants = [
      makeParticipant('alice-id', 'Alice'),
      makeParticipant('bob-id', 'Bob'),
    ]
    setupCurrentGroup(participants)
    const reimbursements = [{ from: 'alice-id', to: 'bob-id', amount: 2000 }]

    const { user } = render(
      <ReimbursementList
        reimbursements={reimbursements}
        participants={participants}
        currency={EUR}
        groupId="group-1"
      />,
    )

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await user.click(screen.getByText('Mark as paid'))

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('Settlement payment')).toBeInTheDocument()
    expect(
      within(screen.getByRole('dialog')).getAllByText('€20.00').length,
    ).toBeGreaterThan(0)
  })

  it('creates a reimbursement via mutation when clicking Create', async () => {
    const participants = [
      makeParticipant('alice-id', 'Alice'),
      makeParticipant('bob-id', 'Bob'),
    ]
    setupCurrentGroup(participants)
    mockMutateAsync.mockResolvedValue({ expenseId: 'new-expense' })
    mockInvalidateBalances.mockResolvedValue(undefined)
    const reimbursements = [{ from: 'alice-id', to: 'bob-id', amount: 2000 }]

    const { user } = render(
      <ReimbursementList
        reimbursements={reimbursements}
        participants={participants}
        currency={EUR}
        groupId="group-1"
      />,
    )

    await user.click(screen.getByText('Mark as paid'))
    await user.click(screen.getByTestId('reimbursement-create'))

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledTimes(1)
    })

    const call = mockMutateAsync.mock.calls[0][0]
    expect(call.groupId).toBe('group-1')
    expect(call.expense.category).toBe(PAYMENT_CATEGORY_ID)
    expect(call.expense.amount).toBe(2000)
    expect(call.expense.isReimbursement).toBe(true)
    expect(call.expense.paidBySplitMode).toBe('BY_AMOUNT')
    expect(call.expense.splitMode).toBe('EVENLY')
    expect(call.expense.isMultiPayer).toBe(false)
    expect(call.expense.documents).toEqual([])
    expect(call.expense.recurrence).toBeNull()
    expect(call.expense.paidByList).toEqual([
      { participant: 'alice-id', shares: 2000 },
    ])
    expect(call.expense.paidFor).toEqual([{ participant: 'bob-id', shares: 1 }])
    expect(call.expense.conversion).toBeUndefined()

    await waitFor(() => {
      expect(mockInvalidateBalances).toHaveBeenCalledTimes(1)
    })
    expect(mockToast).toHaveBeenCalledWith({
      description: 'Settlement payment recorded',
    })
  })

  it('includes exchange conversion when originalCurrencyCode differs from group currency', async () => {
    const USD = {
      code: 'USD',
      symbol: '$',
      decimal_digits: 2,
      rounding: 0,
    }
    const participants = [
      makeParticipant('alice-id', 'Alice'),
      makeParticipant('bob-id', 'Bob'),
    ]
    setupCurrentGroup(participants)
    mockMutateAsync.mockResolvedValue({ expenseId: 'new-expense' })
    mockInvalidateBalances.mockResolvedValue(undefined)
    const reimbursements = [{ from: 'alice-id', to: 'bob-id', amount: 2000 }]

    const { user } = render(
      <ReimbursementList
        reimbursements={reimbursements}
        participants={participants}
        currency={USD}
        reimbursementCurrencyCode="USD"
        groupId="group-1"
      />,
    )

    await user.click(screen.getByText('Mark as paid'))
    await user.click(screen.getByTestId('reimbursement-create'))

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledTimes(1)
    })

    expect(mockMutateAsync.mock.calls[0][0].expense.conversion).toEqual({
      type: 'exchange',
      currency: 'USD',
    })
  })

  it('does not include conversion when originalCurrencyCode matches group currency', async () => {
    const participants = [
      makeParticipant('alice-id', 'Alice'),
      makeParticipant('bob-id', 'Bob'),
    ]
    setupCurrentGroup(participants)
    mockMutateAsync.mockResolvedValue({ expenseId: 'new-expense' })
    const reimbursements = [{ from: 'alice-id', to: 'bob-id', amount: 2000 }]

    const { user } = render(
      <ReimbursementList
        reimbursements={reimbursements}
        participants={participants}
        currency={EUR}
        reimbursementCurrencyCode="EUR"
        groupId="group-1"
      />,
    )

    await user.click(screen.getByText('Mark as paid'))
    await user.click(screen.getByTestId('reimbursement-create'))

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledTimes(1)
    })

    expect(mockMutateAsync.mock.calls[0][0].expense.conversion).toBeUndefined()
  })

  it('navigates to the full create expense form when clicking Edit', async () => {
    const participants = [
      makeParticipant('alice-id', 'Alice'),
      makeParticipant('bob-id', 'Bob'),
    ]
    setupCurrentGroup(participants)
    const reimbursements = [{ from: 'alice-id', to: 'bob-id', amount: 2000 }]

    const { user } = render(
      <ReimbursementList
        reimbursements={reimbursements}
        participants={participants}
        currency={EUR}
        groupId="group-1"
      />,
    )

    await user.click(screen.getByText('Mark as paid'))
    await user.click(screen.getByTestId('reimbursement-edit'))

    expect(mockNavigate).toHaveBeenCalledWith({
      to: '/groups/$groupId/expenses/create',
      params: { groupId: 'group-1' },
      search: {
        reimbursement: 'yes',
        from: 'alice-id',
        to: 'bob-id',
        amount: '2000',
      },
    })
  })

  it('passes originalCurrency to edit navigation when reimbursementCurrencyCode is set', async () => {
    const USD = {
      code: 'USD',
      symbol: '$',
      decimal_digits: 2,
      rounding: 0,
    }
    const participants = [
      makeParticipant('alice-id', 'Alice'),
      makeParticipant('bob-id', 'Bob'),
    ]
    setupCurrentGroup(participants)
    const reimbursements = [{ from: 'alice-id', to: 'bob-id', amount: 2000 }]

    const { user } = render(
      <ReimbursementList
        reimbursements={reimbursements}
        participants={participants}
        currency={USD}
        reimbursementCurrencyCode="USD"
        groupId="group-1"
      />,
    )

    await user.click(screen.getByText('Mark as paid'))
    await user.click(screen.getByTestId('reimbursement-edit'))

    expect(mockNavigate).toHaveBeenCalledWith({
      to: '/groups/$groupId/expenses/create',
      params: { groupId: 'group-1' },
      search: {
        reimbursement: 'yes',
        from: 'alice-id',
        to: 'bob-id',
        amount: '2000',
        originalCurrency: 'USD',
      },
    })
  })
})
