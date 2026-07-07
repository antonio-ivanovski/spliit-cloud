import { splitEqual } from '@/app/groups/[groupId]/expenses/expense-form/default-split/split-equal'
import {
  buildExpenseFormDefaults,
  getNeutralDefaultSplit,
  savedDefaultToFormValues,
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
  expenseDate: new Date(),
  category: 'general',
  recurrenceRule: 'NONE',
  documents: [],
  notes: '',
}

const usd = () => getCurrency('USD')!

describe('splitEqual', () => {
  it('returns false when saved is null', () => {
    expect(
      splitEqual('EVENLY', [{ participant: 'lp-1', shares: 1 }], null, usd()),
    ).toBe(false)
  })

  it('returns false when current mode is ITEMIZED', () => {
    expect(
      splitEqual(
        'ITEMIZED',
        [],
        { splitMode: 'EVENLY', paidFor: [{ participant: 'lp-1', shares: 1 }] },
        usd(),
      ),
    ).toBe(false)
  })

  it('returns false when splitMode differs', () => {
    expect(
      splitEqual(
        'BY_AMOUNT',
        [{ participant: 'lp-1', shares: 25 }],
        {
          splitMode: 'EVENLY',
          paidFor: [{ participant: 'lp-1', shares: 1 }],
        },
        usd(),
      ),
    ).toBe(false)
  })

  describe('EVENLY', () => {
    it('returns true when included participants match', () => {
      expect(
        splitEqual(
          'EVENLY',
          [
            { participant: 'lp-1', shares: 1 },
            { participant: 'lp-2', shares: 1 },
          ],
          {
            splitMode: 'EVENLY',
            paidFor: [
              { participant: 'lp-2', shares: 1 },
              { participant: 'lp-1', shares: 1 },
            ],
          },
          usd(),
        ),
      ).toBe(true)
    })

    it('returns false when an extra participant is included on either side', () => {
      expect(
        splitEqual(
          'EVENLY',
          [
            { participant: 'lp-1', shares: 1 },
            { participant: 'lp-2', shares: 1 },
          ],
          {
            splitMode: 'EVENLY',
            paidFor: [{ participant: 'lp-1', shares: 1 }],
          },
          usd(),
        ),
      ).toBe(false)
    })
  })

  describe('BY_SHARES', () => {
    it('returns true when each participant share matches within tolerance', () => {
      expect(
        splitEqual(
          'BY_SHARES',
          [
            { participant: 'lp-1', shares: 2 },
            { participant: 'lp-2', shares: 1 },
          ],
          {
            splitMode: 'BY_SHARES',
            paidFor: [
              { participant: 'lp-1', shares: 2 },
              { participant: 'lp-2', shares: 1 },
            ],
          },
          usd(),
        ),
      ).toBe(true)
    })

    it('returns false when a share differs beyond tolerance', () => {
      expect(
        splitEqual(
          'BY_SHARES',
          [
            { participant: 'lp-1', shares: 2 },
            { participant: 'lp-2', shares: 1 },
          ],
          {
            splitMode: 'BY_SHARES',
            paidFor: [
              { participant: 'lp-1', shares: 3 },
              { participant: 'lp-2', shares: 1 },
            ],
          },
          usd(),
        ),
      ).toBe(false)
    })
  })

  describe('BY_PERCENTAGE', () => {
    it('converts stored basis points to display percentages before comparing', () => {
      // 25% in form units (25) must equal 2500 basis points stored.
      expect(
        splitEqual(
          'BY_PERCENTAGE',
          [
            { participant: 'lp-1', shares: 25 },
            { participant: 'lp-2', shares: 75 },
          ],
          {
            splitMode: 'BY_PERCENTAGE',
            paidFor: [
              { participant: 'lp-1', shares: 2500 },
              { participant: 'lp-2', shares: 7500 },
            ],
          },
          usd(),
        ),
      ).toBe(true)
    })
  })

  describe('BY_AMOUNT', () => {
    it('converts stored minor units to display units before comparing', () => {
      // $25.00 in form units (25) must equal 2500 cents stored.
      expect(
        splitEqual(
          'BY_AMOUNT',
          [
            { participant: 'lp-1', shares: 25 },
            { participant: 'lp-2', shares: 25 },
          ],
          {
            splitMode: 'BY_AMOUNT',
            paidFor: [
              { participant: 'lp-1', shares: 2500 },
              { participant: 'lp-2', shares: 2500 },
            ],
          },
          usd(),
        ),
      ).toBe(true)
    })
  })
})

describe('savedDefaultToFormValues', () => {
  it('returns null when the saved payload is invalid', () => {
    expect(
      savedDefaultToFormValues(
        { splitMode: 'BY_AMOUNT', paidFor: 'not-an-array' },
        mockGroup,
        usd(),
      ),
    ).toBeNull()
  })

  it('filters out stale participant ids that no longer exist', () => {
    const result = savedDefaultToFormValues(
      {
        splitMode: 'BY_PERCENTAGE',
        paidFor: [
          { participant: 'lp-1', shares: 5000 },
          { participant: 'lp-999', shares: 5000 },
        ],
      },
      mockGroup,
      usd(),
    )
    expect(result?.paidFor).toEqual([{ participant: 'lp-1', shares: 50 }])
  })

  it('returns null when no participants remain after filtering', () => {
    const result = savedDefaultToFormValues(
      {
        splitMode: 'BY_SHARES',
        paidFor: [{ participant: 'lp-999', shares: 3 }],
      },
      mockGroup,
      usd(),
    )
    expect(result).toBeNull()
  })

  it('converts BY_AMOUNT minor units to display units', () => {
    const result = savedDefaultToFormValues(
      {
        splitMode: 'BY_AMOUNT',
        paidFor: [{ participant: 'lp-1', shares: 2500 }],
      },
      mockGroup,
      usd(),
    )
    expect(result?.paidFor).toEqual([{ participant: 'lp-1', shares: 25 }])
  })

  it('converts BY_PERCENTAGE basis points to display percentages', () => {
    const result = savedDefaultToFormValues(
      {
        splitMode: 'BY_PERCENTAGE',
        paidFor: [
          { participant: 'lp-1', shares: 8000 },
          { participant: 'lp-2', shares: 2000 },
        ],
      },
      mockGroup,
      usd(),
    )
    expect(result?.paidFor).toEqual([
      { participant: 'lp-1', shares: 80 },
      { participant: 'lp-2', shares: 20 },
    ])
  })

  it('passes BY_SHARES / EVENLY shares through unchanged', () => {
    const result = savedDefaultToFormValues(
      {
        splitMode: 'BY_SHARES',
        paidFor: [
          { participant: 'lp-1', shares: 2 },
          { participant: 'lp-2', shares: 1 },
        ],
      },
      mockGroup,
      usd(),
    )
    expect(result?.paidFor).toEqual([
      { participant: 'lp-1', shares: 2 },
      { participant: 'lp-2', shares: 1 },
    ])
  })
})

describe('getNeutralDefaultSplit', () => {
  it('returns EVENLY over all participants', () => {
    const result = getNeutralDefaultSplit(mockGroup)
    expect(result.splitMode).toBe('EVENLY')
    expect(result.paidFor).toEqual([
      { participant: 'lp-1', shares: 1 },
      { participant: 'lp-2', shares: 1 },
    ])
  })
})

describe('buildExpenseFormDefaults (saved default)', () => {
  it('applies the saved default on the create flow when present', () => {
    const result = buildExpenseFormDefaults({
      isCreate: true,
      searchParams: {},
      group: mockGroup,
      groupCurrency: usd(),
      currentLedgerParticipantId: 'lp-1',
      reimbursementTitle: 'Reimbursement',
      savedDefault: {
        splitMode: 'BY_PERCENTAGE',
        paidFor: [
          { participant: 'lp-1', shares: 8000 },
          { participant: 'lp-2', shares: 2000 },
        ],
      },
    })

    expect(result.splitMode).toBe('BY_PERCENTAGE')
    expect(result.paidFor).toEqual([
      { participant: 'lp-1', shares: 80 },
      { participant: 'lp-2', shares: 20 },
    ])
  })

  it('falls back to neutral EVENLY when savedDefault is null', () => {
    const result = buildExpenseFormDefaults({
      isCreate: true,
      searchParams: {},
      group: mockGroup,
      groupCurrency: usd(),
      currentLedgerParticipantId: null,
      reimbursementTitle: 'Reimbursement',
      savedDefault: null,
    })

    expect(result.splitMode).toBe('EVENLY')
    expect(result.paidFor).toHaveLength(2)
    expect(result.paidFor.every((r) => r.shares === 1)).toBe(true)
  })

  it('falls back to neutral EVENLY when savedDefault references only stale participants', () => {
    const result = buildExpenseFormDefaults({
      isCreate: true,
      searchParams: {},
      group: mockGroup,
      groupCurrency: usd(),
      currentLedgerParticipantId: null,
      reimbursementTitle: 'Reimbursement',
      savedDefault: {
        splitMode: 'BY_SHARES',
        paidFor: [{ participant: 'lp-removed', shares: 3 }],
      },
    })

    expect(result.splitMode).toBe('EVENLY')
    expect(result.paidFor).toHaveLength(2)
  })
})

describe('buildExpenseFormDefaults (reimbursement branch)', () => {
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
      groupCurrency: usd(),
      currentLedgerParticipantId: null,
      reimbursementTitle: 'Reimbursement',
      savedDefault: null,
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
    const result = buildExpenseFormDefaults({
      isCreate: true,
      searchParams: {
        reimbursement: 'yes',
        from: 'lp-1',
        to: 'lp-2',
        amount: '50',
      },
      group: mockGroup,
      groupCurrency: usd(),
      currentLedgerParticipantId: null,
      reimbursementTitle: 'Reimbursement',
      savedDefault: {
        splitMode: 'BY_AMOUNT',
        paidFor: [
          { participant: 'lp-1', shares: 30 },
          { participant: 'lp-2', shares: 70 },
        ],
      },
    })

    expect(result.splitMode).toBe('EVENLY')
    expect(result.paidFor).toEqual([{ participant: 'lp-2', shares: 1 }])
  })

  it('forces splitMode to EVENLY even when saved defaults are BY_PERCENTAGE', () => {
    const result = buildExpenseFormDefaults({
      isCreate: true,
      searchParams: {
        reimbursement: 'yes',
        from: 'lp-1',
        to: 'lp-2',
        amount: '50',
      },
      group: mockGroup,
      groupCurrency: usd(),
      currentLedgerParticipantId: null,
      reimbursementTitle: 'Reimbursement',
      savedDefault: {
        splitMode: 'BY_PERCENTAGE',
        paidFor: [
          { participant: 'lp-1', shares: 8000 },
          { participant: 'lp-2', shares: 2000 },
        ],
      },
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
      groupCurrency: usd(),
      currentLedgerParticipantId: null,
      reimbursementTitle: 'Reimbursement',
      savedDefault: null,
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
      groupCurrency: usd(),
      currentLedgerParticipantId: null,
      reimbursementTitle: 'Reimbursement',
      savedDefault: null,
    })

    expect(result.category).toBe(PAYMENT_CATEGORY_ID)
    expect(result.recurrenceRule).toBe(RecurrenceRule.NONE)
  })
})

describe('buildExpenseFormDefaults (prefilled items)', () => {
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
      groupCurrency: usd(),
      currentLedgerParticipantId: 'lp-1',
      reimbursementTitle: 'Reimbursement',
      savedDefault: null,
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
      groupCurrency: usd(),
      currentLedgerParticipantId: 'lp-1',
      reimbursementTitle: 'Reimbursement',
      savedDefault: null,
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
      groupCurrency: usd(),
      currentLedgerParticipantId: 'lp-1',
      reimbursementTitle: 'Reimbursement',
      savedDefault: null,
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
      groupCurrency: usd(),
      currentLedgerParticipantId: 'lp-1',
      reimbursementTitle: 'Reimbursement',
      savedDefault: null,
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
      groupCurrency: usd(),
      currentLedgerParticipantId: 'lp-1',
      reimbursementTitle: 'Reimbursement',
      savedDefault: null,
    })

    expect(result.title).toBe('Groceries')
    expect(result.title).not.toMatch(/copy/i)
  })
})
