import { ExpenseForm } from '@/app/groups/[groupId]/expenses/expense-form'
import { getCurrency, useCurrencies } from '@/lib/currency'
import { useCurrencyRate } from '@/lib/hooks'
import { render, screen } from '@/test/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// ── Module mocks ────────────────────────────────────────────────────────

vi.mock('@trpc/react-query', () => ({
  createTRPCReact: () => {},
}))

const mockUseMutation = vi.fn(() => ({
  mutateAsync: vi.fn().mockResolvedValue({ categoryId: 'general' }),
}))

const mockUseQuery = vi.fn(() => ({
  data: undefined,
  error: null,
  isLoading: false,
  refetch: vi.fn(),
}))

vi.mock('@/trpc/client', () => ({
  trpc: {
    ai: {
      extractCategoryFromTitle: {
        useMutation: () => mockUseMutation(),
      },
    },
    currency: {
      getRate: {
        useQuery: (opts: unknown) => mockUseQuery(opts),
      },
    },
  },
}))

vi.mock('@/components/link', () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: string
    children: React.ReactNode
    [key: string]: unknown
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
  Link: ({
    href,
    children,
    ...props
  }: {
    href: string
    children: React.ReactNode
    [key: string]: unknown
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))

vi.mock('@/lib/currency', () => ({
  getCurrency: vi.fn(),
  useCurrencies: vi.fn(),
}))

vi.mock('@/lib/hooks', () => ({
  useCurrencyRate: vi.fn(),
  useMediaQuery: vi.fn().mockReturnValue(true), // desktop mode
}))

vi.mock('@/lib/api', () => ({
  randomId: vi.fn(() => 'mock-id-123'),
}))

vi.mock('@/app/groups/[groupId]/current-group-context', () => ({
  useCurrentGroup: vi.fn(),
}))

// ── Fixtures ────────────────────────────────────────────────────────────

const defaultCurrencies = [
  {
    code: 'USD',
    symbol: '$',
    rounding: 0,
    decimal_digits: 2,
    name: 'US Dollar',
  },
  { code: 'EUR', symbol: '€', rounding: 0, decimal_digits: 2, name: 'Euro' },
  {
    code: 'GBP',
    symbol: '£',
    rounding: 0,
    decimal_digits: 2,
    name: 'British Pound',
  },
]

const mockGroup = {
  id: 'group-1',
  slug: 'test-group',
  name: 'Test Group',
  information: 'A test group',
  archived: false,
  createdAt: new Date('2025-01-01'),
  updatedAt: new Date('2025-01-01'),
  ledgerId: 'ledger-1',
  currency: '$',
  currencyCode: 'USD',
  ledger: {
    id: 'ledger-1',
    currency: '$',
    currencyCode: 'USD',
    groupId: 'group-1',
  },
  members: [],
  invitations: [],
  participants: [
    { id: 'lp-1', name: 'Alice', pending: false, unlinked: false },
    { id: 'lp-2', name: 'Bob', pending: false, unlinked: false },
  ],
}

const mockExpense = {
  id: 'expense-1',
  title: 'Dinner',
  expenseDate: new Date('2025-06-15'),
  amount: 5000, // $50.00 in cents
  originalCurrency: null,
  originalAmount: null,
  conversionRate: null,
  categoryId: 'food-drink-dinner',
  paidById: 'lp-1',
  paidFor: [
    { ledgerParticipantId: 'lp-1', shares: 2500 },
    { ledgerParticipantId: 'lp-2', shares: 2500 },
  ],
  splitMode: 'EVENLY',
  isReimbursement: false,
  documents: [],
  notes: 'Great dinner',
  recurrenceRule: 'NONE',
  isPayer: true,
  paidBy: { id: 'lp-1', name: 'Alice' },
  expense: null,
}

const runtimeFeatureFlags = {
  enableExpenseDocuments: false,
  enableReceiptExtract: false,
  enableCategoryExtract: false,
}

// ── Setup ───────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.mocked(useCurrencies).mockReturnValue(defaultCurrencies)
  vi.mocked(getCurrency).mockImplementation(
    (code: string) =>
      defaultCurrencies.find((c) => c.code === code) ?? {
        code: '',
        symbol: '',
        rounding: 0,
        decimal_digits: 2,
      },
  )
  vi.mocked(useCurrencyRate).mockReturnValue({
    data: undefined,
    error: null,
    isLoading: false,
    refresh: vi.fn(),
  })
})

// ── Tests ───────────────────────────────────────────────────────────────

describe('ExpenseForm', () => {
  it('shows title, amount, date, and category fields in create mode', () => {
    const onSubmit = vi.fn()
    render(
      <ExpenseForm
        group={mockGroup as any}
        onSubmit={onSubmit}
        runtimeFeatureFlags={runtimeFeatureFlags}
      />,
    )

    expect(screen.getByText('Expense title')).toBeInTheDocument()
    expect(screen.getByText('Amount')).toBeInTheDocument()
    expect(screen.getByText('Expense date')).toBeInTheDocument()
    expect(screen.getByText('Category')).toBeInTheDocument()
  })

  it('renders the Create expense title in create mode', () => {
    const onSubmit = vi.fn()
    render(
      <ExpenseForm
        group={mockGroup as any}
        onSubmit={onSubmit}
        runtimeFeatureFlags={runtimeFeatureFlags}
      />,
    )

    expect(screen.getByText('Create expense')).toBeInTheDocument()
  })

  it('edit mode pre-fills expense data', () => {
    const onSubmit = vi.fn()
    render(
      <ExpenseForm
        group={mockGroup as any}
        expense={mockExpense as any}
        onSubmit={onSubmit}
        runtimeFeatureFlags={runtimeFeatureFlags}
      />,
    )

    // Title should be pre-filled
    expect(screen.getByDisplayValue('Dinner')).toBeInTheDocument()

    // Should show edit title
    expect(screen.getByText('Edit expense')).toBeInTheDocument()

    // Notes should be pre-filled
    expect(screen.getByDisplayValue('Great dinner')).toBeInTheDocument()
  })

  it('split mode toggle changes UI (advanced options)', async () => {
    const { user } = render(
      <ExpenseForm
        group={mockGroup as any}
        onSubmit={vi.fn()}
        runtimeFeatureFlags={runtimeFeatureFlags}
      />,
    )

    // Click advanced splitting options to reveal split mode
    const advancedButton = screen.getByText(/advanced splitting options/i)
    await user.click(advancedButton)

    // Split mode selector should be visible
    expect(screen.getByText('Split mode')).toBeInTheDocument()
  })

  it('delete button renders for edit mode', () => {
    const onSubmit = vi.fn()
    const onDelete = vi.fn()
    render(
      <ExpenseForm
        group={mockGroup as any}
        expense={mockExpense as any}
        onSubmit={onSubmit}
        onDelete={onDelete}
        runtimeFeatureFlags={runtimeFeatureFlags}
      />,
    )

    // Delete button should be present
    expect(screen.getByRole('button', { name: /delete/i })).toBeInTheDocument()
  })

  it('no delete button in create mode', () => {
    const onSubmit = vi.fn()
    render(
      <ExpenseForm
        group={mockGroup as any}
        onSubmit={onSubmit}
        runtimeFeatureFlags={runtimeFeatureFlags}
      />,
    )

    expect(
      screen.queryByRole('button', { name: /delete/i }),
    ).not.toBeInTheDocument()
  })

  it('read-only disables inputs', () => {
    const onSubmit = vi.fn()
    render(
      <ExpenseForm
        group={mockGroup as any}
        onSubmit={onSubmit}
        runtimeFeatureFlags={runtimeFeatureFlags}
        readOnly
      />,
    )

    // Read-only notice should be visible
    expect(screen.getByText(/this group is archived/i)).toBeInTheDocument()

    // Title input should be disabled
    expect(
      screen.getByPlaceholderText('Monday evening restaurant'),
    ).toBeDisabled()

    // No Save button
    expect(
      screen.queryByRole('button', { name: /create|save/i }),
    ).not.toBeInTheDocument()
  })

  it('submit calls onSubmit with parsed values', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const { user } = render(
      <ExpenseForm
        group={mockGroup as any}
        onSubmit={onSubmit}
        runtimeFeatureFlags={runtimeFeatureFlags}
        currentLedgerParticipantId="lp-1"
      />,
    )

    // Fill in title (required, min 2 chars)
    const titleInput = screen.getByPlaceholderText('Monday evening restaurant')
    await user.clear(titleInput)
    await user.type(titleInput, 'Lunch')

    // Fill in the amount field (exact label 'Amount' not 'Amount to convert')
    const amountInput = screen.getByRole('textbox', { name: 'Amount' })
    await user.clear(amountInput)
    await user.type(amountInput, '25')

    // Click Create button
    const createButton = screen.getByRole('button', { name: /create/i })
    await user.click(createButton)

    // Wait for onSubmit to be called
    await vi.waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1)
    })

    const submittedValues = onSubmit.mock.calls[0][0]
    expect(submittedValues).toHaveProperty('title', 'Lunch')
    expect(submittedValues).toHaveProperty('paidFor')
    // Amount is converted to minor units in submit handler
    expect(submittedValues).toHaveProperty('amount')
  })

  it('recurrence rule dropdown renders', () => {
    const onSubmit = vi.fn()
    render(
      <ExpenseForm
        group={mockGroup as any}
        onSubmit={onSubmit}
        runtimeFeatureFlags={runtimeFeatureFlags}
      />,
    )

    expect(screen.getByText('Expense Recurrence')).toBeInTheDocument()
  })

  it('paid-by selector renders with participant names', () => {
    const onSubmit = vi.fn()
    render(
      <ExpenseForm
        group={mockGroup as any}
        onSubmit={onSubmit}
        runtimeFeatureFlags={runtimeFeatureFlags}
      />,
    )

    // Paid by label should be visible
    expect(screen.getByText('Paid by')).toBeInTheDocument()
  })

  it('paid-for section renders participants', () => {
    const onSubmit = vi.fn()
    render(
      <ExpenseForm
        group={mockGroup as any}
        onSubmit={onSubmit}
        runtimeFeatureFlags={runtimeFeatureFlags}
      />,
    )

    // Both participants should appear
    expect(screen.getAllByText('Alice').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('Bob').length).toBeGreaterThanOrEqual(1)
  })
})
