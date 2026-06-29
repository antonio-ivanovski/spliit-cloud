import {
  buildExpenseFormDefaults,
  getDefaultSplittingOptions,
  persistDefaultSplittingOptions,
} from '@/app/groups/[groupId]/expenses/expense-form/default-values'
import type { ExpenseFormValues } from '@spliit/domain'
import { getCurrency, PAYMENT_CATEGORY_ID, RecurrenceRule } from '@spliit/domain'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const STORAGE_KEY = 'spliit.defaultSplittingOptions'

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

const baseFormValues: ExpenseFormValues = {
  title: 'Dinner',
  amount: 5000,
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
    vi.stubGlobal('window', { localStorage: localStorageMock })
    localStorageMock.clear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('saves splitMode and paidFor when saveDefaultSplittingOptions is true', async () => {
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
    vi.stubGlobal('window', { localStorage: localStorageMock })
    localStorageMock.clear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
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
      { participant: 'lp-1', shares: '1' },
      { participant: 'lp-2', shares: '1' },
    ])
  })

  it('filters out stale participant IDs that no longer exist in the group', () => {
    localStorageMock.setItem(
      STORAGE_KEY,
      JSON.stringify({
        splitMode: 'BY_PERCENTAGE',
        paidFor: [
          { participant: 'lp-1', shares: '50' },
          { participant: 'lp-999', shares: '50' },
        ],
      }),
    )

    const result = getDefaultSplittingOptions(mockGroup as any)
    expect(result.splitMode).toBe('BY_PERCENTAGE')
    expect(result.paidFor).toEqual([{ participant: 'lp-1', shares: 5000 }])
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

  it('roundtrips BY_PERCENTAGE: 80% persists and loads as 8000 basis points', () => {
    localStorageMock.setItem(
      STORAGE_KEY,
      JSON.stringify({
        splitMode: 'BY_PERCENTAGE',
        paidFor: [
          { participant: 'lp-1', shares: '80' },
          { participant: 'lp-2', shares: '20' },
        ],
      }),
    )

    const result = getDefaultSplittingOptions(mockGroup as any)
    expect(result.splitMode).toBe('BY_PERCENTAGE')
    expect(result.paidFor).toEqual([
      { participant: 'lp-1', shares: 8000 },
      { participant: 'lp-2', shares: 2000 },
    ])
  })

  it('roundtrips BY_SHARES: 1 share persists and loads as 100 basis points', () => {
    localStorageMock.setItem(
      STORAGE_KEY,
      JSON.stringify({
        splitMode: 'BY_SHARES',
        paidFor: [
          { participant: 'lp-1', shares: '1' },
          { participant: 'lp-2', shares: '2' },
          { participant: 'lp-3', shares: '3' },
        ],
      }),
    )

    const result = getDefaultSplittingOptions(mockGroup as any)
    expect(result.splitMode).toBe('BY_SHARES')
    expect(result.paidFor).toEqual([
      { participant: 'lp-1', shares: 100 },
      { participant: 'lp-2', shares: 200 },
    ])
  })

  it('roundtrips BY_PERCENTAGE: persist and get yields basis points', async () => {
    await persistDefaultSplittingOptions('group-1', {
      ...baseFormValues,
      splitMode: 'BY_PERCENTAGE',
      paidFor: [
        { participant: 'lp-1', shares: '80' as any },
        { participant: 'lp-2', shares: '20' as any },
      ],
      saveDefaultSplittingOptions: true,
    })

    const result = getDefaultSplittingOptions(mockGroup as any)
    expect(result.splitMode).toBe('BY_PERCENTAGE')
    expect(result.paidFor).toEqual([
      { participant: 'lp-1', shares: 8000 },
      { participant: 'lp-2', shares: 2000 },
    ])
  })

  it('returns BY_PERCENTAGE shares in basis points when saved as numbers', () => {
    localStorageMock.setItem(
      STORAGE_KEY,
      JSON.stringify({
        splitMode: 'BY_PERCENTAGE',
        paidFor: [
          { participant: 'lp-1', shares: 50 },
          { participant: 'lp-2', shares: 50 },
        ],
      }),
    )

    const result = getDefaultSplittingOptions(mockGroup as any)
    expect(result.splitMode).toBe('BY_PERCENTAGE')
    expect(result.paidFor).toEqual([
      { participant: 'lp-1', shares: 5000 },
      { participant: 'lp-2', shares: 5000 },
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
    vi.stubGlobal('window', { localStorage: localStorageMock })
    localStorageMock.clear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
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
    expect(result.paidFor).toEqual([{ participant: 'lp-2', shares: '1' }])
    expect(result.isReimbursement).toBe(true)
    expect(result.category).toBe(PAYMENT_CATEGORY_ID)
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
    expect(result.paidFor).toEqual([{ participant: 'lp-2', shares: '1' }])
  })

  it('forces splitMode to EVENLY even when saved defaults are BY_PERCENTAGE', () => {
    localStorageMock.setItem(
      STORAGE_KEY,
      JSON.stringify({
        splitMode: 'BY_PERCENTAGE',
        paidFor: [
          { participant: 'lp-1', shares: 5000 },
          { participant: 'lp-2', shares: 5000 },
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
    expect(result.paidFor).toEqual([{ participant: 'lp-2', shares: '1' }])
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
    expect(result.paidFor[0]).toEqual({ participant: 'lp-2', shares: '1' })
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
