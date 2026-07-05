import {
  buildExpenseFormDefaults,
  getDefaultSplittingOptions,
  persistDefaultSplittingOptions,
  type GroupShape,
  type LoadedExpense,
} from '@/app/groups/[groupId]/expenses/expense-form/default-values'
import type { ExpenseFormInputValues } from '@spliit/domain'
import {
  getCurrency,
  PAYMENT_CATEGORY_ID,
  RecurrenceRule,
} from '@spliit/domain'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const STORAGE_KEY = 'spliit.defaultSplittingOptions'
const originalWindowDescriptor = Object.getOwnPropertyDescriptor(
  globalThis,
  'window',
)

function setTestWindow(localStorage: Storage) {
  Object.defineProperty(globalThis, 'window', {
    value: { localStorage },
    configurable: true,
  })
}

function restoreTestWindow() {
  if (originalWindowDescriptor) {
    Object.defineProperty(globalThis, 'window', originalWindowDescriptor)
  } else {
    Reflect.deleteProperty(globalThis, 'window')
  }
}

const mockGroup = {
  id: 'group-1',
  name: 'Test Group',
  currencyCode: 'USD',
  participants: [
    { id: 'lp-1', name: 'Alice', pending: false, unlinked: false },
    { id: 'lp-2', name: 'Bob', pending: false, unlinked: false },
  ],
  ledger: { id: 'ledger-1' },
  members: [],
  invitations: [],
} as unknown as GroupShape

const baseFormValues: ExpenseFormInputValues = {
  title: 'Dinner',
  amount: 50, // $50.00 in major units
  splitMode: 'BY_AMOUNT',
  paidFor: [
    { participant: 'lp-1', shares: 25 },
    { participant: 'lp-2', shares: 25 },
  ],
  paidBySplitMode: 'BY_AMOUNT',
  paidByList: [{ participant: 'lp-1', shares: 50 }],
  isMultiPayer: false,
  isReimbursement: false,
  saveDefaultSplittingOptions: true,
  expenseDate: new Date(),
  category: 'general',
  recurrenceRule: 'NONE',
  documents: [],
  notes: '',
}

describe('persistDefaultSplittingOptions', () => {
  const localStorageMock = (() => {
    let store: Record<string, string> = {}
    return {
      getItem: vi.fn((key: string) => store[key] ?? null),
      setItem: vi.fn((key: string, value: string) => {
        store[key] = value
      }),
      removeItem: vi.fn((key: string) => {
        delete store[key]
      }),
      clear: vi.fn(() => {
        store = {}
      }),
    }
  })()

  beforeEach(() => {
    vi.clearAllMocks()
    setTestWindow(localStorageMock as unknown as Storage)
    localStorageMock.clear()
  })

  afterEach(() => {
    restoreTestWindow()
  })

  it('writes the form values verbatim to localStorage', async () => {
    await persistDefaultSplittingOptions('group-1', {
      ...baseFormValues,
      saveDefaultSplittingOptions: true,
    })

    expect(localStorageMock.setItem).toHaveBeenCalledWith(
      STORAGE_KEY,
      JSON.stringify({
        splitMode: 'BY_AMOUNT',
        paidFor: [
          { participant: 'lp-1', shares: 25 },
          { participant: 'lp-2', shares: 25 },
        ],
      }),
    )
  })

  it('persists BY_PERCENTAGE display percentages verbatim (60, not 6000)', async () => {
    await persistDefaultSplittingOptions('group-1', {
      ...baseFormValues,
      splitMode: 'BY_PERCENTAGE',
      paidFor: [
        { participant: 'lp-1', shares: 60 },
        { participant: 'lp-2', shares: 40 },
      ],
      saveDefaultSplittingOptions: true,
    })

    expect(localStorageMock.setItem).toHaveBeenCalledWith(
      STORAGE_KEY,
      JSON.stringify({
        splitMode: 'BY_PERCENTAGE',
        paidFor: [
          { participant: 'lp-1', shares: 60 },
          { participant: 'lp-2', shares: 40 },
        ],
      }),
    )
  })

  it('does nothing when saveDefaultSplittingOptions is false', async () => {
    await persistDefaultSplittingOptions('group-1', {
      ...baseFormValues,
      saveDefaultSplittingOptions: false,
    })

    expect(localStorageMock.setItem).not.toHaveBeenCalled()
  })

  it('does nothing when saveDefaultSplittingOptions is undefined', async () => {
    await persistDefaultSplittingOptions('group-1', {
      ...baseFormValues,
      saveDefaultSplittingOptions: undefined as unknown as false,
    })

    expect(localStorageMock.setItem).not.toHaveBeenCalled()
  })
})

describe('getDefaultSplittingOptions', () => {
  const localStorageMock = (() => {
    let store: Record<string, string> = {}
    return {
      getItem: vi.fn((key: string) => store[key] ?? null),
      setItem: vi.fn((key: string, value: string) => {
        store[key] = value
      }),
      removeItem: vi.fn((key: string) => {
        delete store[key]
      }),
      clear: vi.fn(() => {
        store = {}
      }),
    }
  })()

  beforeEach(() => {
    vi.clearAllMocks()
    setTestWindow(localStorageMock as unknown as Storage)
    localStorageMock.clear()
  })

  afterEach(() => {
    restoreTestWindow()
  })

  it('returns saved defaults when localStorage has valid data', () => {
    localStorageMock.setItem(
      STORAGE_KEY,
      JSON.stringify({
        splitMode: 'BY_AMOUNT',
        paidFor: [{ participant: 'lp-1', shares: 25 }],
      }),
    )

    const result = getDefaultSplittingOptions(mockGroup)
    expect(result.splitMode).toBe('BY_AMOUNT')
    expect(result.paidFor).toEqual([{ participant: 'lp-1', shares: 25 }])
  })

  it('returns all-participants-evenly when localStorage is empty', () => {
    const result = getDefaultSplittingOptions(mockGroup)
    expect(result.splitMode).toBe('EVENLY')
    expect(result.paidFor).toEqual([
      { participant: 'lp-1', shares: 1 },
      { participant: 'lp-2', shares: 1 },
    ])
  })

  it('filters out stale participant IDs that no longer exist in the group', () => {
    localStorageMock.setItem(
      STORAGE_KEY,
      JSON.stringify({
        splitMode: 'BY_PERCENTAGE',
        paidFor: [
          { participant: 'lp-1', shares: 50 },
          { participant: 'lp-999', shares: 50 },
        ],
      }),
    )

    const result = getDefaultSplittingOptions(mockGroup)
    expect(result.splitMode).toBe('BY_PERCENTAGE')
    expect(result.paidFor).toEqual([{ participant: 'lp-1', shares: 50 }])
  })

  it('falls back to default when no saved participants remain in the group', () => {
    localStorageMock.setItem(
      STORAGE_KEY,
      JSON.stringify({
        splitMode: 'BY_SHARES',
        paidFor: [{ participant: 'lp-999', shares: 3 }],
      }),
    )

    const result = getDefaultSplittingOptions(mockGroup)
    expect(result.splitMode).toBe('EVENLY')
    expect(result.paidFor).toHaveLength(2)
  })

  it('returns shares unmodified on load (no x100)', () => {
    localStorageMock.setItem(
      STORAGE_KEY,
      JSON.stringify({
        splitMode: 'BY_PERCENTAGE',
        paidFor: [
          { participant: 'lp-1', shares: 80 },
          { participant: 'lp-2', shares: 20 },
        ],
      }),
    )

    const result = getDefaultSplittingOptions(mockGroup)
    expect(result.paidFor).toEqual([
      { participant: 'lp-1', shares: 80 },
      { participant: 'lp-2', shares: 20 },
    ])
  })

  it('roundtrips BY_SHARES without scaling', () => {
    localStorageMock.setItem(
      STORAGE_KEY,
      JSON.stringify({
        splitMode: 'BY_SHARES',
        paidFor: [
          { participant: 'lp-1', shares: 1 },
          { participant: 'lp-2', shares: 2 },
          { participant: 'lp-3', shares: 3 },
        ],
      }),
    )

    const result = getDefaultSplittingOptions(mockGroup)
    expect(result.splitMode).toBe('BY_SHARES')
    expect(result.paidFor).toEqual([
      { participant: 'lp-1', shares: 1 },
      { participant: 'lp-2', shares: 2 },
    ])
  })

  it('falls back to default when saved data is unparseable', () => {
    localStorageMock.setItem(STORAGE_KEY, '{invalid json')

    const result = getDefaultSplittingOptions(mockGroup)
    expect(result.splitMode).toBe('EVENLY')
    expect(result.paidFor).toHaveLength(2)
  })

  it('rejects payloads where shares are strings (pre-refactor legacy) and falls back to EVENLY', () => {
    localStorageMock.setItem(
      STORAGE_KEY,
      JSON.stringify({
        splitMode: 'BY_AMOUNT',
        paidFor: [
          { participant: 'lp-1', shares: '60' },
          { participant: 'lp-2', shares: '40' },
        ],
      }),
    )

    const result = getDefaultSplittingOptions(mockGroup)
    expect(result.splitMode).toBe('EVENLY')
    expect(result.paidFor).toHaveLength(2)
  })

  it('rejects payloads where shares is null/undefined/missing and falls back to EVENLY', () => {
    localStorageMock.setItem(
      STORAGE_KEY,
      JSON.stringify({
        splitMode: 'BY_PERCENTAGE',
        paidFor: [
          { participant: 'lp-1', shares: null },
          { participant: 'lp-2', shares: undefined },
          { participant: 'lp-1' }, // missing shares entirely
        ],
      }),
    )

    const result = getDefaultSplittingOptions(mockGroup)
    expect(result.splitMode).toBe('EVENLY')
    expect(result.paidFor).toHaveLength(2)
  })
})

describe('buildExpenseFormDefaults (reimbursement branch)', () => {
  const localStorageMock = (() => {
    let store: Record<string, string> = {}
    return {
      getItem: vi.fn((key: string) => store[key] ?? null),
      setItem: vi.fn((key: string, value: string) => {
        store[key] = value
      }),
      removeItem: vi.fn((key: string) => {
        delete store[key]
      }),
      clear: vi.fn(() => {
        store = {}
      }),
    }
  })()

  beforeEach(() => {
    vi.clearAllMocks()
    setTestWindow(localStorageMock as unknown as Storage)
    localStorageMock.clear()
  })

  afterEach(() => {
    restoreTestWindow()
  })

  it('forces splitMode to EVENLY when no saved defaults exist', () => {
    const result = buildExpenseFormDefaults({
      isCreate: true,
      searchParams: {
        reimbursement: 'yes',
        from: 'lp-1',
        to: 'lp-2',
        amount: '50',
      },
      group: mockGroup,
      groupCurrency: getCurrency('USD')!,
      currentLedgerParticipantId: null,
      reimbursementTitle: 'Reimbursement',
    })

    expect(result.splitMode).toBe('EVENLY')
    expect(result.paidFor).toEqual([{ participant: 'lp-2', shares: 1 }])
    expect(result.isReimbursement).toBe(true)
    expect(result.category).toBe(PAYMENT_CATEGORY_ID)
    // searchParams.amount is in cents (e.g., 50 cents = $0.50); the form
    // stores amount and paidByList shares in major units.
    expect(result.paidByList).toEqual([{ participant: 'lp-1', shares: 0.5 }])
    expect(result.isMultiPayer).toBe(false)
  })

  it('forces splitMode to EVENLY even when saved defaults are BY_AMOUNT', () => {
    localStorageMock.setItem(
      STORAGE_KEY,
      JSON.stringify({
        splitMode: 'BY_AMOUNT',
        paidFor: [
          { participant: 'lp-1', shares: 30 },
          { participant: 'lp-2', shares: 70 },
        ],
      }),
    )

    const result = buildExpenseFormDefaults({
      isCreate: true,
      searchParams: {
        reimbursement: 'yes',
        from: 'lp-1',
        to: 'lp-2',
        amount: '50',
      },
      group: mockGroup,
      groupCurrency: getCurrency('USD')!,
      currentLedgerParticipantId: null,
      reimbursementTitle: 'Reimbursement',
    })

    expect(result.splitMode).toBe('EVENLY')
    expect(result.paidFor).toEqual([{ participant: 'lp-2', shares: 1 }])
  })

  it('forces splitMode to EVENLY even when saved defaults are BY_PERCENTAGE', () => {
    localStorageMock.setItem(
      STORAGE_KEY,
      JSON.stringify({
        splitMode: 'BY_PERCENTAGE',
        paidFor: [
          { participant: 'lp-1', shares: 80 },
          { participant: 'lp-2', shares: 20 },
        ],
      }),
    )

    const result = buildExpenseFormDefaults({
      isCreate: true,
      searchParams: {
        reimbursement: 'yes',
        from: 'lp-1',
        to: 'lp-2',
        amount: '50',
      },
      group: mockGroup,
      groupCurrency: getCurrency('USD')!,
      currentLedgerParticipantId: null,
      reimbursementTitle: 'Reimbursement',
    })

    expect(result.splitMode).toBe('EVENLY')
    expect(result.paidFor).toEqual([{ participant: 'lp-2', shares: 1 }])
  })

  it('uses searchParams.to as the only paidFor recipient', () => {
    const result = buildExpenseFormDefaults({
      isCreate: true,
      searchParams: {
        reimbursement: 'yes',
        from: 'lp-1',
        to: 'lp-2',
        amount: '25',
      },
      group: mockGroup,
      groupCurrency: getCurrency('USD')!,
      currentLedgerParticipantId: null,
      reimbursementTitle: 'Reimbursement',
    })

    expect(result.paidFor).toHaveLength(1)
    expect(result.paidFor[0]).toEqual({ participant: 'lp-2', shares: 1 })
  })

  it('still sets the payment category and recurrence for reimbursement', () => {
    const result = buildExpenseFormDefaults({
      isCreate: true,
      searchParams: {
        reimbursement: 'yes',
        from: 'lp-1',
        to: 'lp-2',
        amount: '0',
      },
      group: mockGroup,
      groupCurrency: getCurrency('USD')!,
      currentLedgerParticipantId: null,
      reimbursementTitle: 'Reimbursement',
    })

    expect(result.category).toBe(PAYMENT_CATEGORY_ID)
    expect(result.recurrenceRule).toBe(RecurrenceRule.NONE)
  })
})

describe('buildExpenseFormDefaults (prefilled items)', () => {
  const localStorageMock = (() => {
    let store: Record<string, string> = {}
    return {
      getItem: vi.fn((key: string) => store[key] ?? null),
      setItem: vi.fn((key: string, value: string) => {
        store[key] = value
      }),
      removeItem: vi.fn((key: string) => {
        delete store[key]
      }),
      clear: vi.fn(() => {
        store = {}
      }),
    }
  })()

  beforeEach(() => {
    vi.clearAllMocks()
    setTestWindow(localStorageMock as unknown as Storage)
    localStorageMock.clear()
  })

  afterEach(() => {
    restoreTestWindow()
  })

  it('prefills create defaults with URL item rows and item participant splits', () => {
    const result = buildExpenseFormDefaults({
      isCreate: true,
      searchParams: {
        title: 'Receipt',
        originalCurrency: 'USD',
        items: JSON.stringify([
          {
            title: 'Pizza',
            unitPrice: 12.5,
            quantity: 2,
            splitMode: 'BY_SHARES',
            paidFor: [
              { participant: 'lp-1', shares: 2 },
              { participant: 'lp-2', shares: 1 },
              { participant: 'unknown', shares: 1 },
            ],
          },
        ]),
      },
      group: mockGroup,
      groupCurrency: getCurrency('USD')!,
      currentLedgerParticipantId: 'lp-1',
      reimbursementTitle: 'Reimbursement',
    })

    expect(result.amount).toBe(25)
    expect(result.title).toBe('Receipt')
    expect(result.splitMode).toBe('ITEMIZED')
    expect(result.items).toEqual([
      expect.objectContaining({
        title: 'Pizza',
        unitPrice: 12.5,
        quantity: 2,
        splitMode: 'BY_SHARES',
        paidFor: [
          { participant: 'lp-1', shares: 2 },
          { participant: 'lp-2', shares: 1 },
        ],
      }),
    ])
  })
})

describe('buildExpenseFormDefaults (copy branch)', () => {
  // Loaded expense shape — mirrors what the API returns. The function
  // only reads a subset, so the rest can be omitted here.
  const loadedExpense: LoadedExpense = {
    id: 'expense-1',
    title: 'Groceries',
    expenseDate: new Date('2024-12-01T00:00:00.000Z'),
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
    notes: 'Weekly groceries',
    recurrenceRule: 'NONE',
    items: [],
    itemizedRemainder: null,
  } as unknown as LoadedExpense

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2025-07-15T12:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('prefills every field from the source expense', () => {
    const result = buildExpenseFormDefaults({
      isCreate: true, // simulate the call shape used by CreateExpenseForm
      expense: loadedExpense,
      isCopy: true,
      searchParams: {},
      group: mockGroup,
      groupCurrency: getCurrency('USD')!,
      currentLedgerParticipantId: 'lp-1',
      reimbursementTitle: 'Reimbursement',
    })

    expect(result.title).toBe('Groceries')
    expect(result.notes).toBe('Weekly groceries')
    expect(result.category).toBe('food-and-drink')
    expect(result.amount).toBe(50)
    // paidBy BY_AMOUNT shares convert from storage minor units to the
    // selected currency's major units via `amountAsDecimal`.
    expect(result.paidByList).toEqual([{ participant: 'lp-1', shares: 50 }])
    // paidFor is EVENLY, so the stored share counts pass through
    // untouched (the form schema treats them as weights).
    expect(result.paidFor).toEqual([
      { participant: 'lp-1', shares: 2500 },
      { participant: 'lp-2', shares: 2500 },
    ])
    expect(result.splitMode).toBe('EVENLY')
  })

  it('overrides expenseDate to today even when the source was older', () => {
    const result = buildExpenseFormDefaults({
      isCreate: true,
      expense: loadedExpense,
      isCopy: true,
      searchParams: {},
      group: mockGroup,
      groupCurrency: getCurrency('USD')!,
      currentLedgerParticipantId: 'lp-1',
      reimbursementTitle: 'Reimbursement',
    })

    expect(result.expenseDate).toEqual(new Date('2025-07-15T12:00:00.000Z'))
    expect(result.expenseDate).not.toEqual(loadedExpense.expenseDate)
  })

  it('does not touch other fields when not in copy mode', () => {
    const result = buildExpenseFormDefaults({
      isCreate: false,
      expense: loadedExpense,
      searchParams: {},
      group: mockGroup,
      groupCurrency: getCurrency('USD')!,
      currentLedgerParticipantId: 'lp-1',
      reimbursementTitle: 'Reimbursement',
    })

    expect(result.expenseDate).toEqual(loadedExpense.expenseDate)
    expect(result.title).toBe('Groceries')
  })

  it('keeps the original title verbatim (no "(copy)" suffix)', () => {
    const result = buildExpenseFormDefaults({
      isCreate: true,
      expense: loadedExpense,
      isCopy: true,
      searchParams: {},
      group: mockGroup,
      groupCurrency: getCurrency('USD')!,
      currentLedgerParticipantId: 'lp-1',
      reimbursementTitle: 'Reimbursement',
    })

    expect(result.title).toBe('Groceries')
    expect(result.title).not.toMatch(/copy/i)
  })
})
