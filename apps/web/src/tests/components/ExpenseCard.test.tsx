import { afterEach, describe, expect, it, vi } from 'vitest'

import type { GroupExpense } from '@/lib/api'
import { render, screen } from '@/test/test-utils'

// ── Module mocks ────────────────────────────────────────────────────────

vi.mock('@/app/groups/[groupId]/current-group-context', () => ({
  useCurrentGroupOrNull: vi.fn().mockReturnValue(null),
  useIsReadOnlyGroupViewer: vi.fn(),
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

// Mock useActiveUser so ActiveUserBalance can resolve
vi.mock('@/lib/hooks', () => ({
  useActiveUser: vi.fn(),
}))

vi.mock('@/components/account-preferences-sync', () => ({
  useSyncedAccountPreferences: vi.fn().mockReturnValue({ timeZone: 'UTC' }),
}))

// ── SUT ─────────────────────────────────────────────────────────────────

import { useIsReadOnlyGroupViewer } from '@/app/groups/[groupId]/current-group-context'
import { ExpenseCard } from '@/app/groups/[groupId]/expenses/expense-card'
import { useSyncedAccountPreferences } from '@/components/account-preferences-sync'
import { useActiveUser } from '@/lib/hooks'

// ── Helpers ──────────────────────────────────────────────────────────────

const EUR = { code: 'EUR', symbol: '€', decimal_digits: 2, rounding: 0 }

function makeExpense(overrides: Record<string, unknown> = {}): GroupExpense {
  return {
    id: 'exp-1',
    title: 'Dinner',
    amount: 3000,
    expenseDate: new Date('2025-06-15T00:00:00.000Z'),
    expenseTimeZone: 'UTC',
    createdAt: new Date('2025-06-15T00:00:00.000Z'),
    categoryId: 'general',
    splitMode: 'EVENLY',
    paidBySplitMode: 'BY_AMOUNT',
    originalAmount: null,
    originalCurrency: null,
    conversionRate: null,
    conversionSource: null,
    recurrenceSequence: null,
    paidByList: [
      { ledgerParticipant: { id: 'user-alice', name: 'Alice' }, shares: 3000 },
    ],
    paidFor: [
      {
        ledgerParticipant: { id: 'user-alice', name: 'Alice' },
        shares: 1,
      },
    ],
    category: { id: 'general', grouping: 'Food and Drink', name: 'Dining Out' },
    documentCount: 0,
    items: [],
    recurringSeriesId: null,
    recurringSeriesStatus: null,
    ...overrides,
  } as unknown as GroupExpense
}

// ── Tests ───────────────────────────────────────────────────────────────

describe('ExpenseCard', () => {
  afterEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
  })

  it('renders expense title, amount, date', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-12T12:00:00.000Z'))
    vi.mocked(useIsReadOnlyGroupViewer).mockReturnValue(false)
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
    const date = screen.getByTestId('expense-date')
    expect(date).toHaveTextContent('Jun 15, 2025 · 00:00')
    expect(date).not.toHaveTextContent('GMT')
    expect(
      screen.getByTestId('expense-amount').parentElement,
    ).not.toContainElement(date)
  })

  it('shows a city-only timezone hint under the title for a foreign zone', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-12T12:00:00.000Z'))
    vi.mocked(useIsReadOnlyGroupViewer).mockReturnValue(false)
    vi.mocked(useActiveUser).mockReturnValue(null)
    vi.mocked(useSyncedAccountPreferences).mockReturnValue({
      timeZone: 'UTC',
    } as never)

    render(
      <ExpenseCard
        expense={makeExpense({
          expenseDate: new Date('2026-08-12T19:30:00.000Z'),
          expenseTimeZone: 'America/Los_Angeles',
        })}
        currency={EUR}
        groupId="group-1"
        participantCount={2}
      />,
    )

    const date = screen.getByTestId('expense-date')
    expect(date).toHaveTextContent('Aug 12 · 12:30 · Los Angeles')
    expect(date).not.toHaveTextContent('GMT')
    expect(date).toHaveAttribute(
      'title',
      expect.stringContaining('Los Angeles · GMT-07:00'),
    )
  })

  it('shows converted amount first and original amount second for cross-currency expenses', () => {
    vi.mocked(useIsReadOnlyGroupViewer).mockReturnValue(false)
    vi.mocked(useActiveUser).mockReturnValue(null)

    const expense = makeExpense({
      amount: 4140,
      originalAmount: 4500,
      originalCurrency: 'USD',
      conversionRate: 0.92,
    })

    render(
      <ExpenseCard
        expense={expense}
        currency={EUR}
        groupId="group-1"
        participantCount={2}
      />,
    )

    expect(screen.getByTestId('expense-amount')).toHaveTextContent('€41.40')
    expect(screen.getByTestId('expense-original-amount')).toHaveTextContent(
      '$45.00',
    )
  })

  it('does not show a secondary amount for same-currency expenses', () => {
    vi.mocked(useIsReadOnlyGroupViewer).mockReturnValue(false)
    vi.mocked(useActiveUser).mockReturnValue(null)

    const expense = makeExpense({
      amount: 4500,
      originalAmount: 4500,
      originalCurrency: 'EUR',
      conversionRate: 1,
    })

    render(
      <ExpenseCard
        expense={expense}
        currency={EUR}
        groupId="group-1"
        participantCount={2}
      />,
    )

    expect(screen.getByTestId('expense-amount')).toHaveTextContent('€45.00')
    expect(screen.queryByTestId('expense-original-amount')).toBeNull()
  })

  it('shows settlement badge when category is settlement', () => {
    vi.mocked(useIsReadOnlyGroupViewer).mockReturnValue(false)
    vi.mocked(useActiveUser).mockReturnValue(null)

    const expense = makeExpense({ categoryId: 'settlement' })
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
    // The container has italic class when the expense is a settlement
    const card = screen.getByTestId('expense-item-exp-1')
    expect(card.className).toContain('italic')
  })

  it('keeps the preview affordance available to pending invitees', () => {
    vi.mocked(useIsReadOnlyGroupViewer).mockReturnValue(true)
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

    // Pending invitees can view the expense preview even though they cannot
    // edit it.
    const card = screen.getByTestId('expense-item-exp-1')
    expect(screen.getByRole('link', { name: 'Dinner' })).toBeInTheDocument()
    expect(card.querySelector('.lucide-chevron-right')).toBeInTheDocument()
  })

  it('shows preview affordance as a link to the expense', () => {
    vi.mocked(useIsReadOnlyGroupViewer).mockReturnValue(false)
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

    const card = screen.getByTestId('expense-item-exp-1')
    expect(card.className).toContain('hover:bg-accent')
    expect(screen.getByRole('link', { name: 'Dinner' })).toHaveAttribute(
      'href',
      '/groups/$groupId/expenses/$expenseId',
    )
  })

  it('links to the global expenses overlay when expensesSearch is provided', () => {
    vi.mocked(useIsReadOnlyGroupViewer).mockReturnValue(false)
    vi.mocked(useActiveUser).mockReturnValue(null)

    render(
      <ExpenseCard
        expense={makeExpense()}
        currency={EUR}
        groupId="group-1"
        participantCount={2}
        expensesSearch={{ expenseId: 'exp-1', expenseGroupId: 'group-1' }}
      />,
    )

    expect(screen.getByRole('link', { name: 'Dinner' })).toHaveAttribute(
      'href',
      '/expenses',
    )
  })

  it('renders the RecurringBadge for expenses that belong to a recurring series', () => {
    vi.mocked(useIsReadOnlyGroupViewer).mockReturnValue(false)
    vi.mocked(useActiveUser).mockReturnValue(null)

    const expense = makeExpense({
      recurringSeriesId: 'series-9',
      recurringSeriesStatus: 'CANCELLED',
    })
    render(
      <ExpenseCard
        expense={expense}
        currency={EUR}
        groupId="group-1"
        participantCount={2}
      />,
    )

    expect(screen.getByText('Recurring · Stopped')).toBeInTheDocument()
  })

  it('shows settlement badge for settlement expenses', () => {
    vi.mocked(useIsReadOnlyGroupViewer).mockReturnValue(false)
    vi.mocked(useActiveUser).mockReturnValue(null)

    const expense = makeExpense({ categoryId: 'settlement' })
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
    vi.mocked(useIsReadOnlyGroupViewer).mockReturnValue(false)
    // Set active user to match a participant in the expense
    vi.mocked(useActiveUser).mockReturnValue('user-alice')

    const expense = makeExpense({
      splitMode: 'EVENLY',
      paidByList: [
        {
          ledgerParticipant: { id: 'user-alice', name: 'Alice' },
          shares: 2000,
        },
      ],
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

  it('uses stored top-level shares for itemized balances with slim item rows', () => {
    vi.mocked(useIsReadOnlyGroupViewer).mockReturnValue(false)
    vi.mocked(useActiveUser).mockReturnValue('user-bob')

    const expense = makeExpense({
      amount: 1001,
      splitMode: 'ITEMIZED',
      paidByList: [
        {
          ledgerParticipant: { id: 'user-alice', name: 'Alice' },
          shares: 1001,
        },
      ],
      paidFor: [
        {
          ledgerParticipant: { id: 'user-alice', name: 'Alice' },
          shares: 401,
        },
        {
          ledgerParticipant: { id: 'user-bob', name: 'Bob' },
          shares: 600,
        },
      ],
      items: [{ id: 'item-1', title: 'Shared items', amount: 800 }],
    })

    const { container } = render(
      <ExpenseCard
        expense={expense}
        currency={EUR}
        groupId="group-1"
        participantCount={2}
      />,
    )

    expect(container.textContent).toContain('Your balance:')
    expect(container.textContent).toContain('€6.00')
    expect(container.textContent).not.toContain('€5.01')
  })

  describe('multi-payer rendering', () => {
    it('renders comma-separated payer names (alphabetical) using paidByMultiple key', () => {
      vi.mocked(useIsReadOnlyGroupViewer).mockReturnValue(false)
      vi.mocked(useActiveUser).mockReturnValue(null)

      // Fixture is intentionally in non-alphabetical order to verify the
      // card sorts at read time (Decision #13).
      const expense = makeExpense({
        amount: 5000,
        paidBySplitMode: 'BY_AMOUNT',
        paidByList: [
          {
            ledgerParticipant: { id: 'user-bob', name: 'Bob' },
            shares: 2000,
          },
          {
            ledgerParticipant: { id: 'user-alice', name: 'Alice' },
            shares: 3000,
          },
        ],
        paidFor: [
          {
            ledgerParticipant: { id: 'user-carol', name: 'Carol' },
            shares: 1,
          },
        ],
      })

      const { container } = render(
        <ExpenseCard
          expense={expense}
          currency={EUR}
          groupId="group-1"
          participantCount={3}
        />,
      )

      // Both payer names render, in alphabetical order: "Alice, Bob".
      // The paidFor ("Carol") is distinct so the strong-order check below
      // unambiguously verifies the paidByNames slot.
      expect(container.textContent).toContain('Alice')
      expect(container.textContent).toContain('Bob')
      expect(container.textContent).toContain('Alice, Bob')
      // The multi-payer key starts with "Paid by".
      expect(container.textContent).toContain('Paid by')
      // The paidByNames slot renders the sorted names first, each inside
      // its own <strong>, followed by the paidFor <strong>.
      const strongTexts = Array.from(container.querySelectorAll('strong')).map(
        (s) => s.textContent,
      )
      expect(strongTexts).toEqual(['Alice', 'Bob', 'Carol'])
    })

    it('sorts 3 payers alphabetically (Bob, Alice, Carol) before the payee', () => {
      vi.mocked(useIsReadOnlyGroupViewer).mockReturnValue(false)
      vi.mocked(useActiveUser).mockReturnValue(null)

      // 3 payers in non-alphabetical source order, single payee Dave,
      // to verify that the multi-payer slot sorts at read time and not
      // at write time.
      const expense = makeExpense({
        amount: 9000,
        paidBySplitMode: 'BY_AMOUNT',
        paidByList: [
          {
            ledgerParticipant: { id: 'user-bob', name: 'Bob' },
            shares: 3000,
          },
          {
            ledgerParticipant: { id: 'user-alice', name: 'Alice' },
            shares: 3000,
          },
          {
            ledgerParticipant: { id: 'user-carol', name: 'Carol' },
            shares: 3000,
          },
        ],
        paidFor: [
          {
            ledgerParticipant: { id: 'user-dave', name: 'Dave' },
            shares: 1,
          },
        ],
      })

      const { container } = render(
        <ExpenseCard
          expense={expense}
          currency={EUR}
          groupId="group-1"
          participantCount={4}
        />,
      )

      // Comma-separated, sorted: "Alice, Bob, Carol".
      expect(container.textContent).toContain('Alice, Bob, Carol')
      // Phrase template renders the payer group before the payee.
      expect(container.textContent).toContain(
        'Paid by Alice, Bob, Carol · split between Dave',
      )
      // The strong-order check pins the exact slot order.
      const strongTexts = Array.from(container.querySelectorAll('strong')).map(
        (s) => s.textContent,
      )
      expect(strongTexts).toEqual(['Alice', 'Bob', 'Carol', 'Dave'])
    })
  })

  describe('items preview', () => {
    const threeItems = [
      { id: 'item-1', title: 'Apples', amount: 1000 },
      { id: 'item-2', title: 'Bananas', amount: 1500 },
      { id: 'item-3', title: 'Cherries', amount: 2000 },
    ]

    it('hides overflow items until the more control is pressed', async () => {
      vi.mocked(useIsReadOnlyGroupViewer).mockReturnValue(false)
      vi.mocked(useActiveUser).mockReturnValue(null)
      const { user } = render(
        <ExpenseCard
          expense={makeExpense({ items: threeItems })}
          currency={EUR}
          groupId="group-1"
          participantCount={2}
        />,
      )

      expect(screen.getByText(/Apples/)).toBeInTheDocument()
      expect(screen.getByText(/Bananas/)).toBeInTheDocument()
      expect(screen.queryByText(/Cherries/)).not.toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: /^\+1 more$/i }))

      expect(screen.getByText(/Cherries/)).toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: /^show less$/i }),
      ).toHaveAttribute('aria-expanded', 'true')
    })

    it('collapses overflow items when Show less is pressed', async () => {
      vi.mocked(useIsReadOnlyGroupViewer).mockReturnValue(false)
      vi.mocked(useActiveUser).mockReturnValue(null)

      const { user } = render(
        <ExpenseCard
          expense={makeExpense({ items: threeItems })}
          currency={EUR}
          groupId="group-1"
          participantCount={2}
        />,
      )

      await user.click(screen.getByRole('button', { name: /^\+1 more$/i }))
      await user.click(screen.getByRole('button', { name: /^show less$/i }))

      expect(screen.queryByText(/Cherries/)).not.toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: /^\+1 more$/i }),
      ).toHaveAttribute('aria-expanded', 'false')
    })

    it('does not render an overflow control when there are at most two items', () => {
      vi.mocked(useIsReadOnlyGroupViewer).mockReturnValue(false)
      vi.mocked(useActiveUser).mockReturnValue(null)

      render(
        <ExpenseCard
          expense={makeExpense({
            items: [
              { id: 'item-1', title: 'Apples', amount: 1000 },
              { id: 'item-2', title: 'Bananas', amount: 1500 },
            ],
          })}
          currency={EUR}
          groupId="group-1"
          participantCount={2}
        />,
      )

      expect(
        screen.queryByRole('button', { name: /more/i }),
      ).not.toBeInTheDocument()
    })
  })
})
