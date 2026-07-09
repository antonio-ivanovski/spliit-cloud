import { ExpenseForm } from '@/app/groups/[groupId]/expenses/expense-form'
import type {
  GroupShape,
  LoadedExpense,
} from '@/app/groups/[groupId]/expenses/expense-form/default-values'
import { ParticipantDistributionFooter } from '@/components/participant-distribution-footer'
import { getCurrency, useCurrencies } from '@/lib/currency'
import { useCurrencyRate } from '@/lib/hooks'
import { fireEvent, render, screen } from '@/test/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// ── Module mocks ────────────────────────────────────────────────────────

vi.mock('@trpc/react-query', () => ({
  createTRPCReact: () => {},
}))

// All tRPC mocks are hoisted alongside each other so the `@/trpc/client`
// mock factory (which is physically lifted to the top of the file by
// vitest) can reference the same fn instances that tests later assert
// against. Without `vi.hoisted` the factory would close over undefined.
const {
  mockUseMutation,
  mockCurrencyGetRate,
  mockAccountDefaultSplit,
  mockInvalidateDefaultSplit,
  mockCommonCurrencies,
} = vi.hoisted(() => {
  // Shape returned by tRPC `useQuery` mocks. `data` is `unknown` here so
  // per-test overrides (e.g. `{ defaultSplit: { splitMode, paidFor } }`)
  // stay assignable without the mock fn literal narrowing the type.
  type MockQueryResult = {
    data: unknown
    error: null
    isLoading: boolean
    isSuccess?: boolean
    refetch: ReturnType<typeof vi.fn>
  }

  // Mirrors tRPC's `useMutation({ onSuccess })` shape: `.mutate`
  // invokes the configured `onSuccess` (e.g. invalidating caches)
  // plus any per-call `onSuccess` passed as the second argument.
  // `.mutateAsync` resolves to a small stub so existing submit-helpers
  // keep working.
  const mockUseMutation = vi.fn((opts?: { onSuccess?: () => void }) => {
    const mutate = (
      _payload: unknown,
      callOpts?: { onSuccess?: () => void },
    ) => {
      opts?.onSuccess?.()
      callOpts?.onSuccess?.()
    }
    return {
      mutate,
      mutateAsync: vi.fn().mockResolvedValue({ categoryId: 'general' }),
      isPending: false,
    }
  })

  const mockCurrencyGetRate = vi.fn((_opts?: unknown): MockQueryResult => ({
    data: undefined,
    error: null,
    isLoading: false,
    isSuccess: false,
    refetch: vi.fn(),
  }))

  // Defaults to `data: undefined` (no saved default) — individual
  // tests override per-call to exercise the Load/Save buttons.
  const mockAccountDefaultSplit = vi.fn((_opts?: unknown): MockQueryResult => ({
    data: undefined,
    error: null,
    isLoading: false,
    isSuccess: false,
    refetch: vi.fn(),
  }))

  // No group history by default; selector keeps static common fallback
  // while `isSuccess` is false.
  const mockCommonCurrencies = vi.fn((_opts?: unknown): MockQueryResult => ({
    data: undefined,
    error: null,
    isLoading: false,
    isSuccess: false,
    refetch: vi.fn(),
  }))

  const mockInvalidateDefaultSplit = vi.fn()

  return {
    mockUseMutation,
    mockCurrencyGetRate,
    mockAccountDefaultSplit,
    mockInvalidateDefaultSplit,
    mockCommonCurrencies,
  }
})

vi.mock('@/trpc/client', () => ({
  trpc: {
    ai: {
      extractCategoryFromTitle: {
        useMutation: () => mockUseMutation(),
      },
    },
    currency: {
      getRate: {
        useQuery: (opts: unknown) => mockCurrencyGetRate(opts),
      },
    },
    groups: {
      expenses: {
        commonCurrencies: {
          useQuery: (opts: unknown) => mockCommonCurrencies(opts),
        },
      },
    },
    account: {
      defaultSplit: {
        useQuery: (opts: unknown) => mockAccountDefaultSplit(opts),
      },
      setDefaultSplit: {
        // Forward opts to the mock factory so the configured `onSuccess`
        // (e.g. invalidating caches) is captured when the component
        // calls `trpc.account.setDefaultSplit.useMutation({ onSuccess })`.
        useMutation: (opts?: { onSuccess?: () => void }) =>
          mockUseMutation(opts),
      },
    },
    useUtils: () => ({
      account: {
        defaultSplit: {
          invalidate: (input: unknown) => mockInvalidateDefaultSplit(input),
        },
      },
    }),
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

// Mirror of the type declared inside the `vi.hoisted` block above.
// Tests use this to type-annotate `mockImplementation` callbacks.
type MockQueryResult = {
  data: unknown
  error: null
  isLoading: boolean
  isSuccess?: boolean
  refetch: ReturnType<typeof vi.fn>
}

beforeEach(() => {
  mockAccountDefaultSplit.mockReset()
  mockAccountDefaultSplit.mockImplementation(
    (_opts?: unknown): MockQueryResult => ({
      data: undefined,
      error: null,
      isLoading: false,
      isSuccess: false,
      refetch: vi.fn(),
    }),
  )
  mockCurrencyGetRate.mockReset()
  mockCurrencyGetRate.mockImplementation(
    (_opts?: unknown): MockQueryResult => ({
      data: undefined,
      error: null,
      isLoading: false,
      isSuccess: false,
      refetch: vi.fn(),
    }),
  )
  mockCommonCurrencies.mockReset()
  mockCommonCurrencies.mockImplementation(
    (_opts?: unknown): MockQueryResult => ({
      data: undefined,
      error: null,
      isLoading: false,
      isSuccess: false,
      refetch: vi.fn(),
    }),
  )
  mockInvalidateDefaultSplit.mockReset()

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
        group={mockGroup as unknown as GroupShape}
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
        group={mockGroup as unknown as GroupShape}
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
        group={mockGroup as unknown as GroupShape}
        expense={mockExpense as unknown as LoadedExpense}
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
      conversionRate: 1.1,
      conversionType: 'CUSTOM' as const,
    }
    render(
      <ExpenseForm
        group={mockGroup as unknown as GroupShape}
        expense={expenseWithConversion as unknown as LoadedExpense}
        onSubmit={vi.fn()}
        runtimeFeatureFlags={runtimeFeatureFlags}
      />,
    )

    // CUSTOM source restores the custom rate input.
    expect(screen.getByDisplayValue('1.1')).toBeInTheDocument()

    // The single editable Amount field carries the typed EUR value, not
    // the converted USD ledger amount.
    const amountInput = screen.getByRole('textbox', { name: /^amount$/i })
    expect(amountInput).toHaveValue('50')

    // The read-only converted preview renders the Ledger-currency amount.
    const preview = screen.getByTestId('converted-amount-preview')
    expect(preview).toHaveTextContent(/55\.00/)
  })

  it('edit mode of an EXCHANGE expense keeps the exchange-rate UI (not custom rate input)', () => {
    const expenseWithExchange = {
      ...mockExpense,
      originalCurrency: 'EUR',
      originalAmount: 5000,
      conversionRate: 1.1,
      conversionSource: 'EXCHANGE' as const,
    }
    render(
      <ExpenseForm
        group={mockGroup as unknown as GroupShape}
        expense={expenseWithExchange as unknown as LoadedExpense}
        onSubmit={vi.fn()}
        runtimeFeatureFlags={runtimeFeatureFlags}
      />,
    )

    // EXCHANGE must not open the custom rate input.
    expect(screen.queryByDisplayValue('1.1')).not.toBeInTheDocument()

    const amountInput = screen.getByRole('textbox', { name: /^amount$/i })
    expect(amountInput).toHaveValue('50')
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
          } as unknown as GroupShape
        }
        expense={
          {
            ...mockExpense,
            originalCurrency: 'EUR',
            originalAmount: 5000,
            conversionRate: 1.1,
            paidFor: [{ ledgerParticipantId: 'lp-1', shares: 5000 }],
          } as unknown as LoadedExpense
        }
        onSubmit={onSubmit}
        runtimeFeatureFlags={runtimeFeatureFlags}
      />,
    )

    const saveButton = screen
      .getAllByRole('button', { name: /^Save$/ })
      .find((b) => (b as HTMLButtonElement).type === 'submit')!
    await user.click(saveButton)
    await vi.waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1)
    })

    const submittedValues = onSubmit.mock.calls[0][0]
    expect(submittedValues.conversion).toMatchObject({
      type: 'custom',
      currency: 'EUR',
    })
    expect(submittedValues.amount).toBe(5000)
  })

  it('submits conversion none when currencies match', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const { user } = render(
      <ExpenseForm
        group={
          {
            ...mockGroup,
            participants: [
              { id: 'lp-1', name: 'Alice', pending: false, unlinked: false },
            ],
          } as unknown as GroupShape
        }
        expense={
          {
            ...mockExpense,
            originalCurrency: 'USD',
            originalAmount: 5000,
            conversionRate: 1,
            paidFor: [{ ledgerParticipantId: 'lp-1', shares: 5000 }],
          } as unknown as LoadedExpense
        }
        onSubmit={onSubmit}
        runtimeFeatureFlags={runtimeFeatureFlags}
      />,
    )

    const saveButton = screen
      .getAllByRole('button', { name: /^Save$/ })
      .find((b) => (b as HTMLButtonElement).type === 'submit')!
    await user.click(saveButton)
    await vi.waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1)
    })

    const submittedValues = onSubmit.mock.calls[0][0]
    expect(submittedValues.conversion).toBeUndefined()
  })

  it('renders a single editable Amount field (no separate "Amount to convert")', () => {
    render(
      <ExpenseForm
        group={mockGroup as unknown as GroupShape}
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
        group={mockGroup as unknown as GroupShape}
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
        group={mockGroup as unknown as GroupShape}
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
        group={mockGroup as unknown as GroupShape}
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

  it('does not render the refresh button when the conversion rate loaded successfully', async () => {
    vi.mocked(useCurrencyRate).mockReturnValue({
      data: 1.1,
      error: null,
      isLoading: false,
      refresh: vi.fn(),
    })
    const { user } = render(
      <ExpenseForm
        group={mockGroup as unknown as GroupShape}
        onSubmit={vi.fn()}
        runtimeFeatureFlags={runtimeFeatureFlags}
        currentLedgerParticipantId="lp-1"
      />,
    )

    const currencySelector = screen.getAllByRole('combobox')[0]
    await user.click(currencySelector)
    await user.click(screen.getByText('Euro (EUR)'))

    await screen.findByTestId('converted-amount-preview')

    expect(
      screen.queryByRole('button', { name: /refresh/i }),
    ).not.toBeInTheDocument()
  })

  it('shows the refresh button on conversion rate error and clicking it does not submit the form', async () => {
    const refresh = vi.fn()
    vi.mocked(useCurrencyRate).mockReturnValue({
      data: undefined,
      error: new Error('Could not fetch rate'),
      isLoading: false,
      refresh,
    })
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const { user } = render(
      <ExpenseForm
        group={mockGroup as unknown as GroupShape}
        onSubmit={onSubmit}
        runtimeFeatureFlags={runtimeFeatureFlags}
        currentLedgerParticipantId="lp-1"
      />,
    )

    const currencySelector = screen.getAllByRole('combobox')[0]
    await user.click(currencySelector)
    await user.click(screen.getByText('Euro (EUR)'))

    const retryButton = await screen.findByRole('button', { name: /refresh/i })
    expect(retryButton).toBeInTheDocument()

    await user.click(retryButton)
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(onSubmit).not.toHaveBeenCalled()
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
          } as unknown as GroupShape
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
    // Typed EUR 100 → amount 10000 EUR minor units + exchange conversion.
    expect(submitted).toHaveProperty('amount', 10000)
    expect(submitted.conversion).toEqual({ type: 'exchange', currency: 'EUR' })
  })

  it('split mode selector is visible by default', () => {
    render(
      <ExpenseForm
        group={mockGroup as unknown as GroupShape}
        onSubmit={vi.fn()}
        runtimeFeatureFlags={runtimeFeatureFlags}
      />,
    )

    // Split mode option cards should be visible without clicking anything
    expect(
      screen.getByRole('radio', { name: /split evenly/i }),
    ).toBeInTheDocument()
  })

  it('"Make a copy" button renders in the header for edit mode', () => {
    const onSubmit = vi.fn()
    const onDelete = vi.fn()
    render(
      <ExpenseForm
        group={mockGroup as unknown as GroupShape}
        expense={mockExpense as unknown as LoadedExpense}
        onMakeCopy={vi.fn()}
        onSubmit={onSubmit}
        onDelete={onDelete}
        runtimeFeatureFlags={runtimeFeatureFlags}
      />,
    )

    expect(screen.getByTestId('expense-make-copy')).toBeInTheDocument()
    // The Delete button is back in the sticky actions bar.
    expect(screen.getByRole('button', { name: /delete/i })).toBeInTheDocument()
  })

  it('no "Make a copy" button in create mode', () => {
    const onSubmit = vi.fn()
    render(
      <ExpenseForm
        group={mockGroup as unknown as GroupShape}
        onSubmit={onSubmit}
        runtimeFeatureFlags={runtimeFeatureFlags}
      />,
    )

    expect(screen.queryByTestId('expense-make-copy')).not.toBeInTheDocument()
  })

  it('clicking "Make a copy" calls onMakeCopy (toast + navigation owned by caller)', async () => {
    const onSubmit = vi.fn()
    const onMakeCopy = vi.fn()
    const { user } = render(
      <ExpenseForm
        group={mockGroup as unknown as GroupShape}
        expense={mockExpense as unknown as LoadedExpense}
        onMakeCopy={onMakeCopy}
        onSubmit={onSubmit}
        runtimeFeatureFlags={runtimeFeatureFlags}
      />,
    )

    await user.click(screen.getByTestId('expense-make-copy'))

    expect(onMakeCopy).toHaveBeenCalledTimes(1)
  })

  it('copy mode prefills the form from the source expense with today as the date', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2025-07-15T12:00:00.000Z'))
    try {
      const onSubmit = vi.fn()
      render(
        <ExpenseForm
          group={mockGroup as unknown as GroupShape}
          expense={mockExpense as unknown as LoadedExpense}
          isCopy
          // Pre-translated heading supplied by CreateExpenseForm.
          heading={`Create copy: ${mockExpense.title}`}
          onSubmit={onSubmit}
          runtimeFeatureFlags={runtimeFeatureFlags}
        />,
      )

      expect(
        screen.getByRole('heading', { name: /create copy: dinner/i }),
      ).toBeInTheDocument()
      // Copy destination has no source expense of its own to copy from.
      expect(screen.queryByTestId('expense-make-copy')).not.toBeInTheDocument()
      expect(screen.getByDisplayValue('2025-07-15')).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('edit mode renders the resolved "{title}" heading when supplied', () => {
    const onSubmit = vi.fn()
    render(
      <ExpenseForm
        group={mockGroup as unknown as GroupShape}
        expense={mockExpense as unknown as LoadedExpense}
        heading={`Edit: ${mockExpense.title}`}
        onSubmit={onSubmit}
        runtimeFeatureFlags={runtimeFeatureFlags}
      />,
    )

    expect(
      screen.getByRole('heading', { name: /edit: dinner/i }),
    ).toBeInTheDocument()
  })

  it('read-only disables inputs', () => {
    const onSubmit = vi.fn()
    render(
      <ExpenseForm
        group={mockGroup as unknown as GroupShape}
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
        group={mockGroup as unknown as GroupShape}
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
        group={mockGroup as unknown as GroupShape}
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
        group={mockGroup as unknown as GroupShape}
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
        group={mockGroup as unknown as GroupShape}
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
        group={mockGroup as unknown as GroupShape}
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
        group={mockGroup as unknown as GroupShape}
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
        group={mockGroup as unknown as GroupShape}
        expense={singlePayerExpense as unknown as LoadedExpense}
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
        group={mockGroup as unknown as GroupShape}
        expense={multiPayerExpense as unknown as LoadedExpense}
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
        group={mockGroup as unknown as GroupShape}
        expense={multiPayerEvenlyExpense as unknown as LoadedExpense}
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
        group={mockGroup as unknown as GroupShape}
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
        group={mockGroup as unknown as GroupShape}
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
        group={mockGroup as unknown as GroupShape}
        expense={expense as unknown as LoadedExpense}
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
        group={mockGroup as unknown as GroupShape}
        expense={expense as unknown as LoadedExpense}
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
        group={mockGroup as unknown as GroupShape}
        expense={expense as unknown as LoadedExpense}
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
        group={mockGroup as unknown as GroupShape}
        expense={expense as unknown as LoadedExpense}
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
        group={mockGroup as unknown as GroupShape}
        expense={expense as unknown as LoadedExpense}
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
        group={groupWith3 as unknown as GroupShape}
        expense={expense as unknown as LoadedExpense}
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
        { ledgerParticipantId: 'lp-1', shares: 1 },
        { ledgerParticipantId: 'lp-2', shares: 2 },
      ],
    }
    render(
      <ExpenseForm
        group={mockGroup as unknown as GroupShape}
        expense={expense as unknown as LoadedExpense}
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
        group={mockGroup as unknown as GroupShape}
        expense={expense as unknown as LoadedExpense}
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
        group={mockGroup as unknown as GroupShape}
        expense={expense as unknown as LoadedExpense}
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
        group={mockGroup as unknown as GroupShape}
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
        group={mockGroup as unknown as GroupShape}
        expense={multiPayerByPercentage as unknown as LoadedExpense}
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
        group={mockGroup as unknown as GroupShape}
        expense={multiPayerExpense as unknown as LoadedExpense}
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
        group={mockGroup as unknown as GroupShape}
        expense={
          {
            ...mockExpense,
            amount: 10000,
            splitMode: 'EVENLY' as const,
            paidFor: [
              { ledgerParticipantId: 'lp-1', shares: 1 },
              { ledgerParticipantId: 'lp-2', shares: 1 },
            ],
          } as unknown as LoadedExpense
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
        group={mockGroup as unknown as GroupShape}
        expense={singlePayerExpense as unknown as LoadedExpense}
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
        group={mockGroup as unknown as GroupShape}
        expense={singlePayerExpense as unknown as LoadedExpense}
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
        group={mockGroup as unknown as GroupShape}
        expense={singlePayerExpense as unknown as LoadedExpense}
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
        group={mockGroup as unknown as GroupShape}
        expense={
          {
            ...mockExpense,
            splitMode: 'BY_AMOUNT' as const,
            paidFor: [
              { ledgerParticipantId: 'lp-1', shares: 2500 },
              { ledgerParticipantId: 'lp-2', shares: 2500 },
            ],
          } as unknown as LoadedExpense
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
        group={mockGroup as unknown as GroupShape}
        expense={
          {
            ...mockExpense,
            splitMode: 'BY_AMOUNT' as const,
            paidFor: [
              { ledgerParticipantId: 'lp-1', shares: 2500 },
              { ledgerParticipantId: 'lp-2', shares: 2500 },
            ],
          } as unknown as LoadedExpense
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
        group={mockGroup as unknown as GroupShape}
        expense={
          {
            ...mockExpense,
            splitMode: 'BY_AMOUNT' as const,
            paidFor: [
              { ledgerParticipantId: 'lp-1', shares: 2500 },
              { ledgerParticipantId: 'lp-2', shares: 2500 },
            ],
          } as unknown as LoadedExpense
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
        group={mockGroup as unknown as GroupShape}
        expense={
          {
            ...mockExpense,
            splitMode: 'BY_AMOUNT' as const,
            paidFor: [
              { ledgerParticipantId: 'lp-1', shares: 2500 },
              { ledgerParticipantId: 'lp-2', shares: 2500 },
            ],
          } as unknown as LoadedExpense
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

// ── Default-split Load/Save button tests ──────────────────────────────────
//
// Bug history: the Load button used to be gated by `{ enabled: isCreate }`
// on the `trpc.account.defaultSplit` query, which meant it was hidden on
// edit (Bug 1) and stayed hidden after a Save mutation because the
// invalidate() target was disabled (Bug 2). These tests pin both flows so
// the regression cannot come back.

describe('ExpenseForm default-split buttons', () => {
  // Inputs:
  // - group with two participants lp-1 (Alice) and lp-2 (Bob)
  // - mockExpense defaults to `splitMode: 'EVENLY'`, paidFor weighted
  //   equally — by changing paidFor to BY_PERCENTAGE 50/50 we can
  //   exercise the "live matches saved" and "live diverges from saved"
  //   states without touching real DB data.
  const savedEvenly: NonNullable<
    ReturnType<typeof mockAccountDefaultSplit>
  >['data'] = {
    defaultSplit: {
      splitMode: 'EVENLY',
      paidFor: [
        { participant: 'lp-1', shares: 1 },
        { participant: 'lp-2', shares: 1 },
      ],
    },
  }

  it('edit mode with a saved default shows the Load button (Bug 1 regression)', () => {
    mockAccountDefaultSplit.mockReturnValue({
      data: savedEvenly,
      error: null,
      isLoading: false,
      refetch: vi.fn(),
    })

    // Edit an expense whose live split is BY_PERCENTAGE 50/50 so it
    // diverges from the EVENLY saved default. Pre-fix this rendered
    // no Load button (query was gated on `isCreate`).
    const divergentEdit = {
      ...mockExpense,
      splitMode: 'BY_PERCENTAGE' as const,
      paidFor: [
        { ledgerParticipantId: 'lp-1', shares: 5000 },
        { ledgerParticipantId: 'lp-2', shares: 5000 },
      ],
    }
    render(
      <ExpenseForm
        group={mockGroup as unknown as GroupShape}
        expense={divergentEdit as unknown as LoadedExpense}
        onSubmit={vi.fn()}
        runtimeFeatureFlags={runtimeFeatureFlags}
      />,
    )

    expect(screen.getByRole('button', { name: /^load$/i })).toBeInTheDocument()
    expect(getDefaultSplitSaveButton()).toBeInTheDocument()
  })

  it('edit mode with no saved default still surfaces Save but hides Load', () => {
    // Default mock behaviour — `data: undefined`.
    mockAccountDefaultSplit.mockReturnValue({
      data: { defaultSplit: null },
      error: null,
      isLoading: false,
      refetch: vi.fn(),
    })

    render(
      <ExpenseForm
        group={mockGroup as unknown as GroupShape}
        expense={
          {
            ...mockExpense,
            splitMode: 'BY_PERCENTAGE' as const,
            paidFor: [
              { ledgerParticipantId: 'lp-1', shares: 8000 },
              { ledgerParticipantId: 'lp-2', shares: 2000 },
            ],
          } as unknown as LoadedExpense
        }
        onSubmit={vi.fn()}
        runtimeFeatureFlags={runtimeFeatureFlags}
      />,
    )

    expect(getDefaultSplitSaveButton()).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /^load$/i }),
    ).not.toBeInTheDocument()
  })

  it('edit mode: Save → invalidate refetches → Load reappears (Bug 2 regression)', async () => {
    // First query hit returns null (pre-save). Subsequent hits return a
    // saved EVENLY default — the same shape the server would persist
    // after Save succeeds, so the live BY_PERCENTAGE form diverges and
    // the Load button becomes available. Pre-fix this sequence left
    // Load hidden because the query was disabled on edit.
    mockAccountDefaultSplit
      .mockReturnValueOnce({
        data: { defaultSplit: null },
        error: null,
        isLoading: false,
        refetch: vi.fn(),
      })
      .mockReturnValue({
        data: {
          defaultSplit: {
            splitMode: 'EVENLY',
            paidFor: [
              { participant: 'lp-1', shares: 1 },
              { participant: 'lp-2', shares: 1 },
            ],
          },
        },
        error: null,
        isLoading: false,
        refetch: vi.fn(),
      })

    const { user } = render(
      <ExpenseForm
        group={mockGroup as unknown as GroupShape}
        expense={
          {
            ...mockExpense,
            splitMode: 'BY_PERCENTAGE' as const,
            paidFor: [
              { ledgerParticipantId: 'lp-1', shares: 7000 },
              { ledgerParticipantId: 'lp-2', shares: 3000 },
            ],
          } as unknown as LoadedExpense
        }
        onSubmit={vi.fn()}
        runtimeFeatureFlags={runtimeFeatureFlags}
      />,
    )

    // Click the DefaultSplit "Save" link button (the form's submit
    // button labelled "Save" is filtered out by `getDefaultSplitSaveButton`).
    const saveLink = getDefaultSplitSaveButton()
    expect(saveLink).toBeEnabled()
    await user.click(saveLink)

    // 1) The mutation's configured onSuccess fires the cache invalidation.
    expect(mockInvalidateDefaultSplit).toHaveBeenCalledWith({
      groupId: 'group-1',
    })

    // 2) The Save button swaps to a "Saved as default" confirmation.
    expect(await screen.findByText(/saved as default/i)).toBeInTheDocument()

    // 3) The refetched defaultSplit diverges from the live form, so Load
    //    is now offered — proving that the gate which used to suppress
    //    the query on edit would have prevented reaching this state.
    expect(
      await screen.findByRole('button', { name: /^load$/i }),
    ).toBeInTheDocument()
  })

  it('read-only mode hides both Load and Save regardless of saved default', () => {
    mockAccountDefaultSplit.mockReturnValue({
      data: savedEvenly,
      error: null,
      isLoading: false,
      refetch: vi.fn(),
    })

    render(
      <ExpenseForm
        group={mockGroup as unknown as GroupShape}
        expense={mockExpense as unknown as LoadedExpense}
        onSubmit={vi.fn()}
        runtimeFeatureFlags={runtimeFeatureFlags}
        readOnly
      />,
    )

    expect(
      screen.queryByRole('button', { name: /^load$/i }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /^save$/i }),
    ).not.toBeInTheDocument()
  })
})

// Resolve the "Save" link button inside DefaultSplitActions. The form's
// submit button shares the same accessible name ("Save" / "Create");
// disambiguate by `type !== 'submit'` since the DefaultSplit button
// uses `type="button"` on a `variant="link"`.
function getDefaultSplitSaveButton(): HTMLButtonElement {
  const candidates = screen
    .getAllByRole('button', { name: /^save$/i })
    .filter((b) => (b as HTMLButtonElement).type !== 'submit')
  if (candidates.length !== 1) {
    throw new Error(
      `Expected exactly 1 DefaultSplit "Save" button, got ${candidates.length}`,
    )
  }
  return candidates[0] as HTMLButtonElement
}
