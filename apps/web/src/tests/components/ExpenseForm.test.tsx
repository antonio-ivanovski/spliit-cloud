import { ExpenseForm } from '@/app/groups/[groupId]/expenses/expense-form'
import { ParticipantDistributionFooter } from '@/components/participant-distribution-footer'
import { getCurrency, useCurrencies } from '@/lib/currency'
import { useCurrencyRate } from '@/lib/hooks'
import { fireEvent, render, screen } from '@/test/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// ── Module mocks ────────────────────────────────────────────────────────

vi.mock('@trpc/react-query', () => ({
  createTRPCReact: () => {},
}))

const mockUseMutation = vi.fn(() => ({
  mutateAsync: vi.fn().mockResolvedValue({ categoryId: 'general' }),
}))

const mockUseQuery = vi.fn((_opts?: unknown) => ({
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
  categoryId: 'food-and-drink',
  paidBySplitMode: 'BY_AMOUNT',
  paidByList: [{ ledgerParticipantId: 'lp-1', shares: 5000 }],
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

  it('edit mode of a converted expense loads the typed original amount as the single editable field', () => {
    const expenseWithConversion = {
      ...mockExpense,
      originalCurrency: 'EUR',
      originalAmount: 5000, // €50.00 in cents (stored as minor units)
      conversionRate: { toNumber: () => 1.1 } as any,
    }
    render(
      <ExpenseForm
        group={mockGroup as any}
        expense={expenseWithConversion as any}
        onSubmit={vi.fn()}
        runtimeFeatureFlags={runtimeFeatureFlags}
      />,
    )

    // The conversion rate input should still be visible (confirms
    // conversion mode is active).
    expect(screen.getByDisplayValue('1.1')).toBeInTheDocument()

    // The single editable Amount field carries the typed EUR value, not
    // the converted USD ledger amount.
    const amountInput = screen.getByRole('textbox', { name: /^amount$/i })
    expect(amountInput).toHaveValue('50')

    // The read-only converted preview renders the Ledger-currency amount.
    const preview = screen.getByTestId('converted-amount-preview')
    expect(preview).toHaveTextContent(/55\.00/)
  })

  it('submit converts originalAmount to minor units when currency conversion is active', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const { user } = render(
      <ExpenseForm
        group={
          {
            ...mockGroup,
            participants: [
              { id: 'lp-1', name: 'Alice', pending: false, unlinked: false },
            ],
          } as any
        }
        expense={
          {
            ...mockExpense,
            originalCurrency: 'EUR',
            originalAmount: 5000,
            conversionRate: { toNumber: () => 1.1 } as any,
            paidFor: [{ ledgerParticipantId: 'lp-1', shares: 5000 }],
          } as any
        }
        onSubmit={onSubmit}
        runtimeFeatureFlags={runtimeFeatureFlags}
      />,
    )

    const saveButton = screen.getByRole('button', { name: /save/i })
    await user.click(saveButton)
    await vi.waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1)
    })

    const submittedValues = onSubmit.mock.calls[0][0]
    expect(submittedValues).toHaveProperty('originalAmount', 5000)
    expect(submittedValues).toHaveProperty('originalCurrency', 'EUR')
  })

  it('deletes originalAmount and originalCurrency when currencies match', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const { user } = render(
      <ExpenseForm
        group={
          {
            ...mockGroup,
            participants: [
              { id: 'lp-1', name: 'Alice', pending: false, unlinked: false },
            ],
          } as any
        }
        expense={
          {
            ...mockExpense,
            originalCurrency: 'USD',
            originalAmount: 5000,
            conversionRate: { toNumber: () => 1 } as any,
            paidFor: [{ ledgerParticipantId: 'lp-1', shares: 5000 }],
          } as any
        }
        onSubmit={onSubmit}
        runtimeFeatureFlags={runtimeFeatureFlags}
      />,
    )

    const saveButton = screen.getByRole('button', { name: /save/i })
    await user.click(saveButton)
    await vi.waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1)
    })

    const submittedValues = onSubmit.mock.calls[0][0]
    expect(submittedValues).not.toHaveProperty('originalAmount')
    expect(submittedValues).not.toHaveProperty('originalCurrency')
  })

  it('renders a single editable Amount field (no separate "Amount to convert")', () => {
    render(
      <ExpenseForm
        group={mockGroup as any}
        onSubmit={vi.fn()}
        runtimeFeatureFlags={runtimeFeatureFlags}
      />,
    )

    expect(
      screen.getByRole('textbox', { name: /^amount$/i }),
    ).toBeInTheDocument()
    // No second editable amount input is rendered.
    expect(
      screen.queryByRole('textbox', { name: /amount to convert/i }),
    ).not.toBeInTheDocument()
  })

  it('shows the converted-amount preview when the selected currency differs from the group currency', async () => {
    vi.mocked(useCurrencyRate).mockReturnValue({
      data: 1.1,
      error: null,
      isLoading: false,
      refresh: vi.fn(),
    })
    const { user } = render(
      <ExpenseForm
        group={mockGroup as any}
        onSubmit={vi.fn()}
        runtimeFeatureFlags={runtimeFeatureFlags}
        currentLedgerParticipantId="lp-1"
      />,
    )

    const currencySelector = screen.getAllByRole('combobox')[0]
    await user.click(currencySelector)
    await user.click(screen.getByText('Euro (EUR)'))

    // The preview element appears once conversion is required.
    await screen.findByTestId('converted-amount-preview')

    // The preview is rendered read-only: it must not be a focusable input.
    expect(
      screen.queryByRole('textbox', { name: /converted amount/i }),
    ).not.toBeInTheDocument()
  })

  it('updates the converted preview as the typed Amount changes', async () => {
    vi.mocked(useCurrencyRate).mockReturnValue({
      data: 1.1,
      error: null,
      isLoading: false,
      refresh: vi.fn(),
    })
    const { user } = render(
      <ExpenseForm
        group={mockGroup as any}
        onSubmit={vi.fn()}
        runtimeFeatureFlags={runtimeFeatureFlags}
        currentLedgerParticipantId="lp-1"
      />,
    )

    const currencySelector = screen.getAllByRole('combobox')[0]
    await user.click(currencySelector)
    await user.click(screen.getByText('Euro (EUR)'))

    const amountInput = screen.getByRole('textbox', { name: /^amount$/i })
    await user.clear(amountInput)
    await user.type(amountInput, '100')

    expect(screen.getByTestId('converted-amount-preview')).toHaveTextContent(
      /110\.00/,
    )

    await user.clear(amountInput)
    await user.type(amountInput, '50')

    expect(screen.getByTestId('converted-amount-preview')).toHaveTextContent(
      /55\.00/,
    )
  })

  it('changing currency keeps the numeric amount and recomputes the preview', async () => {
    vi.mocked(useCurrencyRate).mockReturnValue({
      data: 1.1,
      error: null,
      isLoading: false,
      refresh: vi.fn(),
    })
    const { user } = render(
      <ExpenseForm
        group={mockGroup as any}
        onSubmit={vi.fn()}
        runtimeFeatureFlags={runtimeFeatureFlags}
        currentLedgerParticipantId="lp-1"
      />,
    )

    const amountInput = screen.getByRole('textbox', { name: /^amount$/i })
    await user.clear(amountInput)
    await user.type(amountInput, '100')

    const currencySelector = screen.getAllByRole('combobox')[0]
    await user.click(currencySelector)
    await user.click(screen.getByText('Euro (EUR)'))

    // 100 EUR → 110 USD with the stubbed rate.
    expect(amountInput).toHaveValue('100')
    expect(screen.getByTestId('converted-amount-preview')).toHaveTextContent(
      /110\.00/,
    )

    // Switch back to USD — the numeric value stays, the preview disappears.
    await user.click(currencySelector)
    await user.click(screen.getByText('US Dollar (USD)'))

    expect(amountInput).toHaveValue('100')
    expect(
      screen.queryByTestId('converted-amount-preview'),
    ).not.toBeInTheDocument()
  })

  it('submits the typed amount as originalAmount when a different currency is selected', async () => {
    vi.mocked(useCurrencyRate).mockReturnValue({
      data: 1.1,
      error: null,
      isLoading: false,
      refresh: vi.fn(),
    })
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const { user } = render(
      <ExpenseForm
        group={
          {
            ...mockGroup,
            participants: [
              { id: 'lp-1', name: 'Alice', pending: false, unlinked: false },
            ],
          } as any
        }
        onSubmit={onSubmit}
        runtimeFeatureFlags={runtimeFeatureFlags}
        currentLedgerParticipantId="lp-1"
      />,
    )

    await user.type(screen.getByLabelText(/expense title/i), 'Dinner')

    const currencySelector = screen.getAllByRole('combobox')[0]
    await user.click(currencySelector)
    await user.click(screen.getByText('Euro (EUR)'))

    const amountInput = screen.getByRole('textbox', { name: /^amount$/i })
    await user.clear(amountInput)
    await user.type(amountInput, '100')

    await user.click(screen.getByRole('button', { name: /create/i }))

    await vi.waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1)
    })

    const submitted = onSubmit.mock.calls[0][0]
    // Typed EUR 100 → persisted originalAmount 10000 EUR minor units.
    expect(submitted).toHaveProperty('originalAmount', 10000)
    expect(submitted).toHaveProperty('originalCurrency', 'EUR')
    // Ledger amount is the typed amount * rate, rounded to USD cents.
    expect(submitted).toHaveProperty('amount', 11000)
    expect(submitted).toHaveProperty('conversionRate', 1.1)
  })

  it('split mode selector is visible by default', () => {
    render(
      <ExpenseForm
        group={mockGroup as any}
        onSubmit={vi.fn()}
        runtimeFeatureFlags={runtimeFeatureFlags}
      />,
    )

    // Split mode option cards should be visible without clicking anything
    expect(
      screen.getByRole('radio', { name: /split evenly/i }),
    ).toBeInTheDocument()
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

  it('create mode opens with a single-payer dropdown by default', () => {
    render(
      <ExpenseForm
        group={mockGroup as any}
        onSubmit={vi.fn()}
        runtimeFeatureFlags={runtimeFeatureFlags}
      />,
    )

    // The single-payer trigger placeholder is rendered when no value is
    // selected (no currentLedgerParticipantId provided).
    expect(screen.getByText('Select a participant')).toBeInTheDocument()

    // The single payer option card should be selected.
    const singlePayerRadio = screen.getByRole('radio', {
      name: /single payer/i,
    })
    expect(singlePayerRadio).toBeChecked()

    // No per-row "shares" inputs should be rendered for paid-by in
    // single-payer mode. The paid-for breakdown is independent and still
    // renders per-row inputs; check that the paid-by card's per-row
    // wrappers (data-id starts with `<id>/BY_AMOUNT/USD`) contain no inputs.
    const paidByPerRowInputs = document.querySelectorAll(
      '[data-id$="/BY_AMOUNT/USD"] input',
    )
    expect(paidByPerRowInputs.length).toBe(0)
  })

  it('toggling multi-payer options reveals the multi-payer breakdown', async () => {
    const { user } = render(
      <ExpenseForm
        group={mockGroup as any}
        onSubmit={vi.fn()}
        runtimeFeatureFlags={runtimeFeatureFlags}
        currentLedgerParticipantId="lp-1"
      />,
    )

    // Find the single payer option card — should be selected by default
    const singlePayerRadio = screen.getByRole('radio', {
      name: /single payer/i,
    })
    expect(singlePayerRadio).toBeChecked()

    // Click the "Multiple payers — evenly" option
    const evenlyRadio = screen.getByRole('radio', {
      name: /multiple payers — evenly/i,
    })
    await user.click(evenlyRadio)

    // Now the multi-payer breakdown should appear with checkboxes for each
    // participant. The "Paid by" header should also now have the "Select all"
    // / "Select none" button rendered alongside the title.
    expect(evenlyRadio).toBeChecked()
    expect(screen.getByText('Select all')).toBeInTheDocument()

    // Each participant row should have a checkbox in the multi-payer view
    const participantCheckboxes = screen.getAllByRole('checkbox')
    // At least 2 payer checkboxes (Alice + Bob) + the Save as default checkbox = 3
    expect(participantCheckboxes.length).toBeGreaterThanOrEqual(3)
  })

  it('edit mode of a single-payer expense shows the single-payer dropdown', () => {
    const singlePayerExpense = {
      ...mockExpense,
      paidByList: [{ ledgerParticipantId: 'lp-1', shares: 5000 }],
    }
    render(
      <ExpenseForm
        group={mockGroup as any}
        expense={singlePayerExpense as any}
        onSubmit={vi.fn()}
        runtimeFeatureFlags={runtimeFeatureFlags}
      />,
    )

    // The single-payer placeholder should NOT be visible — we have a
    // preselected payer ("lp-1" → Alice) in the dropdown.
    expect(screen.queryByText('Select a participant')).not.toBeInTheDocument()

    // Alice's name should be displayed in the SelectTrigger (the dropdown's
    // current value).
    expect(screen.getAllByText('Alice').length).toBeGreaterThanOrEqual(1)

    // The single payer option card should be selected.
    const singlePayerRadio = screen.getByRole('radio', {
      name: /single payer/i,
    })
    expect(singlePayerRadio).toBeChecked()
  })

  it('edit mode of a multi-payer expense shows the multi-payer breakdown', () => {
    const multiPayerExpense = {
      ...mockExpense,
      paidBySplitMode: 'BY_AMOUNT',
      paidByList: [
        { ledgerParticipantId: 'lp-1', shares: 2500 },
        { ledgerParticipantId: 'lp-2', shares: 2500 },
      ],
    }
    render(
      <ExpenseForm
        group={mockGroup as any}
        expense={multiPayerExpense as any}
        onSubmit={vi.fn()}
        runtimeFeatureFlags={runtimeFeatureFlags}
      />,
    )

    // The "Multiple payers — by amount" option card should be selected.
    const byAmountRadio = screen.getByRole('radio', {
      name: /multiple payers — by amount/i,
    })
    expect(byAmountRadio).toBeChecked()

    // The single-payer placeholder should NOT be visible.
    expect(screen.queryByText('Select a participant')).not.toBeInTheDocument()

    // The multi-payer breakdown should render the per-row data-id wrapper
    // for each participant (one row per participant).
    const paidByRows = document.querySelectorAll('[data-id]')
    expect(paidByRows.length).toBeGreaterThanOrEqual(2)
  })

  it('multi-payer with EVENLY split mode hides the per-row input', () => {
    // Edit a multi-payer expense that was saved with EVENLY split mode.
    // The per-row Input should be omitted; the row should only contain
    // the checkbox + name label.
    const multiPayerEvenlyExpense = {
      ...mockExpense,
      paidBySplitMode: 'EVENLY',
      paidByList: [
        { ledgerParticipantId: 'lp-1', shares: 2500 },
        { ledgerParticipantId: 'lp-2', shares: 2500 },
      ],
    }
    render(
      <ExpenseForm
        group={mockGroup as any}
        expense={multiPayerEvenlyExpense as any}
        onSubmit={vi.fn()}
        runtimeFeatureFlags={runtimeFeatureFlags}
      />,
    )

    // Sanity check: the form should have rendered multi-payer breakdown.
    const dataIdWrappers = document.querySelectorAll('[data-id]')
    expect(dataIdWrappers.length).toBeGreaterThan(0)

    // The legacy code rendered a disabled <Input class="...w-[80px]...">
    // per row in EVENLY mode. After this change, no such input should be
    // rendered inside the per-row wrappers.
    const paidByPerRowShareInputs = document.querySelectorAll(
      '[data-id] input.w-\\[80px\\]',
    )
    expect(paidByPerRowShareInputs.length).toBe(0)
  })

  it('keeps single-payer paid-by amount in original currency during create', async () => {
    vi.mocked(useCurrencyRate).mockReturnValue({
      data: 1.1,
      error: null,
      isLoading: false,
      refresh: vi.fn(),
    })
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const { user } = render(
      <ExpenseForm
        group={mockGroup as any}
        onSubmit={onSubmit}
        runtimeFeatureFlags={runtimeFeatureFlags}
        currentLedgerParticipantId="lp-1"
      />,
    )

    await user.type(screen.getByLabelText(/expense title/i), 'Dinner')

    const currencySelector = screen.getAllByRole('combobox')[0]
    await user.click(currencySelector)
    await user.click(screen.getByText('Euro (EUR)'))

    // With the new UX there is only one editable Amount field. Typing
    // into it stores the value as the typed EUR amount.
    const amountInput = screen.getByRole('textbox', { name: /^amount$/i })
    await user.clear(amountInput)
    await user.type(amountInput, '100')
    await user.click(screen.getByRole('button', { name: /create/i }))

    await vi.waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1)
    })

    expect(
      screen.queryByText('Sum of payer amounts must equal the expense amount.'),
    ).not.toBeInTheDocument()
    // paidByList shares are persisted in originalCurrency minor units.
    expect(onSubmit.mock.calls[0][0].paidByList).toEqual([
      { participant: 'lp-1', shares: 10000 },
    ])
  })

  it('clears paid-by zero-share error after amount is entered in evenly mode', async () => {
    const { user } = render(
      <ExpenseForm
        group={mockGroup as any}
        onSubmit={vi.fn().mockResolvedValue(undefined)}
        runtimeFeatureFlags={runtimeFeatureFlags}
        currentLedgerParticipantId="lp-1"
      />,
    )

    await user.click(
      screen.getByRole('radio', { name: /multiple payers.*evenly/i }),
    )
    await user.type(screen.getByRole('textbox', { name: /^amount$/i }), '10')

    await vi.waitFor(() => {
      expect(
        screen.queryByText('All shares must be higher than 0.'),
      ).not.toBeInTheDocument()
    })
    expect(screen.getByText(/Evenly split: \$10\.00 × 1/)).toBeInTheDocument()

    await user.click(
      screen.getByRole('radio', { name: /multiple payers.*by shares/i }),
    )
    expect(
      screen.queryByText('All shares must be higher than 0.'),
    ).not.toBeInTheDocument()

    await user.click(
      screen.getByRole('radio', { name: /multiple payers.*evenly/i }),
    )
    expect(
      screen.queryByText('All shares must be higher than 0.'),
    ).not.toBeInTheDocument()
  })
})

// ── ParticipantDistributionFooter tests ────────────────────────────────
//
// All these tests render the form in edit mode with deterministic expense
// data so the share values are predictable. `paidFor` and `paidByList`
// share values come from the storage unit (cents / basis points) and the
// form's `defaultValues` converts them to decimal/percent for the input.
// The footer call site re-converts them to the unit the component expects.

const groupCurrency = {
  code: 'USD',
  symbol: '$',
  rounding: 0,
  decimal_digits: 2,
}

describe('ExpenseForm Total/Missing footer (paid by)', () => {
  it('BY_AMOUNT: shows "✓ Matches" in green when shares sum to the target', () => {
    const expense = {
      ...mockExpense,
      // Empty originalCurrency prevents the form from treating the group
      // currency as a foreign one and falling back to originalAmount (0).
      originalCurrency: '',
      amount: 10000, // $100.00
      paidBySplitMode: 'BY_AMOUNT' as const,
      paidByList: [
        { ledgerParticipantId: 'lp-1', shares: 4000 }, // $40.00
        { ledgerParticipantId: 'lp-2', shares: 6000 }, // $60.00
      ],
    }
    render(
      <ExpenseForm
        group={mockGroup as any}
        expense={expense as any}
        onSubmit={vi.fn()}
        runtimeFeatureFlags={runtimeFeatureFlags}
      />,
    )

    const footer = screen.getByTestId('paid-by-distribution-footer')
    expect(footer).toHaveTextContent('✓ Matches $100.00')
    expect(footer.className).toContain('text-emerald-600')
  })

  it('BY_AMOUNT: shows "Missing X of Y" in red when shares under-sum', () => {
    const expense = {
      ...mockExpense,
      originalCurrency: '',
      amount: 10000, // $100.00
      paidBySplitMode: 'BY_AMOUNT' as const,
      paidByList: [
        { ledgerParticipantId: 'lp-1', shares: 4000 }, // $40.00
        { ledgerParticipantId: 'lp-2', shares: 5000 }, // $50.00 → total $90
      ],
    }
    render(
      <ExpenseForm
        group={mockGroup as any}
        expense={expense as any}
        onSubmit={vi.fn()}
        runtimeFeatureFlags={runtimeFeatureFlags}
      />,
    )

    const footer = screen.getByTestId('paid-by-distribution-footer')
    expect(footer).toHaveTextContent('Missing $10.00 of $100.00')
    expect(footer.className).toContain('text-red-600')
  })

  it('BY_AMOUNT: shows "Surplus X of Y" in red when shares over-sum', () => {
    const expense = {
      ...mockExpense,
      originalCurrency: '',
      amount: 10000, // $100.00
      paidBySplitMode: 'BY_AMOUNT' as const,
      paidByList: [
        { ledgerParticipantId: 'lp-1', shares: 6000 }, // $60.00
        { ledgerParticipantId: 'lp-2', shares: 6000 }, // $60.00 → total $120
      ],
    }
    render(
      <ExpenseForm
        group={mockGroup as any}
        expense={expense as any}
        onSubmit={vi.fn()}
        runtimeFeatureFlags={runtimeFeatureFlags}
      />,
    )

    const footer = screen.getByTestId('paid-by-distribution-footer')
    expect(footer).toHaveTextContent('Surplus $20.00 of $100.00')
    expect(footer.className).toContain('text-red-600')
  })

  it('BY_PERCENTAGE: shows "✓ Matches 100%" in green when shares sum to 100', () => {
    const expense = {
      ...mockExpense,
      originalCurrency: '',
      paidBySplitMode: 'BY_PERCENTAGE' as const,
      paidByList: [
        { ledgerParticipantId: 'lp-1', shares: 4000 }, // 40%
        { ledgerParticipantId: 'lp-2', shares: 6000 }, // 60%
      ],
    }
    render(
      <ExpenseForm
        group={mockGroup as any}
        expense={expense as any}
        onSubmit={vi.fn()}
        runtimeFeatureFlags={runtimeFeatureFlags}
      />,
    )

    const footer = screen.getByTestId('paid-by-distribution-footer')
    expect(footer).toHaveTextContent('✓ Matches 100%')
    expect(footer.className).toContain('text-emerald-600')
  })

  it('BY_PERCENTAGE: shows "Missing X%" in red when shares under-sum', () => {
    const expense = {
      ...mockExpense,
      originalCurrency: '',
      paidBySplitMode: 'BY_PERCENTAGE' as const,
      paidByList: [
        { ledgerParticipantId: 'lp-1', shares: 4000 }, // 40%
        { ledgerParticipantId: 'lp-2', shares: 5000 }, // 50% → total 90%
      ],
    }
    render(
      <ExpenseForm
        group={mockGroup as any}
        expense={expense as any}
        onSubmit={vi.fn()}
        runtimeFeatureFlags={runtimeFeatureFlags}
      />,
    )

    const footer = screen.getByTestId('paid-by-distribution-footer')
    expect(footer).toHaveTextContent('Missing 10%')
    expect(footer.className).toContain('text-red-600')
  })

  it('EVENLY: shows "Evenly split: amount × count" in muted color', () => {
    const groupWith3 = {
      ...mockGroup,
      participants: [
        ...mockGroup.participants,
        { id: 'lp-3', name: 'Carol', pending: false, unlinked: false },
      ],
    }
    const expense = {
      ...mockExpense,
      originalCurrency: '',
      amount: 10000, // $100.00
      paidBySplitMode: 'EVENLY' as const,
      paidByList: [
        { ledgerParticipantId: 'lp-1', shares: 1 },
        { ledgerParticipantId: 'lp-2', shares: 1 },
        { ledgerParticipantId: 'lp-3', shares: 1 },
      ],
    }
    render(
      <ExpenseForm
        group={groupWith3 as any}
        expense={expense as any}
        onSubmit={vi.fn()}
        runtimeFeatureFlags={runtimeFeatureFlags}
      />,
    )

    const footer = screen.getByTestId('paid-by-distribution-footer')
    expect(footer).toHaveTextContent('Evenly split: $33.33 × 3')
    expect(footer.className).toContain('text-muted-foreground')
  })

  it('BY_SHARES: shows "Total weight: <sum> shares" in muted color', () => {
    const expense = {
      ...mockExpense,
      originalCurrency: '',
      paidBySplitMode: 'BY_SHARES' as const,
      paidByList: [
        { ledgerParticipantId: 'lp-1', shares: 100 },
        { ledgerParticipantId: 'lp-2', shares: 200 },
      ],
    }
    render(
      <ExpenseForm
        group={mockGroup as any}
        expense={expense as any}
        onSubmit={vi.fn()}
        runtimeFeatureFlags={runtimeFeatureFlags}
      />,
    )

    const footer = screen.getByTestId('paid-by-distribution-footer')
    expect(footer).toHaveTextContent('Total weight: 3 shares')
    expect(footer.className).toContain('text-muted-foreground')
  })
})

describe('ExpenseForm Total/Missing footer (paid for)', () => {
  it('BY_AMOUNT: shows "Missing X of Y" in red when shares under-sum', () => {
    const expense = {
      ...mockExpense,
      originalCurrency: '',
      amount: 10000, // $100.00
      splitMode: 'BY_AMOUNT' as const,
      paidFor: [
        { ledgerParticipantId: 'lp-1', shares: 4000 }, // $40.00
        { ledgerParticipantId: 'lp-2', shares: 5000 }, // $50.00 → total $90
      ],
    }
    render(
      <ExpenseForm
        group={mockGroup as any}
        expense={expense as any}
        onSubmit={vi.fn()}
        runtimeFeatureFlags={runtimeFeatureFlags}
      />,
    )

    const footer = screen.getByTestId('paid-for-distribution-footer')
    expect(footer).toHaveTextContent('Missing $10.00 of $100.00')
    expect(footer.className).toContain('text-red-600')
  })

  it('BY_AMOUNT: shows "✓ Matches" in green when shares sum to the target', () => {
    const expense = {
      ...mockExpense,
      originalCurrency: '',
      amount: 10000, // $100.00
      splitMode: 'BY_AMOUNT' as const,
      paidFor: [
        { ledgerParticipantId: 'lp-1', shares: 4000 }, // $40.00
        { ledgerParticipantId: 'lp-2', shares: 6000 }, // $60.00
      ],
    }
    render(
      <ExpenseForm
        group={mockGroup as any}
        expense={expense as any}
        onSubmit={vi.fn()}
        runtimeFeatureFlags={runtimeFeatureFlags}
      />,
    )

    const footer = screen.getByTestId('paid-for-distribution-footer')
    expect(footer).toHaveTextContent('✓ Matches $100.00')
    expect(footer.className).toContain('text-emerald-600')
  })
})

// ── Component-only test ────────────────────────────────────────────────
//
// Render the footer in isolation so the message/colour logic is exercised
// without depending on the full form wiring.

describe('ParticipantDistributionFooter (isolated)', () => {
  it('BY_AMOUNT: shows "✓ Matches" in green when sum equals target', () => {
    const { container } = render(
      <ParticipantDistributionFooter
        splitMode="BY_AMOUNT"
        targetAmount={10000}
        shares={[4000, 6000]}
        currency={groupCurrency}
        paidByCount={2}
      />,
    )
    const footer = container.firstChild as HTMLElement
    expect(footer).toHaveTextContent('✓ Matches $100.00')
    expect(footer.className).toContain('text-emerald-600')
  })

  it('BY_AMOUNT: shows "Missing X of Y" in red when sum is below target', () => {
    const { container } = render(
      <ParticipantDistributionFooter
        splitMode="BY_AMOUNT"
        targetAmount={10000}
        shares={[4000, 5000]}
        currency={groupCurrency}
        paidByCount={2}
      />,
    )
    const footer = container.firstChild as HTMLElement
    expect(footer).toHaveTextContent('Missing $10.00 of $100.00')
    expect(footer.className).toContain('text-red-600')
  })

  it('BY_AMOUNT: shows "Surplus X of Y" in red when sum exceeds target', () => {
    const { container } = render(
      <ParticipantDistributionFooter
        splitMode="BY_AMOUNT"
        targetAmount={10000}
        shares={[6000, 6000]}
        currency={groupCurrency}
        paidByCount={2}
      />,
    )
    const footer = container.firstChild as HTMLElement
    expect(footer).toHaveTextContent('Surplus $20.00 of $100.00')
    expect(footer.className).toContain('text-red-600')
  })

  it('BY_PERCENTAGE: shows "✓ Matches 100%" in green when shares sum to 100', () => {
    const { container } = render(
      <ParticipantDistributionFooter
        splitMode="BY_PERCENTAGE"
        targetAmount={100}
        shares={[40, 60]}
        currency={groupCurrency}
        paidByCount={2}
      />,
    )
    const footer = container.firstChild as HTMLElement
    expect(footer).toHaveTextContent('✓ Matches 100%')
    expect(footer.className).toContain('text-emerald-600')
  })

  it('BY_PERCENTAGE: shows "Missing X%" in red when shares under-sum', () => {
    const { container } = render(
      <ParticipantDistributionFooter
        splitMode="BY_PERCENTAGE"
        targetAmount={100}
        shares={[40, 50]}
        currency={groupCurrency}
        paidByCount={2}
      />,
    )
    const footer = container.firstChild as HTMLElement
    expect(footer).toHaveTextContent('Missing 10%')
    expect(footer.className).toContain('text-red-600')
  })

  it('BY_PERCENTAGE: shows "Surplus X%" in red when shares over-sum', () => {
    const { container } = render(
      <ParticipantDistributionFooter
        splitMode="BY_PERCENTAGE"
        targetAmount={100}
        shares={[60, 60]}
        currency={groupCurrency}
        paidByCount={2}
      />,
    )
    const footer = container.firstChild as HTMLElement
    expect(footer).toHaveTextContent('Surplus 20%')
    expect(footer.className).toContain('text-red-600')
  })

  it('EVENLY: shows "Evenly split: amount × count" in muted color', () => {
    const { container } = render(
      <ParticipantDistributionFooter
        splitMode="EVENLY"
        targetAmount={10000}
        shares={[]}
        currency={groupCurrency}
        paidByCount={3}
      />,
    )
    const footer = container.firstChild as HTMLElement
    expect(footer).toHaveTextContent('Evenly split: $33.33 × 3')
    expect(footer.className).toContain('text-muted-foreground')
  })

  it('BY_SHARES: shows "Total weight: <sum> shares" in muted color', () => {
    const { container } = render(
      <ParticipantDistributionFooter
        splitMode="BY_SHARES"
        targetAmount={0}
        shares={[1, 2]}
        currency={groupCurrency}
        paidByCount={2}
      />,
    )
    const footer = container.firstChild as HTMLElement
    expect(footer).toHaveTextContent('Total weight: 3 shares')
    expect(footer.className).toContain('text-muted-foreground')
  })

  it('renders nothing when splitMode is unknown', () => {
    const { container } = render(
      <ParticipantDistributionFooter
        // @ts-expect-error: testing defensive behaviour
        splitMode="UNKNOWN"
        targetAmount={0}
        shares={[]}
        currency={groupCurrency}
        paidByCount={0}
      />,
    )
    expect(container.firstChild).toBeNull()
  })
})

// ── Option-card transition tests ────────────────────────────────────────

describe('ExpenseForm option-card transitions', () => {
  it('paid-by: single payer \u2192 multiple by percentage', async () => {
    const { user } = render(
      <ExpenseForm
        group={mockGroup as any}
        onSubmit={vi.fn()}
        runtimeFeatureFlags={runtimeFeatureFlags}
      />,
    )

    const singlePayerRadio = screen.getByRole('radio', {
      name: /single payer/i,
    })
    expect(singlePayerRadio).toBeChecked()

    const percentageRadio = screen.getByRole('radio', {
      name: /multiple payers.*by percentage/i,
    })
    await user.click(percentageRadio)

    expect(percentageRadio).toBeChecked()
    expect(screen.getByText('Select all')).toBeInTheDocument()
  })

  it('paid-by: multiple by percentage \u2192 single payer resets paidBySplitMode to BY_AMOUNT', async () => {
    const multiPayerByPercentage = {
      ...mockExpense,
      paidBySplitMode: 'BY_PERCENTAGE' as const,
      paidByList: [
        { ledgerParticipantId: 'lp-1', shares: 5000 },
        { ledgerParticipantId: 'lp-2', shares: 5000 },
      ],
    }
    const { user } = render(
      <ExpenseForm
        group={mockGroup as any}
        expense={multiPayerByPercentage as any}
        onSubmit={vi.fn()}
        runtimeFeatureFlags={runtimeFeatureFlags}
      />,
    )

    const percentageRadio = screen.getByRole('radio', {
      name: /multiple payers.*by percentage/i,
    })
    expect(percentageRadio).toBeChecked()

    const singlePayerRadio = screen.getByRole('radio', {
      name: /single payer/i,
    })
    await user.click(singlePayerRadio)

    expect(singlePayerRadio).toBeChecked()
    expect(percentageRadio).not.toBeChecked()
    // After the transition the per-row BY_PERCENTAGE wrappers should be
    // gone — the form is back in single-payer mode with a single dropdown.
    const perRowByPercentageInputs = document.querySelectorAll(
      '[data-id$="/BY_PERCENTAGE/USD"] input',
    )
    expect(perRowByPercentageInputs.length).toBe(0)
  })

  it('paid-by: multiple by amount \u2192 by shares produces integer shares', async () => {
    const multiPayerExpense = {
      ...mockExpense,
      paidBySplitMode: 'BY_AMOUNT' as const,
      paidByList: [
        { ledgerParticipantId: 'lp-1', shares: 2500 },
        { ledgerParticipantId: 'lp-2', shares: 2500 },
      ],
    }
    const { user } = render(
      <ExpenseForm
        group={mockGroup as any}
        expense={multiPayerExpense as any}
        onSubmit={vi.fn()}
        runtimeFeatureFlags={runtimeFeatureFlags}
      />,
    )

    const sharesRadio = screen.getByRole('radio', {
      name: /multiple payers.*by shares/i,
    })
    await user.click(sharesRadio)

    expect(sharesRadio).toBeChecked()

    const shareInputs = document.querySelectorAll(
      '[data-id$="/BY_SHARES/USD"] input[type="text"]',
    )
    expect(shareInputs.length).toBeGreaterThan(0)
    shareInputs.forEach((input) => {
      const val = (input as HTMLInputElement).value
      expect(val).toMatch(/^\d+$/)
    })
  })

  it('paid-for: evenly \u2192 by amount shows per-participant amount inputs', async () => {
    const { user } = render(
      <ExpenseForm
        group={mockGroup as any}
        expense={
          {
            ...mockExpense,
            amount: 10000,
            splitMode: 'EVENLY' as const,
            paidFor: [
              { ledgerParticipantId: 'lp-1', shares: 1 },
              { ledgerParticipantId: 'lp-2', shares: 1 },
            ],
          } as any
        }
        onSubmit={vi.fn()}
        runtimeFeatureFlags={runtimeFeatureFlags}
      />,
    )

    const amountRadio = screen.getByRole('radio', {
      name: /split by amount/i,
    })
    await user.click(amountRadio)

    expect(amountRadio).toBeChecked()
    const paidForInputs = document.querySelectorAll(
      '[data-testid="paid-for-distribution-footer"]',
    )
    expect(paidForInputs.length).toBeGreaterThan(0)
  })
})

// ── Single→multi option-card default share tests ─────────────────────────

describe('BY_SHARES default shares on transition', () => {
  const singlePayerExpense = {
    ...mockExpense,
    paidBySplitMode: 'BY_AMOUNT' as const,
    paidByList: [{ ledgerParticipantId: 'lp-1', shares: 5000 }],
  }

  it('single → multi-by-shares: shares = 1', async () => {
    const { user } = render(
      <ExpenseForm
        group={mockGroup as any}
        expense={singlePayerExpense as any}
        onSubmit={vi.fn()}
        runtimeFeatureFlags={runtimeFeatureFlags}
      />,
    )

    const sharesRadio = screen.getByRole('radio', {
      name: /multiple payers.*by shares/i,
    })
    await user.click(sharesRadio)

    const shareInput = document.querySelector<HTMLInputElement>(
      '[data-id="lp-1/BY_SHARES/USD"] input[type="text"]',
    )
    expect(shareInput).toBeTruthy()
    expect(shareInput!.value).toBe('1')
  })

  it('single → multi-by-percentage: percentages sum to 100', async () => {
    const { user } = render(
      <ExpenseForm
        group={mockGroup as any}
        expense={singlePayerExpense as any}
        onSubmit={vi.fn()}
        runtimeFeatureFlags={runtimeFeatureFlags}
      />,
    )

    const percentageRadio = screen.getByRole('radio', {
      name: /multiple payers.*by percentage/i,
    })
    await user.click(percentageRadio)

    const shareInput = document.querySelector<HTMLInputElement>(
      '[data-id="lp-1/BY_PERCENTAGE/USD"] input[type="text"]',
    )
    expect(shareInput).toBeTruthy()
    expect(Number(shareInput!.value)).toBe(100)
  })

  it('single → multi-by-amount: shares split evenly', async () => {
    const { user } = render(
      <ExpenseForm
        group={mockGroup as any}
        expense={singlePayerExpense as any}
        onSubmit={vi.fn()}
        runtimeFeatureFlags={runtimeFeatureFlags}
      />,
    )

    const amountRadio = screen.getByRole('radio', {
      name: /multiple payers.*by amount/i,
    })
    await user.click(amountRadio)

    const shareInput = document.querySelector<HTMLInputElement>(
      '[data-id="lp-1/BY_AMOUNT/USD"] input[type="text"]',
    )
    expect(shareInput).toBeTruthy()
    expect(Number(shareInput!.value)).toBe(50)
  })
})

// ── Participant row click behavior tests ─────────────────────────────────

describe('ParticipantShareRow click behavior', () => {
  it('clicking a participant row (name text) toggles the selection', () => {
    render(
      <ExpenseForm
        group={mockGroup as any}
        expense={
          {
            ...mockExpense,
            splitMode: 'BY_AMOUNT' as const,
            paidFor: [
              { ledgerParticipantId: 'lp-1', shares: 2500 },
              { ledgerParticipantId: 'lp-2', shares: 2500 },
            ],
          } as any
        }
        onSubmit={vi.fn()}
        runtimeFeatureFlags={runtimeFeatureFlags}
      />,
    )

    // Both checkboxes should be checked initially (both in paidFor)
    const checkboxes = screen.getAllByRole('checkbox')
    const paidForCheckboxes = checkboxes.filter(
      (cb) => cb.getAttribute('data-state') !== undefined,
    )
    const initiallyChecked = paidForCheckboxes.filter(
      (cb) => cb.getAttribute('data-state') === 'checked',
    )
    expect(initiallyChecked.length).toBeGreaterThanOrEqual(2)

    // Click directly on the row div (non-interactive padding area)
    const row = document.querySelector<HTMLElement>(
      '[data-id="lp-1/BY_AMOUNT/USD"]',
    )
    expect(row).toBeTruthy()
    fireEvent.click(row!)

    // After clicking Alice's row, she should be toggled off
    const checkboxesAfter = screen.getAllByRole('checkbox')
    const checkedAfter = checkboxesAfter.filter(
      (cb) => cb.getAttribute('data-state') === 'checked',
    )
    expect(checkedAfter.length).toBe(initiallyChecked.length - 1)
  })

  it('clicking the share input does NOT toggle the checkbox', async () => {
    const { user } = render(
      <ExpenseForm
        group={mockGroup as any}
        expense={
          {
            ...mockExpense,
            splitMode: 'BY_AMOUNT' as const,
            paidFor: [
              { ledgerParticipantId: 'lp-1', shares: 2500 },
              { ledgerParticipantId: 'lp-2', shares: 2500 },
            ],
          } as any
        }
        onSubmit={vi.fn()}
        runtimeFeatureFlags={runtimeFeatureFlags}
      />,
    )

    // Find a share input inside a participant row
    const rowInput = document.querySelector<HTMLInputElement>(
      '[data-id="lp-1/BY_AMOUNT/USD"] input[type="text"]',
    )
    expect(rowInput).toBeTruthy()
    const initialChecked = rowInput!
      .closest('[data-id]')
      ?.querySelector('button[data-state]')
      ?.getAttribute('data-state')

    // Click on the input to focus it (should NOT toggle checkbox)
    await user.click(rowInput!)

    // Verify the input has focus
    expect(document.activeElement).toBe(rowInput)

    // Verify checkbox state has NOT changed
    const checkboxAfter = rowInput!
      .closest('[data-id]')
      ?.querySelector('button[data-state]')
      ?.getAttribute('data-state')
    expect(checkboxAfter).toBe(initialChecked)
  })

  it('participant row applies cursor-pointer to the wrapper when enabled', () => {
    render(
      <ExpenseForm
        group={mockGroup as any}
        expense={
          {
            ...mockExpense,
            splitMode: 'BY_AMOUNT' as const,
            paidFor: [
              { ledgerParticipantId: 'lp-1', shares: 2500 },
              { ledgerParticipantId: 'lp-2', shares: 2500 },
            ],
          } as any
        }
        onSubmit={vi.fn()}
        runtimeFeatureFlags={runtimeFeatureFlags}
      />,
    )

    const row = document.querySelector<HTMLElement>(
      '[data-id="lp-1/BY_AMOUNT/USD"]',
    )
    expect(row).toHaveClass('cursor-pointer')
  })

  it('participant row applies cursor-default to the wrapper when read-only', () => {
    render(
      <ExpenseForm
        group={mockGroup as any}
        expense={
          {
            ...mockExpense,
            splitMode: 'BY_AMOUNT' as const,
            paidFor: [
              { ledgerParticipantId: 'lp-1', shares: 2500 },
              { ledgerParticipantId: 'lp-2', shares: 2500 },
            ],
          } as any
        }
        onSubmit={vi.fn()}
        runtimeFeatureFlags={runtimeFeatureFlags}
        readOnly
      />,
    )

    const row = document.querySelector<HTMLElement>(
      '[data-id="lp-1/BY_AMOUNT/USD"]',
    )
    expect(row).toHaveClass('cursor-default')
  })
})
