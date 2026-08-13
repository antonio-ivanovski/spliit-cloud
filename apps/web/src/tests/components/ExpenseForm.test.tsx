import { beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  GroupShape,
  LoadedExpense,
} from '@/app/groups/[groupId]/expenses/expense-form/default-values'
import { ExpenseForm } from '@/app/groups/[groupId]/expenses/expense-form/index'
import { ParticipantDistributionFooter } from '@/components/participant-distribution-footer'
import { getCurrency, useCurrencies } from '@/lib/currency'
import { useCurrencyRate, useMediaQuery } from '@/lib/hooks'
import type { Expense } from '@/lib/schemas'
import { act, fireEvent, render, screen, within } from '@/test/test-utils'

// ── Module mocks ────────────────────────────────────────────────────────

const accountPreferenceMocks = vi.hoisted(() => ({
  preferences: {
    defaultCurrencyCode: 'USD',
    timeZone: 'UTC',
    locale: 'en-US',
    theme: 'system',
  } as {
    defaultCurrencyCode: string | null
    timeZone: string | null
    locale: 'en-US' | null
    theme: 'system' | null
  },
  timeZoneCheck: {
    checked: true,
    promptActive: false,
  },
}))

vi.mock('@trpc/react-query', () => ({
  createTRPCReact: () => {},
}))

vi.mock('@/components/account-preferences-sync', async (importOriginal) => ({
  ...(await importOriginal()),
  useSyncedAccountPreferences: () => accountPreferenceMocks.preferences,
  useStartupTimeZoneCheck: () => accountPreferenceMocks.timeZoneCheck,
}))

// All tRPC mocks are hoisted alongside each other so the `@/trpc/client`
// mock factory (which is physically lifted to the top of the file by
// vitest) can reference the same fn instances that tests later assert
// against. Without `vi.hoisted` the factory would close over undefined.
const {
  mockUseMutation,
  mockCategoryMutateAsync,
  mockCategoryReset,
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
  const mockCategoryMutateAsync = vi
    .fn()
    .mockResolvedValue({ categoryId: 'general' })
  const mockCategoryReset = vi.fn()

  const mockCurrencyGetRate = vi.fn(
    (_opts?: unknown): MockQueryResult => ({
      data: undefined,
      error: null,
      isLoading: false,
      isSuccess: false,
      refetch: vi.fn(),
    }),
  )

  // Defaults to `data: undefined` (no saved default) — individual
  // tests override per-call to exercise the Load/Save buttons.
  const mockAccountDefaultSplit = vi.fn(
    (_opts?: unknown): MockQueryResult => ({
      data: undefined,
      error: null,
      isLoading: false,
      isSuccess: false,
      refetch: vi.fn(),
    }),
  )

  // No group history by default; selector keeps static common fallback
  // while `isSuccess` is false.
  const mockCommonCurrencies = vi.fn(
    (_opts?: unknown): MockQueryResult => ({
      data: undefined,
      error: null,
      isLoading: false,
      isSuccess: false,
      refetch: vi.fn(),
    }),
  )

  const mockInvalidateDefaultSplit = vi.fn()

  return {
    mockUseMutation,
    mockCategoryMutateAsync,
    mockCategoryReset,
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
        useMutation: () => ({
          mutateAsync: mockCategoryMutateAsync,
          reset: mockCategoryReset,
          isPending: false,
        }),
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
  useCurrentGroupOrNull: vi.fn().mockReturnValue(null),
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
    {
      id: 'lp-1',
      name: 'Alice',
      account: null,
      pending: false,
      unlinked: false,
    },
    {
      id: 'lp-2',
      name: 'Bob',
      account: null,
      pending: false,
      unlinked: false,
    },
  ],
}

const mockExpense = {
  id: 'expense-1',
  title: 'Dinner',
  expenseDate: new Date('2025-06-15T15:00:00.000Z'),
  expenseTimeZone: 'UTC',
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
  enableVoiceExpense: false,
  enableCategoryExtract: false,
  enableBulkCategorize: false,
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
  accountPreferenceMocks.preferences = {
    defaultCurrencyCode: 'USD',
    timeZone: 'UTC',
    locale: 'en-US',
    theme: 'system',
  }
  accountPreferenceMocks.timeZoneCheck = {
    checked: true,
    promptActive: false,
  }
  mockCategoryMutateAsync.mockReset()
  mockCategoryMutateAsync.mockResolvedValue({ categoryId: 'general' })
  mockCategoryReset.mockReset()
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
    via: undefined,
    sources: [],
    refresh: vi.fn(),
  })
  vi.mocked(useMediaQuery).mockReturnValue(true)
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
    expect(
      screen.getByRole('combobox', { name: 'General' }),
    ).toBeInTheDocument()
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

  it('keeps the primary create and edit actions fixed to the viewport', () => {
    const assertFixedSubmitBar = () => {
      const submitButton = screen
        .getAllByRole('button')
        .find((button) => (button as HTMLButtonElement).type === 'submit')
      expect(submitButton).toBeDefined()
      expect(submitButton?.closest('.fixed')).toHaveClass(
        'inset-x-0',
        'bottom-0',
        'z-40',
      )
    }

    const createView = render(
      <ExpenseForm
        group={mockGroup as unknown as GroupShape}
        onSubmit={vi.fn()}
        runtimeFeatureFlags={runtimeFeatureFlags}
      />,
    )
    assertFixedSubmitBar()
    createView.unmount()

    render(
      <ExpenseForm
        group={mockGroup as unknown as GroupShape}
        expense={mockExpense as unknown as LoadedExpense}
        onSubmit={vi.fn()}
        runtimeFeatureFlags={runtimeFeatureFlags}
      />,
    )
    assertFixedSubmitBar()
  })

  it('tabs through the primary expense path before secondary controls', async () => {
    const { user } = render(
      <ExpenseForm
        group={mockGroup as unknown as GroupShape}
        onSubmit={vi.fn()}
        runtimeFeatureFlags={runtimeFeatureFlags}
      />,
    )

    const title = screen.getByRole('textbox', { name: /expense title/i })
    const amount = screen.getByRole('textbox', { name: /^amount$/i })
    const date = screen.getByRole('combobox', { name: /expense date/i })
    const paidForMode = screen.getByRole('radio', {
      name: /split.*evenly/i,
    })
    const paidByMode = screen.getByRole('radio', { name: /single payer/i })
    const payer = screen.getAllByRole('combobox').at(-1)
    if (!payer) throw new Error('Payer selector not found')
    const submit = screen.getByRole('button', { name: /^create$/i })

    await user.tab()
    expect(title).toHaveFocus()
    await user.tab()
    expect(amount).toHaveFocus()
    await user.tab()
    expect(date).toHaveFocus()
    await user.tab()
    expect(paidForMode).toHaveFocus()
    const participantButtons = Array.from(
      document.querySelectorAll<HTMLButtonElement>('button[aria-pressed]'),
    )
    await user.tab()
    expect(participantButtons[0]).toHaveFocus()
    await user.tab()
    expect(participantButtons[1]).toHaveFocus()
    await user.tab()
    expect(paidByMode).toHaveFocus()
    await user.tab()
    expect(payer).toHaveFocus()
    await user.tab()
    expect(submit).toHaveFocus()

    await user.tab()
    expect(submit).not.toHaveFocus()
    expect(screen.getByRole('combobox', { name: 'General' })).toHaveFocus()
  })

  it('uses the same primary path on mobile and reverses it with Shift+Tab', async () => {
    vi.mocked(useMediaQuery).mockReturnValue(false)
    const { user } = render(
      <ExpenseForm
        group={mockGroup as unknown as GroupShape}
        expense={mockExpense as unknown as LoadedExpense}
        onSubmit={vi.fn()}
        runtimeFeatureFlags={runtimeFeatureFlags}
      />,
    )

    const title = screen.getByRole('textbox', { name: /expense title/i })
    const amount = screen.getByRole('textbox', { name: /^amount$/i })
    const date = screen.getByRole('combobox', { name: /expense date/i })
    const submit = screen
      .getAllByRole('button', { name: /^save$/i })
      .find((button) => (button as HTMLButtonElement).type === 'submit')
    if (!submit) throw new Error('Submit button not found')
    const payer = screen.getAllByRole('combobox').at(-1)
    if (!payer) throw new Error('Payer selector not found')

    await user.tab()
    expect(title).toHaveFocus()
    await user.tab()
    expect(amount).toHaveFocus()
    await user.tab()
    expect(date).toHaveFocus()

    fireEvent.pointerDown(submit)
    act(() => submit.focus())
    await user.tab({ shift: true })
    expect(payer).toHaveFocus()
  })

  it('inserts visible item and share inputs into the primary path', async () => {
    const { user } = render(
      <ExpenseForm
        group={mockGroup as unknown as GroupShape}
        onSubmit={vi.fn()}
        runtimeFeatureFlags={runtimeFeatureFlags}
      />,
    )

    await user.click(screen.getByRole('button', { name: /show items/i }))
    await user.click(screen.getByRole('button', { name: /add item/i }))
    const date = screen.getByRole('combobox', { name: /expense date/i })
    const itemTitle = screen.getByRole('textbox', { name: 'Item' })
    const itemCost = screen.getByRole('textbox', { name: 'Cost' })
    const itemQuantity = screen.getByRole('textbox', { name: 'Qty' })

    act(() => date.focus())
    await user.tab()
    expect(itemTitle).toHaveFocus()
    await user.tab()
    expect(itemCost).toHaveFocus()
    await user.tab()
    expect(itemQuantity).toHaveFocus()

    const paidForAmount = screen.getByRole('radio', {
      name: /split.*by amount/i,
    })
    await user.click(paidForAmount)
    act(() => paidForAmount.focus())
    await user.tab()
    expect(
      document.querySelectorAll<HTMLButtonElement>('button[aria-pressed]')[0],
    ).toHaveFocus()
    await user.tab()
    expect(
      screen.getByRole('textbox', { name: 'Amount for Alice' }),
    ).toHaveFocus()

    const paidByAmount = screen.getByRole('radio', {
      name: /multiple payers.*by amount/i,
    })
    await user.click(paidByAmount)
    act(() => paidByAmount.focus())
    await user.tab()
    expect(
      Array.from(
        document.querySelectorAll<HTMLButtonElement>('button[aria-pressed]'),
      ).at(-2),
    ).toHaveFocus()
    await user.tab()
    expect(
      screen.getAllByRole('textbox', { name: 'Amount for Alice' }).at(-1),
    ).toHaveFocus()
  })

  it('collapses an empty expense items section until requested', async () => {
    const { user } = render(
      <ExpenseForm
        group={mockGroup as unknown as GroupShape}
        onSubmit={vi.fn()}
        runtimeFeatureFlags={runtimeFeatureFlags}
      />,
    )

    expect(
      screen.getByRole('button', { name: /show items/i }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /add item/i }),
    ).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /show items/i }))
    expect(
      screen.getByRole('button', { name: /hide items/i }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /add item/i }),
    ).toBeInTheDocument()
  })

  it('applies an AI category suggestion when the expense is uncategorized', async () => {
    const { user } = render(
      <ExpenseForm
        group={mockGroup as unknown as GroupShape}
        onSubmit={vi.fn()}
        runtimeFeatureFlags={{
          ...runtimeFeatureFlags,
          enableCategoryExtract: true,
        }}
      />,
    )

    mockCategoryMutateAsync.mockResolvedValueOnce({ categoryId: 'groceries' })
    const title = screen.getByRole('textbox', { name: /expense title/i })
    await user.type(title, 'Whole Foods')
    await user.tab()

    await vi.waitFor(() => {
      expect(mockCategoryMutateAsync).toHaveBeenCalledTimes(1)
    })
    expect(
      screen.getByRole('combobox', { name: 'Groceries' }),
    ).toBeInTheDocument()
  })

  it('does not auto-categorize an expense with an existing category', async () => {
    const { user } = render(
      <ExpenseForm
        group={mockGroup as unknown as GroupShape}
        expense={mockExpense as unknown as LoadedExpense}
        onSubmit={vi.fn()}
        runtimeFeatureFlags={{
          ...runtimeFeatureFlags,
          enableCategoryExtract: true,
        }}
      />,
    )

    const title = screen.getByDisplayValue('Dinner')
    await user.click(title)
    await user.tab()

    expect(mockCategoryMutateAsync).not.toHaveBeenCalled()
  })

  it('ignores an in-flight AI suggestion after a manual category selection', async () => {
    let resolveSuggestion: ((value: { categoryId: string }) => void) | undefined
    mockCategoryMutateAsync.mockReturnValueOnce(
      new Promise<{ categoryId: string }>((resolve) => {
        resolveSuggestion = resolve
      }),
    )
    const { user } = render(
      <ExpenseForm
        group={mockGroup as unknown as GroupShape}
        onSubmit={vi.fn()}
        runtimeFeatureFlags={{
          ...runtimeFeatureFlags,
          enableCategoryExtract: true,
        }}
      />,
    )

    const title = screen.getByRole('textbox', { name: /expense title/i })
    await user.type(title, 'Whole Foods')
    await user.tab()
    await vi.waitFor(() => {
      expect(mockCategoryMutateAsync).toHaveBeenCalledTimes(1)
    })

    const categoryButton = screen.getByRole('combobox', { name: 'General' })
    expect(categoryButton).toHaveAttribute('aria-busy', 'true')
    expect(categoryButton.querySelector('.lucide-sparkles')).toBeInTheDocument()

    await user.click(categoryButton)
    await user.click(screen.getByText('Groceries'))
    resolveSuggestion?.({ categoryId: 'dining-out' })

    await vi.waitFor(() => {
      expect(
        screen.getByRole('combobox', { name: 'Groceries' }),
      ).toBeInTheDocument()
    })
    expect(
      screen.queryByRole('combobox', { name: 'Dining Out' }),
    ).not.toBeInTheDocument()
    expect(mockCategoryReset).toHaveBeenCalled()
  })
  it('cancels the AI categorizer on submit so a late response cannot clobber the saved value', async () => {
    let resolveSuggestion: ((value: { categoryId: string }) => void) | undefined
    mockCategoryMutateAsync.mockReturnValueOnce(
      new Promise<{ categoryId: string }>((resolve) => {
        resolveSuggestion = resolve
      }),
    )
    const onSubmit = vi.fn().mockResolvedValue('saved' as const)
    const { user } = render(
      <ExpenseForm
        group={mockGroup as unknown as GroupShape}
        onSubmit={onSubmit}
        runtimeFeatureFlags={{
          ...runtimeFeatureFlags,
          enableCategoryExtract: true,
        }}
        currentLedgerParticipantId="lp-1"
      />,
    )

    const titleInput = screen.getByPlaceholderText('Monday evening restaurant')
    await user.type(titleInput, 'Whole Foods')
    await user.tab()
    await vi.waitFor(() => {
      expect(mockCategoryMutateAsync).toHaveBeenCalledTimes(1)
    })

    const amountInput = screen.getByRole('textbox', { name: 'Amount' })
    await user.type(amountInput, '42')

    // The user hits save while the AI categorizer is still pending.
    const submitButton = screen
      .getAllByRole('button')
      .find((b) => b.getAttribute('type') === 'submit')
    if (!submitButton) throw new Error('submit button not found')
    await user.click(submitButton)

    await vi.waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1)
    })

    // Capture the submitted values so we can prove the late AI
    // response never wrote back over them.
    const submittedValues = onSubmit.mock.calls[0]?.[0] as {
      category: string
    }

    // Now resolve the AI suggestion. Without cancel-on-submit this
    // would race to overwrite the category before the form unmounts.
    resolveSuggestion?.({ categoryId: 'groceries' })
    await Promise.resolve()

    expect(submittedValues.category).not.toBe('groceries')
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
    let resolveSubmit!: (outcome: 'saved') => void
    const submission = new Promise<'saved'>((resolve) => {
      resolveSubmit = resolve
    })
    const onSubmit = vi.fn((_values: Expense) => submission)
    const { user } = render(
      <ExpenseForm
        group={
          {
            ...mockGroup,
            participants: [
              {
                id: 'lp-1',
                name: 'Alice',
                account: null,
                pending: false,
                unlinked: false,
              },
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

    await act(async () => {
      resolveSubmit('saved')
      await submission
    })
    // A 'saved' outcome is terminal: the expense already exists, so the
    // submit action disables instead of inviting a duplicate save (the
    // test renders without `onSaved`, which is the caller-free variant).
    await vi.waitFor(() => {
      expect(saveButton).toBeDisabled()
    })
  })

  it('submits conversion none when currencies match', async () => {
    const onSubmit = vi.fn().mockResolvedValue('saved' as const)
    const { user } = render(
      <ExpenseForm
        group={
          {
            ...mockGroup,
            participants: [
              {
                id: 'lp-1',
                name: 'Alice',
                account: null,
                pending: false,
                unlinked: false,
              },
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
      via: undefined,
      sources: [],
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

    const currencySelector = screen.getAllByRole('combobox')[1]
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
      via: undefined,
      sources: [],
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

    const currencySelector = screen.getAllByRole('combobox')[1]
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
      via: undefined,
      sources: [],
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

    const currencySelector = screen.getAllByRole('combobox')[1]
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

  it('parses pasted currency text and selects its detected currency', async () => {
    render(
      <ExpenseForm
        group={mockGroup as unknown as GroupShape}
        onSubmit={vi.fn()}
        runtimeFeatureFlags={runtimeFeatureFlags}
      />,
    )
    const input = screen.getByRole('textbox', { name: /^amount$/i })
    const currencySelector = screen.getAllByRole('combobox')[1]

    await act(async () => {
      fireEvent.paste(input, {
        clipboardData: { getData: () => '-€1.659,84' },
      })
    })

    expect(input).toHaveValue('1659.84')
    expect(currencySelector).toHaveTextContent('EUR')
  })

  it('does not render the refresh button when the conversion rate loaded successfully', async () => {
    vi.mocked(useCurrencyRate).mockReturnValue({
      data: 1.1,
      error: null,
      isLoading: false,
      via: undefined,
      sources: [],
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

    const currencySelector = screen.getAllByRole('combobox')[1]
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
      via: undefined,
      sources: [],
      refresh,
    })
    const onSubmit = vi.fn().mockResolvedValue('saved' as const)
    const { user } = render(
      <ExpenseForm
        group={mockGroup as unknown as GroupShape}
        onSubmit={onSubmit}
        runtimeFeatureFlags={runtimeFeatureFlags}
        currentLedgerParticipantId="lp-1"
      />,
    )

    const currencySelector = screen.getAllByRole('combobox')[1]
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
      via: undefined,
      sources: [],
      refresh: vi.fn(),
    })
    const onSubmit = vi.fn().mockResolvedValue('saved' as const)
    const { user } = render(
      <ExpenseForm
        group={
          {
            ...mockGroup,
            participants: [
              {
                id: 'lp-1',
                name: 'Alice',
                account: null,
                pending: false,
                unlinked: false,
              },
            ],
          } as unknown as GroupShape
        }
        onSubmit={onSubmit}
        runtimeFeatureFlags={runtimeFeatureFlags}
        currentLedgerParticipantId="lp-1"
      />,
    )

    await user.type(screen.getByLabelText(/expense title/i), 'Dinner')

    const currencySelector = screen.getAllByRole('combobox')[1]
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
      screen.getByRole('radio', { name: /split.*evenly/i }),
    ).toBeInTheDocument()
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
      // Copy action lives on the preview modal, not inside the form.
      expect(screen.queryByTestId('expense-make-copy')).not.toBeInTheDocument()
      expect(
        screen.getByRole<HTMLButtonElement>('combobox', {
          name: /expense date/i,
        }).textContent,
      ).toContain('Jul 15, 2025')
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps copied recurrence under the expense timezone while account sync is pending', async () => {
    accountPreferenceMocks.preferences = {
      ...accountPreferenceMocks.preferences,
      timeZone: null,
    }
    accountPreferenceMocks.timeZoneCheck = {
      checked: false,
      promptActive: false,
    }
    const recurringExpense = {
      ...mockExpense,
      recurrence: {
        frequency: 'WEEKLY',
        interval: 1,
        end: { type: 'INDEFINITE' },
      },
    }

    render(
      <ExpenseForm
        group={mockGroup as unknown as GroupShape}
        expense={recurringExpense as unknown as LoadedExpense}
        isCopy
        onSubmit={vi.fn()}
        runtimeFeatureFlags={runtimeFeatureFlags}
      />,
    )

    const recurrence = screen.getByRole('checkbox', { name: 'Recurring' })
    await vi.waitFor(() => expect(recurrence).toBeChecked())
    expect(recurrence).not.toHaveAttribute('aria-disabled', 'true')
    expect(
      screen.queryByText(
        'Waiting for your account timezone before recurrence can be enabled.',
      ),
    ).not.toBeInTheDocument()
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
    const onSubmit = vi.fn().mockResolvedValue('saved' as const)
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

  it('recurrence checkbox renders', () => {
    const onSubmit = vi.fn()
    render(
      <ExpenseForm
        group={mockGroup as unknown as GroupShape}
        onSubmit={onSubmit}
        runtimeFeatureFlags={runtimeFeatureFlags}
      />,
    )

    expect(
      screen.getByRole('checkbox', { name: 'Recurring' }),
    ).toBeInTheDocument()
  })

  it('expands recurrence settings and opens the schedule drawer', async () => {
    const { user } = render(
      <ExpenseForm
        group={mockGroup as unknown as GroupShape}
        onSubmit={vi.fn()}
        runtimeFeatureFlags={runtimeFeatureFlags}
      />,
    )

    await user.click(screen.getByRole('checkbox', { name: 'Recurring' }))
    expect(screen.getByText('Repeat every')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'View all' }))
    expect(screen.getByText('Recurrence schedule')).toBeInTheDocument()
    const projectedSchedule = screen.getByRole('list', {
      name: 'Recurrence schedule',
    })
    const currentProjectedOccurrence = projectedSchedule.querySelector(
      '[aria-current="date"]',
    )
    expect(currentProjectedOccurrence).toHaveClass('top-0')
    expect(currentProjectedOccurrence).toHaveStyle({
      transform: 'translateY(0px)',
    })
    // The indefinite schedule drawer should include concrete dates, not only
    // the no-end summary (the inline preview contributes four list items).
    expect(screen.getAllByRole('listitem').length).toBeGreaterThan(4)
    expect(
      screen.getAllByText('This recurrence has no end date.').length,
    ).toBeGreaterThanOrEqual(1)
  })

  it('allows recurrence numbers to be replaced and restores empty drafts on blur', async () => {
    const { user } = render(
      <ExpenseForm
        group={mockGroup as unknown as GroupShape}
        onSubmit={vi.fn()}
        runtimeFeatureFlags={runtimeFeatureFlags}
      />,
    )

    await user.click(screen.getByRole('checkbox', { name: 'Recurring' }))

    const interval = screen.getByRole('spinbutton', {
      name: 'Repeat interval',
    })
    await user.clear(interval)
    expect(interval).toHaveValue(null)
    await user.type(interval, '5')
    expect(interval).toHaveValue(5)
    await user.clear(interval)
    await user.tab()
    expect(interval).toHaveValue(5)

    await user.click(screen.getByRole('combobox', { name: 'Ends' }))
    await user.click(
      screen.getByRole('option', { name: 'After a number of occurrences' }),
    )

    const count = screen.getByRole('spinbutton', {
      name: 'Total occurrences (including this expense)',
    })
    await user.clear(count)
    expect(count).toHaveValue(null)
    await user.type(count, '5')
    expect(count).toHaveValue(5)
    await user.clear(count)
    await user.tab()
    expect(count).toHaveValue(5)
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

    // Now the multi-payer breakdown should appear with participant toggles.
    // The "Paid by" header should also now have the "Select all"
    // / "Select none" button rendered alongside the title.
    expect(evenlyRadio).toBeChecked()
    expect(screen.getByText('Select all')).toBeInTheDocument()

    const participantToggles = document.querySelectorAll(
      '[data-id] button[aria-pressed]',
    )
    expect(participantToggles.length).toBeGreaterThanOrEqual(2)
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
      via: undefined,
      sources: [],
      refresh: vi.fn(),
    })
    const onSubmit = vi.fn().mockResolvedValue('saved' as const)
    const { user } = render(
      <ExpenseForm
        group={mockGroup as unknown as GroupShape}
        onSubmit={onSubmit}
        runtimeFeatureFlags={runtimeFeatureFlags}
        currentLedgerParticipantId="lp-1"
      />,
    )

    await user.type(screen.getByLabelText(/expense title/i), 'Dinner')

    const currencySelector = screen.getAllByRole('combobox')[1]
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
        onSubmit={vi.fn().mockResolvedValue('saved' as const)}
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
        {
          id: 'lp-3',
          name: 'Carol',
          account: null,
          pending: false,
          unlinked: false,
        },
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

  it('BY_SHARES: shows "Total weight: <sum> shares" in muted color with the displayed value', () => {
    // Stored fixed units (100 = 1 displayed share). 100 + 200 → 1 + 2
    // displayed; the footer must never expose the fixed-unit form.
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
  it('BY_AMOUNT: shows "Missing X of Y" in red when shares under-sum', async () => {
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

    const footer = await screen.findByTestId('paid-for-distribution-footer')
    expect(footer).toHaveTextContent('Missing $10.00 of $100.00')
    expect(footer.className).toContain('text-red-600')
  })

  it('BY_AMOUNT: shows "✓ Matches" in green when shares sum to the target', async () => {
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

    const footer = await screen.findByTestId('paid-for-distribution-footer')
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
      name: /split.*by amount/i,
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
  it('keeps participant names visible with compact share controls', () => {
    render(
      <ExpenseForm
        group={mockGroup as unknown as GroupShape}
        expense={
          {
            ...mockExpense,
            splitMode: 'BY_SHARES' as const,
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

    const aliceRow = document.querySelector<HTMLElement>(
      '[data-id="lp-1/BY_SHARES/USD"]',
    )
    expect(aliceRow).toBeTruthy()
    expect(aliceRow).toHaveClass('w-[calc(100%+3rem)]')
    expect(aliceRow).toHaveTextContent('Alice')
    expect(aliceRow?.querySelector('input')).toBeTruthy()
    expect(aliceRow).not.toHaveTextContent('#')
    expect(aliceRow?.querySelector('button[aria-pressed]')).toBeTruthy()
  })

  it('clicking a participant row (name text) toggles the selection', async () => {
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

    const toggles = () =>
      Array.from(
        document.querySelectorAll<HTMLButtonElement>(
          '[data-id] button[aria-pressed]',
        ),
      )
    const initiallyChecked = toggles().filter(
      (toggle) => toggle.getAttribute('aria-pressed') === 'true',
    )
    expect(initiallyChecked.length).toBeGreaterThanOrEqual(2)

    // Click directly on the row div (non-interactive padding area)
    const row = document.querySelector<HTMLElement>(
      '[data-id="lp-1/BY_AMOUNT/USD"]',
    )
    expect(row).toBeTruthy()
    await user.click(row!)

    // After clicking Alice's row, she should be toggled off
    const checkedAfter = toggles().filter(
      (toggle) => toggle.getAttribute('aria-pressed') === 'true',
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
      ?.querySelector('button[aria-pressed]')
      ?.getAttribute('aria-pressed')

    // Click on the input to focus it (should NOT toggle checkbox)
    await user.click(rowInput!)

    // Verify the input has focus
    expect(document.activeElement).toBe(rowInput)

    // Verify selection state has NOT changed
    const checkboxAfter = rowInput!
      .closest('[data-id]')
      ?.querySelector('button[aria-pressed]')
      ?.getAttribute('aria-pressed')
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

// ── BY_SHARES decimal entry and edit/resubmit ────────────────────────────

describe('ExpenseForm BY_SHARES decimal entry', () => {
  it('keeps intermediate decimal states while typing 0.5 in flat paid-for and submits 50', async () => {
    const onSubmit = vi.fn().mockResolvedValue('saved' as const)
    const { user } = render(
      <ExpenseForm
        group={mockGroup as unknown as GroupShape}
        onSubmit={onSubmit}
        runtimeFeatureFlags={runtimeFeatureFlags}
        currentLedgerParticipantId="lp-1"
      />,
    )

    await user.type(
      screen.getByPlaceholderText('Monday evening restaurant'),
      'Lunch',
    )
    await user.type(screen.getByRole('textbox', { name: 'Amount' }), '10')
    await user.click(screen.getByRole('radio', { name: /split: by shares/i }))

    // Character-by-character typing must keep "0", "0." and "0.5" visible:
    // every non-empty value keeps the row, so the first digit never makes
    // the input vanish. Clearing and re-typing replaces the input element
    // (plain unregistered input ⇄ registered input), so re-query it.
    const aliceInput = () =>
      screen.getByRole('textbox', { name: 'Shares for Alice' })
    await user.clear(aliceInput())
    await user.type(aliceInput(), '0')
    expect(aliceInput()).toHaveValue('0')
    await user.type(aliceInput(), '.')
    expect(aliceInput()).toHaveValue('0.')
    await user.type(aliceInput(), '5')
    expect(aliceInput()).toHaveValue('0.5')

    await user.click(screen.getByRole('button', { name: /create/i }))
    await vi.waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1)
    })
    // The removed-and-typed row is re-appended, so compare order-independently.
    const paidFor = [...onSubmit.mock.calls[0][0].paidFor].sort(
      (a: { participant: string }, b: { participant: string }) =>
        a.participant.localeCompare(b.participant),
    )
    expect(paidFor).toEqual([
      { participant: 'lp-1', shares: 50 },
      { participant: 'lp-2', shares: 100 },
    ])
  })

  it('removes the participant row when the share input is explicitly cleared', async () => {
    const onSubmit = vi.fn().mockResolvedValue('saved' as const)
    const { user } = render(
      <ExpenseForm
        group={mockGroup as unknown as GroupShape}
        onSubmit={onSubmit}
        runtimeFeatureFlags={runtimeFeatureFlags}
        currentLedgerParticipantId="lp-1"
      />,
    )

    await user.type(
      screen.getByPlaceholderText('Monday evening restaurant'),
      'Lunch',
    )
    await user.type(screen.getByRole('textbox', { name: 'Amount' }), '10')
    await user.click(screen.getByRole('radio', { name: /split: by shares/i }))

    const aliceInput = screen.getByRole('textbox', {
      name: 'Shares for Alice',
    })
    await user.clear(aliceInput)
    // Clearing removes the row: the input is replaced by the plain
    // unregistered variant, so re-query it.
    expect(
      screen.getByRole('textbox', { name: 'Shares for Alice' }),
    ).toHaveValue('')

    await user.click(screen.getByRole('button', { name: /create/i }))
    await vi.waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1)
    })
    const paidFor = [...onSubmit.mock.calls[0][0].paidFor].sort(
      (a: { participant: string }, b: { participant: string }) =>
        a.participant.localeCompare(b.participant),
    )
    expect(paidFor).toEqual([{ participant: 'lp-2', shares: 100 }])
  })

  it('canonicalizes repeated leading zeros while typing', async () => {
    const onSubmit = vi.fn().mockResolvedValue('saved' as const)
    const { user } = render(
      <ExpenseForm
        group={mockGroup as unknown as GroupShape}
        onSubmit={onSubmit}
        runtimeFeatureFlags={runtimeFeatureFlags}
        currentLedgerParticipantId="lp-1"
      />,
    )

    await user.type(
      screen.getByPlaceholderText('Monday evening restaurant'),
      'Lunch',
    )
    await user.type(screen.getByRole('textbox', { name: 'Amount' }), '10')
    await user.click(screen.getByRole('radio', { name: /split: by shares/i }))

    // Clearing and re-typing replaces the input element (plain unregistered
    // input ⇄ registered input), so re-query it.
    const aliceInput = () =>
      screen.getByRole('textbox', { name: 'Shares for Alice' })
    await user.clear(aliceInput())
    // Repeated zero keystrokes keep displaying a single "0"...
    await user.type(aliceInput(), '0')
    expect(aliceInput()).toHaveValue('0')
    await user.type(aliceInput(), '0')
    expect(aliceInput()).toHaveValue('0')
    await user.type(aliceInput(), '0')
    expect(aliceInput()).toHaveValue('0')
    // ...and a non-zero digit immediately canonicalizes "0004" -> "4".
    await user.type(aliceInput(), '4')
    expect(aliceInput()).toHaveValue('4')
  })

  it('keeps "1." while typing .1 after a starting share of 1 and submits 110', async () => {
    const onSubmit = vi.fn().mockResolvedValue('saved' as const)
    const { user } = render(
      <ExpenseForm
        group={mockGroup as unknown as GroupShape}
        onSubmit={onSubmit}
        runtimeFeatureFlags={runtimeFeatureFlags}
        currentLedgerParticipantId="lp-1"
      />,
    )

    await user.type(
      screen.getByPlaceholderText('Monday evening restaurant'),
      'Lunch',
    )
    await user.type(screen.getByRole('textbox', { name: 'Amount' }), '10')
    await user.click(screen.getByRole('radio', { name: /split: by shares/i }))

    const aliceInput = screen.getByRole('textbox', {
      name: 'Shares for Alice',
    })
    // Focus selects the starting value, so typing replaces it: '1' keeps
    // the value, the '.' intermediate "1." state survives, and '1' finishes.
    await user.type(aliceInput, '1')
    await user.type(aliceInput, '.')
    expect(aliceInput).toHaveValue('1.')
    await user.type(aliceInput, '1')
    expect(aliceInput).toHaveValue('1.1')

    await user.click(screen.getByRole('button', { name: /create/i }))
    await vi.waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1)
    })
    const paidFor = [...onSubmit.mock.calls[0][0].paidFor].sort(
      (a: { participant: string }, b: { participant: string }) =>
        a.participant.localeCompare(b.participant),
    )
    expect(paidFor).toEqual([
      { participant: 'lp-1', shares: 110 },
      { participant: 'lp-2', shares: 100 },
    ])
  })

  it('steps fractional shares by 0.1 and removes the row at zero', async () => {
    const { user } = render(
      <ExpenseForm
        group={mockGroup as unknown as GroupShape}
        onSubmit={vi.fn()}
        runtimeFeatureFlags={runtimeFeatureFlags}
        currentLedgerParticipantId="lp-1"
      />,
    )

    await user.type(
      screen.getByPlaceholderText('Monday evening restaurant'),
      'Lunch',
    )
    await user.type(screen.getByRole('textbox', { name: 'Amount' }), '10')
    await user.click(screen.getByRole('radio', { name: /split: by shares/i }))

    // Clearing and re-typing replaces the input element (plain unregistered
    // input ⇄ registered input), so re-query it each time.
    const aliceInput = () =>
      screen.getByRole('textbox', { name: 'Shares for Alice' })
    await user.clear(aliceInput())
    await user.type(aliceInput(), '0.5')
    // 0.5 + -> 0.6 (fractional values step by 0.1)
    await user.click(
      screen.getByRole('button', { name: 'Increase shares for Alice' }),
    )
    expect(aliceInput()).toHaveValue('0.6')
    // 0.6 - -> 0.5
    await user.click(
      screen.getByRole('button', { name: 'Decrease shares for Alice' }),
    )
    expect(aliceInput()).toHaveValue('0.5')
    // 0.9 + -> 1, then whole values step by 1 (1 + -> 2)
    await user.clear(aliceInput())
    await user.type(aliceInput(), '0.9')
    await user.click(
      screen.getByRole('button', { name: 'Increase shares for Alice' }),
    )
    expect(aliceInput()).toHaveValue('1')
    await user.click(
      screen.getByRole('button', { name: 'Increase shares for Alice' }),
    )
    expect(aliceInput()).toHaveValue('2')
    // 1.5 + -> 1.6 (fractional values above 1 still step by 0.1)
    await user.clear(aliceInput())
    await user.type(aliceInput(), '1.5')
    await user.click(
      screen.getByRole('button', { name: 'Increase shares for Alice' }),
    )
    expect(aliceInput()).toHaveValue('1.6')
    // 1.6 - -> 1.5 (fractional decrease also steps by 0.1)
    await user.click(
      screen.getByRole('button', { name: 'Decrease shares for Alice' }),
    )
    expect(aliceInput()).toHaveValue('1.5')
    // 0.1 - removes the row
    await user.clear(aliceInput())
    await user.type(aliceInput(), '0.1')
    await user.click(
      screen.getByRole('button', { name: 'Decrease shares for Alice' }),
    )
    expect(aliceInput()).toHaveValue('')
  })

  it('keeps intermediate decimal states while typing 1.5 in multi-payer paid-by and submits 150', async () => {
    const onSubmit = vi.fn().mockResolvedValue('saved' as const)
    const { user } = render(
      <ExpenseForm
        group={mockGroup as unknown as GroupShape}
        onSubmit={onSubmit}
        runtimeFeatureFlags={runtimeFeatureFlags}
        currentLedgerParticipantId="lp-1"
      />,
    )

    await user.type(
      screen.getByPlaceholderText('Monday evening restaurant'),
      'Lunch',
    )
    await user.type(screen.getByRole('textbox', { name: 'Amount' }), '10')
    await user.click(
      screen.getByRole('radio', { name: /multiple payers.*by shares/i }),
    )
    // Multi-payer starts with the current payer only; add Bob via Select all.
    await user.click(screen.getByRole('button', { name: /select all/i }))

    const aliceInput = screen.getByRole('textbox', {
      name: 'Shares for Alice',
    })
    await user.clear(aliceInput)
    await user.type(aliceInput, '1.5')
    // Clearing replaces the input element; re-query before asserting.
    expect(
      screen.getByRole('textbox', { name: 'Shares for Alice' }),
    ).toHaveValue('1.5')

    await user.click(screen.getByRole('button', { name: /create/i }))
    await vi.waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1)
    })
    const paidByList = [...onSubmit.mock.calls[0][0].paidByList].sort(
      (a: { participant: string }, b: { participant: string }) =>
        a.participant.localeCompare(b.participant),
    )
    expect(paidByList).toEqual([
      { participant: 'lp-1', shares: 150 },
      { participant: 'lp-2', shares: 100 },
    ])
  })

  it('edit mode hydrates stored 110 to 1.1 and resubmits 110 (scale-once round trip)', async () => {
    const onSubmit = vi.fn().mockResolvedValue('saved' as const)
    const { user } = render(
      <ExpenseForm
        group={mockGroup as unknown as GroupShape}
        expense={
          {
            ...mockExpense,
            splitMode: 'BY_SHARES',
            paidFor: [
              { ledgerParticipantId: 'lp-1', shares: 110 },
              { ledgerParticipantId: 'lp-2', shares: 50 },
            ],
          } as unknown as LoadedExpense
        }
        onSubmit={onSubmit}
        runtimeFeatureFlags={runtimeFeatureFlags}
        currentLedgerParticipantId="lp-1"
      />,
    )

    // Stored fixed units hydrate to display units.
    const alice = screen.getByRole('textbox', { name: 'Shares for Alice' })
    expect(alice).toHaveValue('1.1')
    expect(screen.getByRole('textbox', { name: 'Shares for Bob' })).toHaveValue(
      '0.5',
    )

    // The user edits one value; serialization must go back to fixed units.
    await user.clear(alice)
    await user.type(alice, '1.1')

    const submitButton = screen
      .getAllByRole('button', { name: /^save$/i })
      .find((b) => (b as HTMLButtonElement).type === 'submit')
    if (!submitButton) throw new Error('submit button not found')
    await user.click(submitButton)
    await vi.waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1)
    })
    const paidFor = [...onSubmit.mock.calls[0][0].paidFor].sort(
      (a: { participant: string }, b: { participant: string }) =>
        a.participant.localeCompare(b.participant),
    )
    expect(paidFor).toEqual([
      { participant: 'lp-1', shares: 110 },
      { participant: 'lp-2', shares: 50 },
    ])
  })

  it('resets custom shares and deselection in flat paid-for to all ones', async () => {
    const { user } = render(
      <ExpenseForm
        group={mockGroup as unknown as GroupShape}
        onSubmit={vi.fn()}
        runtimeFeatureFlags={runtimeFeatureFlags}
        currentLedgerParticipantId="lp-1"
      />,
    )

    await user.type(
      screen.getByPlaceholderText('Monday evening restaurant'),
      'Lunch',
    )
    await user.type(screen.getByRole('textbox', { name: 'Amount' }), '10')
    await user.click(screen.getByRole('radio', { name: /split: by shares/i }))

    const aliceInput = screen.getByRole('textbox', {
      name: 'Shares for Alice',
    })
    await user.clear(aliceInput)
    await user.type(aliceInput, '0.5')
    // Deselect Bob, then Reset: all participants back to 1.
    const bobToggle = document.querySelector<HTMLButtonElement>(
      '[data-id="lp-2/BY_SHARES/USD"] button[aria-pressed]',
    )
    if (!bobToggle) throw new Error('Bob row toggle not found')
    await user.click(bobToggle)
    await user.click(screen.getByRole('button', { name: /reset/i }))

    expect(aliceInput).toHaveValue('1')
    expect(screen.getByRole('textbox', { name: 'Shares for Bob' })).toHaveValue(
      '1',
    )
  })

  it('select all adds missing participants without overwriting edited values', async () => {
    const { user } = render(
      <ExpenseForm
        group={mockGroup as unknown as GroupShape}
        onSubmit={vi.fn()}
        runtimeFeatureFlags={runtimeFeatureFlags}
        currentLedgerParticipantId="lp-1"
      />,
    )

    await user.type(
      screen.getByPlaceholderText('Monday evening restaurant'),
      'Lunch',
    )
    await user.type(screen.getByRole('textbox', { name: 'Amount' }), '10')
    await user.click(screen.getByRole('radio', { name: /split: by shares/i }))

    const aliceInput = screen.getByRole('textbox', {
      name: 'Shares for Alice',
    })
    await user.clear(aliceInput)
    await user.type(aliceInput, '0.5')
    // Deselect Bob, then Select all: Alice keeps 0.5, Bob is restored at 1.
    const bobToggle = document.querySelector<HTMLButtonElement>(
      '[data-id="lp-2/BY_SHARES/USD"] button[aria-pressed]',
    )
    if (!bobToggle) throw new Error('Bob row toggle not found')
    await user.click(bobToggle)
    await user.click(screen.getByRole('button', { name: /select all/i }))

    // Clearing replaces the input element; re-query before asserting.
    expect(
      screen.getByRole('textbox', { name: 'Shares for Alice' }),
    ).toHaveValue('0.5')
    expect(screen.getByRole('textbox', { name: 'Shares for Bob' })).toHaveValue(
      '1',
    )
  })

  it('reset percentage distribution totals exactly 100', async () => {
    const { user } = render(
      <ExpenseForm
        group={mockGroup as unknown as GroupShape}
        onSubmit={vi.fn()}
        runtimeFeatureFlags={runtimeFeatureFlags}
        currentLedgerParticipantId="lp-1"
      />,
    )

    await user.type(
      screen.getByPlaceholderText('Monday evening restaurant'),
      'Lunch',
    )
    await user.type(screen.getByRole('textbox', { name: 'Amount' }), '10')
    await user.click(
      screen.getByRole('radio', { name: /split: by percentage/i }),
    )

    const aliceInput = screen.getByRole('textbox', {
      name: 'Percentage for Alice',
    })
    await user.clear(aliceInput)
    await user.type(aliceInput, '10')
    await user.click(screen.getByRole('button', { name: /reset/i }))

    // Two participants -> equal 50 / 50, exactly 100 in total.
    expect(aliceInput).toHaveValue('50')
    expect(
      screen.getByRole('textbox', { name: 'Percentage for Bob' }),
    ).toHaveValue('50')
  })

  it('reset amount distribution totals exactly the target amount', async () => {
    const groupWith3 = {
      ...mockGroup,
      participants: [
        ...mockGroup.participants,
        {
          id: 'lp-3',
          name: 'Carol',
          account: null,
          pending: false,
          unlinked: false,
        },
      ],
    }
    const { user } = render(
      <ExpenseForm
        group={groupWith3 as unknown as GroupShape}
        onSubmit={vi.fn()}
        runtimeFeatureFlags={runtimeFeatureFlags}
        currentLedgerParticipantId="lp-1"
      />,
    )

    await user.type(
      screen.getByPlaceholderText('Monday evening restaurant'),
      'Lunch',
    )
    await user.type(screen.getByRole('textbox', { name: 'Amount' }), '10')
    await user.click(
      screen.getByRole('radio', { name: /multiple payers.*by amount/i }),
    )

    const paidByCard = screen
      .getByTestId('paid-by-distribution-footer')
      .closest('div.motion-surface')
    if (!paidByCard) throw new Error('paid-by card not found')
    await user.click(
      within(paidByCard as HTMLElement).getByRole('button', {
        name: /reset/i,
      }),
    )

    // Three payers -> 3.33 / 3.33 / 3.34, exactly the 10 expense amount:
    // the balancing effect must not flatten the residual cent to 3.33 x 3.
    const aliceInput = within(paidByCard as HTMLElement).getByRole('textbox', {
      name: 'Amount for Alice',
    })
    expect(aliceInput).toHaveValue('3.33')
    expect(
      within(paidByCard as HTMLElement).getByRole('textbox', {
        name: 'Amount for Bob',
      }),
    ).toHaveValue('3.33')
    expect(
      within(paidByCard as HTMLElement).getByRole('textbox', {
        name: 'Amount for Carol',
      }),
    ).toHaveValue('3.34')
    expect(
      screen.getByTestId('paid-by-distribution-footer'),
    ).not.toHaveTextContent(/missing/i)

    // Reset did not make the rows manual: changing the amount rebalances
    // them automatically to an exact 11.00 total (3.66 / 3.67 / 3.67).
    await user.clear(screen.getByRole('textbox', { name: 'Amount' }))
    await user.type(screen.getByRole('textbox', { name: 'Amount' }), '11')
    expect(aliceInput).toHaveValue('3.66')
    expect(
      within(paidByCard as HTMLElement).getByRole('textbox', {
        name: 'Amount for Bob',
      }),
    ).toHaveValue('3.67')
    expect(
      within(paidByCard as HTMLElement).getByRole('textbox', {
        name: 'Amount for Carol',
      }),
    ).toHaveValue('3.67')
    expect(
      screen.getByTestId('paid-by-distribution-footer'),
    ).not.toHaveTextContent(/missing/i)
  })

  it('reset amount distribution in flat paid-for totals exactly the target amount', async () => {
    const groupWith3 = {
      ...mockGroup,
      participants: [
        ...mockGroup.participants,
        {
          id: 'lp-3',
          name: 'Carol',
          account: null,
          pending: false,
          unlinked: false,
        },
      ],
    }
    const { user } = render(
      <ExpenseForm
        group={groupWith3 as unknown as GroupShape}
        onSubmit={vi.fn()}
        runtimeFeatureFlags={runtimeFeatureFlags}
        currentLedgerParticipantId="lp-1"
      />,
    )

    await user.type(
      screen.getByPlaceholderText('Monday evening restaurant'),
      'Lunch',
    )
    await user.type(screen.getByRole('textbox', { name: 'Amount' }), '10')
    await user.click(screen.getByRole('radio', { name: /split.*by amount/i }))
    await user.click(screen.getByRole('button', { name: /reset/i }))

    // Three participants -> 3.33 / 3.33 / 3.34 = exactly 10.00 after the
    // balancing effect settles (it must preserve the residual cent).
    const aliceInput = screen.getByRole('textbox', {
      name: 'Amount for Alice',
    })
    expect(aliceInput).toHaveValue('3.33')
    expect(screen.getByRole('textbox', { name: 'Amount for Bob' })).toHaveValue(
      '3.33',
    )
    expect(
      screen.getByRole('textbox', { name: 'Amount for Carol' }),
    ).toHaveValue('3.34')
    expect(
      screen.getByTestId('paid-for-distribution-footer'),
    ).not.toHaveTextContent(/missing/i)

    // Amount change rebalances the automatic rows to an exact 11.00 total,
    // proving Reset did not mark them as manually edited.
    await user.clear(screen.getByRole('textbox', { name: 'Amount' }))
    await user.type(screen.getByRole('textbox', { name: 'Amount' }), '11')
    expect(aliceInput).toHaveValue('3.66')
    expect(screen.getByRole('textbox', { name: 'Amount for Bob' })).toHaveValue(
      '3.67',
    )
    expect(
      screen.getByRole('textbox', { name: 'Amount for Carol' }),
    ).toHaveValue('3.67')
    expect(
      screen.getByTestId('paid-for-distribution-footer'),
    ).not.toHaveTextContent(/missing/i)
  })

  it('steps fractional shares in multi-payer paid-by by 0.1', async () => {
    const { user } = render(
      <ExpenseForm
        group={mockGroup as unknown as GroupShape}
        onSubmit={vi.fn()}
        runtimeFeatureFlags={runtimeFeatureFlags}
        currentLedgerParticipantId="lp-1"
      />,
    )

    await user.type(
      screen.getByPlaceholderText('Monday evening restaurant'),
      'Lunch',
    )
    await user.type(screen.getByRole('textbox', { name: 'Amount' }), '10')
    await user.click(
      screen.getByRole('radio', { name: /multiple payers.*by shares/i }),
    )
    // Multi-payer starts with the current payer only; add Bob via Select all.
    await user.click(screen.getByRole('button', { name: /select all/i }))

    const aliceInput = screen.getByRole('textbox', {
      name: 'Shares for Alice',
    })
    await user.clear(aliceInput)
    await user.type(aliceInput, '1.5')
    await user.click(
      screen.getByRole('button', { name: 'Increase shares for Alice' }),
    )
    // Clearing replaces the input element; re-query before asserting.
    expect(
      screen.getByRole('textbox', { name: 'Shares for Alice' }),
    ).toHaveValue('1.6')
  })

  it('selects the full paid-for share value on focus so typing replaces it', async () => {
    const { user } = render(
      <ExpenseForm
        group={mockGroup as unknown as GroupShape}
        onSubmit={vi.fn()}
        runtimeFeatureFlags={runtimeFeatureFlags}
        currentLedgerParticipantId="lp-1"
      />,
    )

    await user.type(
      screen.getByPlaceholderText('Monday evening restaurant'),
      'Lunch',
    )
    await user.type(screen.getByRole('textbox', { name: 'Amount' }), '10')
    await user.click(screen.getByRole('radio', { name: /split: by shares/i }))

    const aliceInput = screen.getByRole('textbox', {
      name: 'Shares for Alice',
    }) as HTMLInputElement
    expect(aliceInput).toHaveValue('1')
    fireEvent.focus(aliceInput)
    expect(aliceInput.selectionStart).toBe(0)
    expect(aliceInput.selectionEnd).toBe(1)
    await user.type(aliceInput, '5')
    expect(aliceInput).toHaveValue('5')
  })

  it('selects the full paid-for amount value on focus so typing replaces it', async () => {
    const { user } = render(
      <ExpenseForm
        group={mockGroup as unknown as GroupShape}
        onSubmit={vi.fn()}
        runtimeFeatureFlags={runtimeFeatureFlags}
        currentLedgerParticipantId="lp-1"
      />,
    )

    await user.type(
      screen.getByPlaceholderText('Monday evening restaurant'),
      'Lunch',
    )
    await user.type(screen.getByRole('textbox', { name: 'Amount' }), '10')
    await user.click(screen.getByRole('radio', { name: /split.*by amount/i }))
    await user.click(screen.getByRole('button', { name: /reset/i }))

    const aliceInput = screen.getByRole('textbox', {
      name: 'Amount for Alice',
    }) as HTMLInputElement
    expect(aliceInput).toHaveValue('5')
    await user.click(aliceInput)
    expect(aliceInput.selectionStart).toBe(0)
    expect(aliceInput.selectionEnd).toBe(1)
    await user.keyboard('7')
    expect(aliceInput).toHaveValue('7')
    expect(screen.getByRole('textbox', { name: 'Amount for Bob' })).toHaveValue(
      '3',
    )
  })

  it('selects the full paid-by amount value on focus so typing replaces it', async () => {
    const { user } = render(
      <ExpenseForm
        group={mockGroup as unknown as GroupShape}
        onSubmit={vi.fn()}
        runtimeFeatureFlags={runtimeFeatureFlags}
        currentLedgerParticipantId="lp-1"
      />,
    )

    await user.type(
      screen.getByPlaceholderText('Monday evening restaurant'),
      'Lunch',
    )
    await user.type(screen.getByRole('textbox', { name: 'Amount' }), '10')
    await user.click(
      screen.getByRole('radio', { name: /multiple payers.*by amount/i }),
    )

    const paidByCard = screen
      .getByTestId('paid-by-distribution-footer')
      .closest('div.motion-surface')
    if (!paidByCard) throw new Error('paid-by card not found')
    await user.click(
      within(paidByCard as HTMLElement).getByRole('button', {
        name: /reset/i,
      }),
    )

    const aliceInput = within(paidByCard as HTMLElement).getByRole('textbox', {
      name: 'Amount for Alice',
    }) as HTMLInputElement
    expect(aliceInput).toHaveValue('5')
    fireEvent.focus(aliceInput)
    expect(aliceInput.selectionStart).toBe(0)
    expect(aliceInput.selectionEnd).toBe(1)
    await user.type(aliceInput, '7')
    expect(aliceInput).toHaveValue('7')
  })

  it('removes paid-for automatic rows when a manual row consumes the full amount', async () => {
    const { user } = render(
      <ExpenseForm
        group={mockGroup as unknown as GroupShape}
        onSubmit={vi.fn()}
        runtimeFeatureFlags={runtimeFeatureFlags}
        currentLedgerParticipantId="lp-1"
      />,
    )

    await user.type(
      screen.getByPlaceholderText('Monday evening restaurant'),
      'Lunch',
    )
    await user.type(screen.getByRole('textbox', { name: 'Amount' }), '10')
    await user.click(screen.getByRole('radio', { name: /split.*by amount/i }))
    await user.click(screen.getByRole('button', { name: /reset/i }))

    const aliceInput = screen.getByRole('textbox', {
      name: 'Amount for Alice',
    })
    await user.click(aliceInput)
    await user.keyboard('10')

    const paidForCard = screen
      .getByTestId('paid-for-distribution-footer')
      .closest('div.motion-surface')
    if (!paidForCard) throw new Error('paid-for card not found')
    expect(aliceInput).toHaveValue('10')
    expect(
      within(paidForCard as HTMLElement).getByRole('textbox', {
        name: 'Amount for Bob',
      }),
    ).toHaveValue('')
    expect(
      within(paidForCard as HTMLElement).getByRole('button', { name: /Bob/ }),
    ).toHaveAttribute('aria-pressed', 'false')
    expect(
      screen.getByTestId('paid-for-distribution-footer'),
    ).not.toHaveTextContent(/missing/i)
  })

  it('removes paid-by automatic rows when a manual row consumes the full amount', async () => {
    const { user } = render(
      <ExpenseForm
        group={mockGroup as unknown as GroupShape}
        onSubmit={vi.fn()}
        runtimeFeatureFlags={runtimeFeatureFlags}
        currentLedgerParticipantId="lp-1"
      />,
    )

    await user.type(
      screen.getByPlaceholderText('Monday evening restaurant'),
      'Lunch',
    )
    await user.type(screen.getByRole('textbox', { name: 'Amount' }), '10')
    await user.click(
      screen.getByRole('radio', { name: /multiple payers.*by amount/i }),
    )

    const paidByCard = screen
      .getByTestId('paid-by-distribution-footer')
      .closest('div.motion-surface')
    if (!paidByCard) throw new Error('paid-by card not found')
    await user.click(
      within(paidByCard as HTMLElement).getByRole('button', {
        name: /reset/i,
      }),
    )

    const aliceInput = within(paidByCard as HTMLElement).getByRole('textbox', {
      name: 'Amount for Alice',
    })
    await user.click(aliceInput)
    await user.keyboard('10')

    expect(aliceInput).toHaveValue('10')
    expect(
      within(paidByCard as HTMLElement).getByRole('textbox', {
        name: 'Amount for Bob',
      }),
    ).toHaveValue('')
    expect(
      within(paidByCard as HTMLElement).getByRole('button', { name: /Bob/ }),
    ).toHaveAttribute('aria-pressed', 'false')
    expect(
      screen.getByTestId('paid-by-distribution-footer'),
    ).not.toHaveTextContent(/missing/i)
  })

  it('omits zero-allocated automatic rows when the amount shrinks', async () => {
    const { user } = render(
      <ExpenseForm
        group={mockGroup as unknown as GroupShape}
        onSubmit={vi.fn()}
        runtimeFeatureFlags={runtimeFeatureFlags}
        currentLedgerParticipantId="lp-1"
      />,
    )

    await user.type(
      screen.getByPlaceholderText('Monday evening restaurant'),
      'Lunch',
    )
    await user.type(screen.getByRole('textbox', { name: 'Amount' }), '0.02')
    await user.click(screen.getByRole('radio', { name: /split.*by amount/i }))
    await user.click(screen.getByRole('button', { name: /reset/i }))

    // 0.02 across two automatic participants -> 0.01 / 0.01.
    expect(
      screen.getByRole('textbox', { name: 'Amount for Alice' }),
    ).toHaveValue('0.01')
    expect(screen.getByRole('textbox', { name: 'Amount for Bob' })).toHaveValue(
      '0.01',
    )
    expect(
      screen.getByTestId('paid-for-distribution-footer'),
    ).not.toHaveTextContent(/missing/i)

    // Shrinking to 0.01 leaves a single cent, which the helper assigns to
    // the last participant: Bob keeps 0.01, Alice's omitted automatic row is
    // dropped (unselected) — not kept at zero. Selection is row presence, so
    // the checkbox is the source of truth.
    await user.clear(screen.getByRole('textbox', { name: 'Amount' }))
    await user.type(screen.getByRole('textbox', { name: 'Amount' }), '0.01')
    const aliceToggle = document.querySelector<HTMLButtonElement>(
      '[data-id="lp-1/BY_AMOUNT/USD"] button[aria-pressed]',
    )
    const bobToggle = document.querySelector<HTMLButtonElement>(
      '[data-id="lp-2/BY_AMOUNT/USD"] button[aria-pressed]',
    )
    expect(aliceToggle?.getAttribute('aria-pressed')).toBe('false')
    expect(bobToggle?.getAttribute('aria-pressed')).toBe('true')
    expect(
      screen.getByRole('textbox', { name: 'Amount for Alice' }),
    ).toHaveValue('')
    expect(screen.getByRole('textbox', { name: 'Amount for Bob' })).toHaveValue(
      '0.01',
    )
    expect(
      screen.getByTestId('paid-for-distribution-footer'),
    ).not.toHaveTextContent(/missing/i)
  })
})

describe('ExpenseForm validation & error reporting', () => {
  async function fillRequired(title = 'Lunch', amount = '10') {
    const { user } = render(
      <ExpenseForm
        group={mockGroup as unknown as GroupShape}
        onSubmit={vi.fn().mockResolvedValue('saved' as const)}
        runtimeFeatureFlags={runtimeFeatureFlags}
        currentLedgerParticipantId="lp-1"
      />,
    )
    const titleInput = screen.getByPlaceholderText('Monday evening restaurant')
    await user.clear(titleInput)
    await user.type(titleInput, title)
    const amountInput = screen.getByRole('textbox', { name: 'Amount' })
    await user.clear(amountInput)
    await user.type(amountInput, amount)
    return { user }
  }

  it('shows the validation summary and translated field errors on invalid submit', async () => {
    const onSubmit = vi.fn().mockResolvedValue('saved' as const)
    const { user } = render(
      <ExpenseForm
        group={mockGroup as unknown as GroupShape}
        onSubmit={onSubmit}
        runtimeFeatureFlags={runtimeFeatureFlags}
        currentLedgerParticipantId="lp-1"
      />,
    )

    // Empty create form: empty title and zero amount.
    await user.click(screen.getByRole('button', { name: /create/i }))

    expect(
      await screen.findByText(
        'Please correct the highlighted fields before saving.',
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Enter at least two characters.'),
    ).toBeInTheDocument()
    expect(screen.getByText('The amount must not be zero.')).toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('shows the translated percentage-sum error for BY_PERCENTAGE', async () => {
    const { user } = await fillRequired()
    await user.click(
      screen.getByRole('radio', { name: /split: by percentage/i }),
    )

    const aliceInput = screen.getByRole('textbox', {
      name: 'Percentage for Alice',
    })
    const bobInput = screen.getByRole('textbox', {
      name: 'Percentage for Bob',
    })
    await user.clear(aliceInput)
    await user.type(aliceInput, '40')
    await user.clear(bobInput)
    await user.type(bobInput, '50')

    await user.click(screen.getByRole('button', { name: /create/i }))

    expect(
      await screen.findByText('Sum of percentages must equal 100.'),
    ).toBeInTheDocument()
  })

  it('shows the row error summary alongside the sum error when both exist (BY_AMOUNT)', async () => {
    const { user } = await fillRequired()
    await user.click(screen.getByRole('radio', { name: /split: by amount/i }))
    // Both rows must be manually edited first, otherwise the automatic
    // balancing re-fills Bob's row and the sum stays at the target.
    const aliceInput = screen.getByRole('textbox', {
      name: 'Amount for Alice',
    })
    const bobInput = screen.getByRole('textbox', { name: 'Amount for Bob' })
    await user.clear(bobInput)
    await user.type(bobInput, '5')
    // Alice types "0.0": in BY_AMOUNT an explicit "0" would remove the row,
    // but "0.0" stays in the list and still validates as a zero share.
    await user.clear(aliceInput)
    await user.type(aliceInput, '0.0')

    await user.click(screen.getByRole('button', { name: /create/i }))

    expect(
      await screen.findByText('Sum of amounts must equal the expense amount.'),
    ).toBeInTheDocument()
    // The row summary is computed from live values, so it survives even if
    // the resolver's array-level issue replaces the row error subtree.
    expect(screen.getByText('Fix these shares:')).toBeInTheDocument()
    expect(
      screen.getByText(/Alice — All shares must be higher than 0\./),
    ).toBeInTheDocument()
  })

  it('shows a translated item-title error for a blank item and focuses the input', async () => {
    const { user } = await fillRequired()

    // Enter ITEMIZED mode: add an item, then confirm the switch dialog
    // (the item participants modal opens after the switch; close it).
    await user.click(screen.getByRole('button', { name: /show items/i }))
    await user.click(screen.getByRole('button', { name: /add item/i }))
    await user.click(
      screen.getAllByRole('button', { name: 'Item participants' })[0]!,
    )
    await user.click(
      screen.getByRole('button', { name: /switch to itemized/i }),
    )
    await user.click(screen.getByRole('button', { name: /^cancel$/i }))

    await user.click(screen.getByRole('button', { name: /create/i }))

    expect(
      await screen.findByText('Item name is required.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Item' })).toHaveFocus()
  })

  it('shows the items-level sum error when items exceed the expense amount', async () => {
    const { user } = await fillRequired()

    // Enter ITEMIZED mode: add an item, then confirm the switch dialog
    // (the item participants modal opens after the switch; close it).
    await user.click(screen.getByRole('button', { name: /show items/i }))
    await user.click(screen.getByRole('button', { name: /add item/i }))
    await user.click(
      screen.getAllByRole('button', { name: 'Item participants' })[0]!,
    )
    await user.click(
      screen.getByRole('button', { name: /switch to itemized/i }),
    )
    await user.click(screen.getByRole('button', { name: /^cancel$/i }))

    const costInput = screen.getByRole('textbox', { name: 'Cost' })
    await user.clear(costInput)
    await user.type(costInput, '15')

    await user.click(screen.getByRole('button', { name: /create/i }))

    expect(
      await screen.findByText('Sum of amounts must equal the expense amount.'),
    ).toBeInTheDocument()
  })

  it('submits a negative item amount and preserves the signed payload', async () => {
    const onSubmit = vi.fn().mockResolvedValue('saved' as const)
    const { user } = render(
      <ExpenseForm
        group={mockGroup as unknown as GroupShape}
        onSubmit={onSubmit}
        runtimeFeatureFlags={runtimeFeatureFlags}
        currentLedgerParticipantId="lp-1"
      />,
    )

    await user.type(
      screen.getByPlaceholderText('Monday evening restaurant'),
      'Lunch',
    )
    await user.type(screen.getByRole('textbox', { name: 'Amount' }), '10')
    await user.click(screen.getByRole('button', { name: /show items/i }))
    await user.click(screen.getByRole('button', { name: /add item/i }))
    await user.click(
      screen.getAllByRole('button', { name: 'Item participants' })[0]!,
    )
    await user.click(
      screen.getByRole('button', { name: /switch to itemized/i }),
    )
    await user.click(screen.getByRole('button', { name: /^cancel$/i }))

    await user.type(screen.getByRole('textbox', { name: 'Item' }), 'Discount')
    const costInput = screen.getByRole('textbox', { name: 'Cost' })
    await user.clear(costInput)
    await user.type(costInput, '-2')
    await user.click(screen.getByRole('button', { name: /create/i }))

    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    const submitted = onSubmit.mock.calls[0]?.[0] as {
      items?: Array<{ unitPrice: number; amount: number }>
    }
    expect(submitted.items?.[0]).toMatchObject({
      unitPrice: -200,
      amount: -200,
    })
  })

  it('focuses the first affected share input after an invalid submit (participant-keyed)', async () => {
    const { user } = await fillRequired()
    await user.click(
      screen.getByRole('radio', { name: /split: by percentage/i }),
    )

    const aliceInput = screen.getByRole('textbox', {
      name: 'Percentage for Alice',
    })
    const bobInput = screen.getByRole('textbox', {
      name: 'Percentage for Bob',
    })
    await user.clear(aliceInput)
    await user.type(aliceInput, '40')
    await user.clear(bobInput)
    await user.type(bobInput, '50')

    await user.click(screen.getByRole('button', { name: /create/i }))

    expect(
      await screen.findByText('Sum of percentages must equal 100.'),
    ).toBeInTheDocument()
    // The paidFor array-level error maps to the first affected row (Alice)
    // and focuses her input through the participant-keyed registry.
    expect(
      screen.getByRole('textbox', { name: 'Percentage for Alice' }),
    ).toHaveFocus()
  })

  it('marks the errored share input with aria-invalid after an invalid submit', async () => {
    const { user } = await fillRequired()
    await user.click(
      screen.getByRole('radio', { name: /multiple payers.*by amount/i }),
    )
    await user.click(screen.getByRole('button', { name: /select all/i }))

    const bobInput = screen.getByRole('textbox', { name: 'Amount for Bob' })
    await user.clear(bobInput)
    await user.type(bobInput, '0.0')

    await user.click(screen.getByRole('button', { name: /create/i }))

    // Bob's row is the only error (Alice's automatic share rebalances to the
    // full amount), so the row error reaches his FormField and the input —
    // not a wrapper — carries aria-invalid.
    // Bob's row is the only error (Alice's automatic share rebalances to the
    // full amount), so the row error reaches his FormField and the input —
    // not a wrapper — carries aria-invalid.
    await vi.waitFor(() =>
      expect(
        screen.getByRole('textbox', { name: 'Amount for Bob' }),
      ).toHaveAttribute('aria-invalid', 'true'),
    )
  })

  it('does not register share fields for unchecked participants', async () => {
    const { user } = await fillRequired()
    await user.click(screen.getByRole('radio', { name: /split: by amount/i }))

    // Uncheck Alice (click the row padding, as the toggle test does): her
    // row keeps a plain, unregistered input — no fake `paidFor[-1].shares`
    // field is mounted anywhere.
    const aliceRow = document.querySelector<HTMLElement>(
      '[data-id="lp-1/BY_AMOUNT/USD"]',
    )
    if (!aliceRow) throw new Error('Alice paid-for row not found')
    await user.click(aliceRow)

    expect(document.querySelector('[name$="[-1].shares"]')).toBeNull()
    expect(
      screen.getByRole('textbox', { name: 'Amount for Alice' }),
    ).toHaveValue('')
    expect(
      screen.getByRole('textbox', { name: 'Amount for Bob' }),
    ).toHaveAttribute('name', 'paidFor[0].shares')
  })

  it('does not surface an inline banner when persistence rejects', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error('Backend exploded'))
    const { user } = render(
      <ExpenseForm
        group={mockGroup as unknown as GroupShape}
        onSubmit={onSubmit}
        runtimeFeatureFlags={runtimeFeatureFlags}
        currentLedgerParticipantId="lp-1"
      />,
    )
    const titleInput = screen.getByPlaceholderText('Monday evening restaurant')
    await user.clear(titleInput)
    await user.type(titleInput, 'Lunch')
    const amountInput = screen.getByRole('textbox', { name: 'Amount' })
    await user.clear(amountInput)
    await user.type(amountInput, '10')

    await user.click(screen.getByRole('button', { name: /create/i }))
    await vi.waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1)
    })

    // `onSubmit` is the persistence callback: a rejection means nothing was
    // saved, the mutation hooks already surfaced it through their error
    // toast, and a manual retry is safe — so no inline banner is claimed.
    expect(screen.queryByText('Backend exploded')).not.toBeInTheDocument()
    expect(
      screen.queryByText('Could not save the expense. Please try again.'),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByText(
        'Please correct the highlighted fields before saving.',
      ),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByText(/couldn't leave this page/i),
    ).not.toBeInTheDocument()
    // The form stays recoverable for a safe retry.
    expect(screen.getByRole('button', { name: /create/i })).toBeEnabled()
  })

  it('surfaces a dedicated notice when post-save work fails after a saved outcome', async () => {
    const onSubmit = vi.fn().mockResolvedValue('saved' as const)
    const onSaved = vi.fn().mockRejectedValue(new Error('Navigation exploded'))
    const { user } = render(
      <ExpenseForm
        group={mockGroup as unknown as GroupShape}
        onSubmit={onSubmit}
        onSaved={onSaved}
        runtimeFeatureFlags={runtimeFeatureFlags}
        currentLedgerParticipantId="lp-1"
      />,
    )
    const titleInput = screen.getByPlaceholderText('Monday evening restaurant')
    await user.clear(titleInput)
    await user.type(titleInput, 'Lunch')
    const amountInput = screen.getByRole('textbox', { name: 'Amount' })
    await user.clear(amountInput)
    await user.type(amountInput, '10')

    await user.click(screen.getByRole('button', { name: /create/i }))
    await vi.waitFor(() => {
      expect(onSaved).toHaveBeenCalledTimes(1)
    })

    // The expense WAS persisted; this is not a save failure (which would
    // invite a duplicate retry), so a dedicated notice explains the state
    // instead of blaming the save.
    expect(
      await screen.findByText(
        "The expense was saved, but we couldn't leave this page. You can close it safely.",
      ),
    ).toBeInTheDocument()
    expect(screen.queryByText('Navigation exploded')).not.toBeInTheDocument()
    expect(
      screen.queryByText(
        'Please correct the highlighted fields before saving.',
      ),
    ).not.toBeInTheDocument()
  })

  it('does not run post-save work after a deferred outcome', async () => {
    const onSubmit = vi.fn().mockResolvedValue('deferred' as const)
    const onSaved = vi.fn()
    const { user } = render(
      <ExpenseForm
        group={mockGroup as unknown as GroupShape}
        onSubmit={onSubmit}
        onSaved={onSaved}
        runtimeFeatureFlags={runtimeFeatureFlags}
        currentLedgerParticipantId="lp-1"
      />,
    )
    const titleInput = screen.getByPlaceholderText('Monday evening restaurant')
    await user.clear(titleInput)
    await user.type(titleInput, 'Lunch')
    const amountInput = screen.getByRole('textbox', { name: 'Amount' })
    await user.clear(amountInput)
    await user.type(amountInput, '10')

    await user.click(screen.getByRole('button', { name: /create/i }))
    await vi.waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1)
    })

    // A deferred submit (e.g. a recurring-edit scope dialog will save later)
    // must not trigger navigation or a notice.
    expect(onSaved).not.toHaveBeenCalled()
    expect(
      screen.queryByText(/couldn't leave this page/i),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /create/i })).toBeEnabled()
  })

  it('focuses the paid-for share input — not the paid-by one — for a paid-for error', async () => {
    const { user } = await fillRequired()
    // Both cards in editable BY_SHARES with the same participants: the
    // paid-by input would win a participant-only registry (it renders after
    // the paid-for card), so the registry must be section-qualified.
    await user.click(screen.getByRole('radio', { name: /split: by shares/i }))
    await user.click(
      screen.getByRole('radio', { name: /multiple payers.*by shares/i }),
    )

    // Paid-for Alice at 0 (noZeroShares); paid-by Alice stays at 1.
    const aliceInputs = screen.getAllByRole('textbox', {
      name: 'Shares for Alice',
    })
    // DOM order: paid-for card first, paid-by card second.
    expect(aliceInputs).toHaveLength(2)
    const paidForAliceInput = aliceInputs[0]!
    const paidByAliceInput = aliceInputs[1]!
    await user.type(paidForAliceInput, '0')

    await user.click(screen.getByRole('button', { name: /create/i }))

    expect(
      await screen.findByText(
        'Shares must be between 0.01 and 1,000,000 with up to two decimals.',
      ),
    ).toBeInTheDocument()
    expect(paidForAliceInput).toHaveFocus()
    expect(paidByAliceInput).not.toHaveFocus()
  })

  it('treats a saved outcome as terminal: re-submit is blocked and only the leave-again action retries navigation', async () => {
    const onSubmit = vi.fn().mockResolvedValue('saved' as const)
    const onSaved = vi
      .fn()
      .mockRejectedValueOnce(new Error('Navigation exploded'))
      .mockResolvedValueOnce(undefined)
    const { user } = render(
      <ExpenseForm
        group={mockGroup as unknown as GroupShape}
        onSubmit={onSubmit}
        onSaved={onSaved}
        runtimeFeatureFlags={runtimeFeatureFlags}
        currentLedgerParticipantId="lp-1"
      />,
    )
    const titleInput = screen.getByPlaceholderText('Monday evening restaurant')
    await user.clear(titleInput)
    await user.type(titleInput, 'Lunch')
    const amountInput = screen.getByRole('textbox', { name: 'Amount' })
    await user.clear(amountInput)
    await user.type(amountInput, '10')

    await user.click(screen.getByRole('button', { name: /create/i }))
    await vi.waitFor(() => {
      expect(onSaved).toHaveBeenCalledTimes(1)
    })
    expect(
      await screen.findByText(
        "The expense was saved, but we couldn't leave this page. You can close it safely.",
      ),
    ).toBeInTheDocument()

    // The expense exists: the submit action is disabled, so clicking it
    // again cannot re-persist (which would duplicate the expense).
    expect(screen.getByRole('button', { name: /create/i })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: /create/i }))
    expect(onSubmit).toHaveBeenCalledTimes(1)

    // The leave-again action retries only the post-save work.
    await user.click(screen.getByRole('button', { name: /try leaving again/i }))
    await vi.waitFor(() => {
      expect(onSaved).toHaveBeenCalledTimes(2)
    })
    expect(onSubmit).toHaveBeenCalledTimes(1)
    await vi.waitFor(() => {
      expect(
        screen.queryByText(/couldn't leave this page/i),
      ).not.toBeInTheDocument()
    })
  })

  it('keeps the row error summary visible when editing an already-blurred share row', async () => {
    const { user } = await fillRequired()
    await user.click(screen.getByRole('radio', { name: /split: by shares/i }))

    // Clearing and re-typing replaces the input element (plain unregistered
    // input ⇄ registered input), so query the rows through a function.
    const aliceInput = () =>
      screen.getByRole('textbox', { name: 'Shares for Alice' })
    const bobInput = () =>
      screen.getByRole('textbox', { name: 'Shares for Bob' })

    // Zero rows: per-row messages surface while typing, but the all-rows
    // summary is gated on blur-or-submit — nothing has blurred yet.
    await user.clear(bobInput())
    await user.type(bobInput(), '0')
    expect(screen.queryByText('Fix these shares:')).not.toBeInTheDocument()

    // Focusing Alice's input blurs Bob's, opening the gate. Validation
    // re-runs asynchronously, so wait for the summary content to update.
    // BY_SHARES zero rows report as `sharesInvalid`.
    await user.type(aliceInput(), '0')
    expect(await screen.findByText('Fix these shares:')).toBeInTheDocument()
    await screen.findByText(
      /Alice — Shares must be between 0\.01 and 1,000,000 with up to two decimals\./,
    )

    // Editing a row after the blur must not close the summary: the
    // keystroke write used to overwrite the nested touched shape with a
    // whole-array flag. Fixing Bob leaves Alice's error to keep the
    // summary content non-empty.
    await user.click(bobInput())
    await user.keyboard('1')
    expect(await screen.findByText('Fix these shares:')).toBeInTheDocument()
    await screen.findByText(
      /Alice — Shares must be between 0\.01 and 1,000,000 with up to two decimals\./,
    )
    expect(
      screen.queryByText(
        /Bob — Shares must be between 0\.01 and 1,000,000 with up to two decimals\./,
      ),
    ).not.toBeInTheDocument()
  })

  it('clears the validation summary as soon as every field is corrected', async () => {
    const { user } = await fillRequired()
    await user.click(
      screen.getByRole('radio', { name: /split: by percentage/i }),
    )

    const aliceInput = screen.getByRole('textbox', {
      name: 'Percentage for Alice',
    })
    const bobInput = screen.getByRole('textbox', {
      name: 'Percentage for Bob',
    })
    await user.clear(aliceInput)
    await user.type(aliceInput, '40')
    await user.clear(bobInput)
    await user.type(bobInput, '50')

    await user.click(screen.getByRole('button', { name: /create/i }))
    expect(
      await screen.findByText(
        'Please correct the highlighted fields before saving.',
      ),
    ).toBeInTheDocument()

    // Fixing the percentage sum must clear the banner without a second
    // submit — the summary derives from RHF's live errors, not a flag that
    // only another submit could reset. The failed submit replaces the row
    // input elements (RHF re-registration), so re-query them.
    const bobAfterSubmit = screen.getByRole('textbox', {
      name: 'Percentage for Bob',
    })
    await user.clear(bobAfterSubmit)
    await user.type(bobAfterSubmit, '60')
    await vi.waitFor(() => {
      expect(
        screen.queryByText(
          'Please correct the highlighted fields before saving.',
        ),
      ).not.toBeInTheDocument()
    })
  })
})
