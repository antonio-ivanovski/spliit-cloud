import {
  getDefaultSplittingOptions,
  persistDefaultSplittingOptions,
} from '@/app/groups/[groupId]/expenses/expense-form/default-values'
import type { ExpenseFormValues } from '@spliit/domain'
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
          { participant: 'lp-1', shares: 5000 },
          { participant: 'lp-999', shares: 5000 },
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

  it('roundtrips BY_PERCENTAGE with raw string shares (e.g., 80 not 8000)', () => {
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
      { participant: 'lp-1', shares: 80 },
      { participant: 'lp-2', shares: 20 },
    ])
  })

  it('roundtrips BY_SHARES with raw string shares (e.g., 1 not 100)', () => {
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
      { participant: 'lp-1', shares: 1 },
      { participant: 'lp-2', shares: 2 },
    ])
  })

  it('roundtrips BY_PERCENTAGE with raw persist and get', async () => {
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
      { participant: 'lp-1', shares: 80 },
      { participant: 'lp-2', shares: 20 },
    ])
  })

  it('falls back to default when saved data is unparseable', () => {
    localStorageMock.setItem(STORAGE_KEY, '{invalid json')

    const result = getDefaultSplittingOptions(mockGroup as any)
    expect(result.splitMode).toBe('EVENLY')
    expect(result.paidFor).toHaveLength(2)
  })
})
