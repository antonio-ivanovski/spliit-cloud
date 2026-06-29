import {
  buildExpenseFormDefaults,
  getDefaultSplittingOptions,
  persistDefaultSplittingOptions,
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
}

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

    const result = getDefaultSplittingOptions(mockGroup as any)
    expect(result.splitMode).toBe('BY_AMOUNT')
    expect(result.paidFor).toEqual([{ participant: 'lp-1', shares: 25 }])
  })

  it('returns all-participants-evenly when localStorage is empty', () => {
    const result = getDefaultSplittingOptions(mockGroup as any)
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

    const result = getDefaultSplittingOptions(mockGroup as any)
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

    const result = getDefaultSplittingOptions(mockGroup as any)
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

    const result = getDefaultSplittingOptions(mockGroup as any)
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

    const result = getDefaultSplittingOptions(mockGroup as any)
    expect(result.splitMode).toBe('BY_SHARES')
    expect(result.paidFor).toEqual([
      { participant: 'lp-1', shares: 1 },
      { participant: 'lp-2', shares: 2 },
    ])
  })

  it('falls back to default when saved data is unparseable', () => {
    localStorageMock.setItem(STORAGE_KEY, '{invalid json')

    const result = getDefaultSplittingOptions(mockGroup as any)
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
      group: mockGroup as any,
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
      group: mockGroup as any,
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
      group: mockGroup as any,
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
      group: mockGroup as any,
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
      group: mockGroup as any,
      groupCurrency: getCurrency('USD')!,
      currentLedgerParticipantId: null,
      reimbursementTitle: 'Reimbursement',
    })

    expect(result.category).toBe(PAYMENT_CATEGORY_ID)
    expect(result.recurrenceRule).toBe(RecurrenceRule.NONE)
  })
})
