import { render, screen, within } from '@/test/test-utils'
import { describe, expect, it, vi } from 'vitest'

// ── Module mocks ────────────────────────────────────────────────────────

vi.mock('@/app/groups/[groupId]/current-group-context', () => ({
  useIsPendingInvitee: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, ...props }: { to: string; children: React.ReactNode; [key: string]: unknown }) => (
    <a href={to} {...props}>{children}</a>
  ),
}))

vi.mock('@/lib/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
}))

// Mock useActiveUser so ActiveUserBalance can resolve
vi.mock('@/lib/hooks', () => ({
  useActiveUser: vi.fn(),
}))

// ── SUT ─────────────────────────────────────────────────────────────────

import { ExpenseCard } from '@/app/groups/[groupId]/expenses/expense-card'
import { useIsPendingInvitee } from '@/app/groups/[groupId]/current-group-context'
import { useActiveUser } from '@/lib/hooks'

// ── Helpers ──────────────────────────────────────────────────────────────

const EUR = { code: 'EUR', symbol: '€', decimal_digits: 2, rounding: 0 }

function makeExpense(overrides: Record<string, unknown> = {}) {
  return {
    id: 'exp-1',
    title: 'Dinner',
    amount: 3000, // €30.00
    expenseDate: new Date('2025-06-15T00:00:00.000Z'),
    isReimbursement: false,
    splitMode: 'EVENLY' as const,
    paidBy: { id: 'user-alice', name: 'Alice' },
    paidFor: [
      {
        ledgerParticipant: { id: 'user-alice', name: 'Alice' },
        shares: 1,
      },
    ],
    category: { grouping: 'Food and Drink', name: 'Dining Out' },
    _count: { documents: 0 },
    ...overrides,
  }
}

// ── Tests ───────────────────────────────────────────────────────────────

describe('ExpenseCard', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('renders expense title, amount, date', () => {
    vi.mocked(useIsPendingInvitee).mockReturnValue(false)
    vi.mocked(useActiveUser).mockReturnValue(null)

    const expense = makeExpense()
    render(
      <ExpenseCard
        expense={expense}
        currency={EUR}
        groupId="group-1"
        participantCount={2}
      />,
    )

    expect(screen.getByTestId('expense-item-exp-1')).toBeInTheDocument()
    expect(screen.getByTestId('expense-title')).toHaveTextContent('Dinner')
    // amount is 3000 cents = €30.00
    expect(screen.getByTestId('expense-amount')).toHaveTextContent('€30.00')
    // expenseDate is 2025-06-15 → formatted medium date
    expect(screen.getByTestId('expense-date')).toBeInTheDocument()
  })

  it('shows reimbursement badge when isReimbursement', () => {
    vi.mocked(useIsPendingInvitee).mockReturnValue(false)
    vi.mocked(useActiveUser).mockReturnValue(null)

    const expense = makeExpense({ isReimbursement: true })
    render(
      <ExpenseCard
        expense={expense}
        currency={EUR}
        groupId="group-1"
        participantCount={2}
      />,
    )

    // The "Settlement" badge should be visible
    expect(screen.getByText('Settlement')).toBeInTheDocument()
    // The container has italic class when isReimbursement
    const card = screen.getByTestId('expense-item-exp-1')
    expect(card.className).toContain('italic')
  })

  it('shows pending invitation banner when isPendingInvitee', () => {
    vi.mocked(useIsPendingInvitee).mockReturnValue(true)
    vi.mocked(useActiveUser).mockReturnValue(null)

    const expense = makeExpense()
    render(
      <ExpenseCard
        expense={expense}
        currency={EUR}
        groupId="group-1"
        participantCount={2}
      />,
    )

    // When isPendingInvitee, canEdit is false, so the card should NOT have
    // the cursor-pointer and hover styles
    const card = screen.getByTestId('expense-item-exp-1')
    expect(card.className).not.toContain('cursor-pointer')
    // The edit chevron button should not be rendered
    // (it's inside a Button with ChevronRight icon)
    expect(card.querySelector('.lucide-chevron-right')).not.toBeInTheDocument()
  })

  it('shows edit affordance (cursor-pointer, onClick) when can edit', () => {
    vi.mocked(useIsPendingInvitee).mockReturnValue(false)
    vi.mocked(useActiveUser).mockReturnValue(null)

    const expense = makeExpense()
    render(
      <ExpenseCard
        expense={expense}
        currency={EUR}
        groupId="group-1"
        participantCount={2}
      />,
    )

    // canEdit is true, so cursor-pointer class should be present
    const card = screen.getByTestId('expense-item-exp-1')
    expect(card.className).toContain('cursor-pointer')
    expect(card.className).toContain('hover:bg-accent')
  })

  it('shows settlement badge for reimbursements', () => {
    vi.mocked(useIsPendingInvitee).mockReturnValue(false)
    vi.mocked(useActiveUser).mockReturnValue(null)

    const expense = makeExpense({ isReimbursement: true })
    render(
      <ExpenseCard
        expense={expense}
        currency={EUR}
        groupId="group-1"
        participantCount={2}
      />,
    )

    // Settlement badge shown
    expect(screen.getByText('Settlement')).toBeInTheDocument()
    // Amount is italic
    const amount = screen.getByTestId('expense-amount')
    expect(amount.className).toContain('italic')
  })

  it('shows balance line for active user', () => {
    vi.mocked(useIsPendingInvitee).mockReturnValue(false)
    // Set active user to match a participant in the expense
    vi.mocked(useActiveUser).mockReturnValue('user-alice')

    const expense = makeExpense({
      splitMode: 'EVENLY',
      paidBy: { id: 'user-alice', name: 'Alice' },
      paidFor: [
        { ledgerParticipant: { id: 'user-alice', name: 'Alice' }, shares: 1 },
        { ledgerParticipant: { id: 'user-bob', name: 'Bob' }, shares: 1 },
      ],
      amount: 2000, // €20.00
    })

    const { container } = render(
      <ExpenseCard
        expense={expense}
        currency={EUR}
        groupId="group-1"
        participantCount={2}
      />,
    )

    // The ActiveUserBalance renders "Your balance:" text
    expect(container.textContent).toContain('Your balance:')
    expect(container.textContent).toContain('€10.00')
  })
})
