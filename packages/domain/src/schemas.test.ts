import {
  expenseApiSchema,
  expenseFormInputSchema,
  friendFormSchema,
  groupFormSchema,
} from './schemas'

const baseInput = {
  expenseDate: new Date('2025-01-01T00:00:00.000Z'),
  title: 'Dinner',
  category: 'general',
  amount: 10,
  originalCurrency: '',
  conversionRate: undefined,
  conversionType: undefined,
  paidBySplitMode: 'EVENLY',
  paidByList: [{ participant: 'p0', shares: 1 }],
  paidFor: [{ participant: 'p0', shares: 1 }],
  isMultiPayer: false,
  splitMode: 'EVENLY',
  isReimbursement: false,
  documents: [],
  notes: undefined,
  recurrenceRule: 'NONE',
}

const baseApi = {
  expenseDate: new Date('2025-01-01T00:00:00.000Z'),
  title: 'Dinner',
  category: 'general',
  amount: 1000,
  paidBySplitMode: 'EVENLY',
  paidByList: [{ participant: 'p0', shares: 1 }],
  paidFor: [{ participant: 'p0', shares: 1 }],
  isMultiPayer: false,
  splitMode: 'EVENLY',
  isReimbursement: false,
  documents: [],
  notes: undefined,
  recurrenceRule: 'NONE',
}

describe('expenseFormInputSchema', () => {
  it('validates required fields', () => {
    const result = expenseFormInputSchema.safeParse(baseInput)
    expect(result.success).toBe(true)
  })

  it('does not report zero shares while the amount itself is zero', () => {
    const result = expenseFormInputSchema.safeParse({
      ...baseInput,
      amount: 0,
      paidByList: [{ participant: 'p0', shares: 0 }],
      paidFor: [{ participant: 'p0', shares: 0 }],
    })

    expect(result.success).toBe(false)
    if (result.success) return
    expect(
      result.error.issues.some((issue) => issue.message === 'amountNotZero'),
    ).toBe(true)
    expect(
      result.error.issues.some((issue) => issue.message === 'noZeroShares'),
    ).toBe(false)
  })

  it('allows valid recurring rules', () => {
    const result = expenseFormInputSchema.safeParse({
      ...baseInput,
      recurrenceRule: 'MONTHLY',
    })
    expect(result.success).toBe(true)
  })

  it('fails when title is missing', () => {
    const result = expenseFormInputSchema.safeParse({
      ...baseInput,
      title: undefined,
    })
    expect(result.success).toBe(false)
  })

  it('rejects invalid split mode', () => {
    const result = expenseFormInputSchema.safeParse({
      ...baseInput,
      splitMode: 'INVALID_MODE',
    })
    expect(result.success).toBe(false)
  })

  it('BY_PERCENTAGE: requires display percentages that sum to 100 within drift', () => {
    // sum < 100 (60 + 30 = 90)
    const less = expenseFormInputSchema.safeParse({
      ...baseInput,
      splitMode: 'BY_PERCENTAGE',
      paidFor: [
        { participant: 'p0', shares: 60 },
        { participant: 'p1', shares: 30 },
      ],
    })
    expect(less.success).toBe(false)

    // sum > 100 (60 + 50 = 110)
    const more = expenseFormInputSchema.safeParse({
      ...baseInput,
      splitMode: 'BY_PERCENTAGE',
      paidFor: [
        { participant: 'p0', shares: 60 },
        { participant: 'p1', shares: 50 },
      ],
    })
    expect(more.success).toBe(false)

    // sum == 100 (60 + 40 = 100)
    const ok = expenseFormInputSchema.safeParse({
      ...baseInput,
      splitMode: 'BY_PERCENTAGE',
      paidFor: [
        { participant: 'p0', shares: 60 },
        { participant: 'p1', shares: 40 },
      ],
    })
    expect(ok.success).toBe(true)
  })

  it('BY_AMOUNT: requires major-unit shares that sum to amount', () => {
    // sum < amount (3 + 4 = 7 < 10)
    const less = expenseFormInputSchema.safeParse({
      ...baseInput,
      amount: 10,
      splitMode: 'BY_AMOUNT',
      paidFor: [
        { participant: 'p0', shares: 3 },
        { participant: 'p1', shares: 4 },
      ],
    })
    expect(less.success).toBe(false)

    // sum > amount (6 + 7 = 13 > 10)
    const more = expenseFormInputSchema.safeParse({
      ...baseInput,
      amount: 10,
      splitMode: 'BY_AMOUNT',
      paidFor: [
        { participant: 'p0', shares: 6 },
        { participant: 'p1', shares: 7 },
      ],
    })
    expect(more.success).toBe(false)

    // sum == amount (6 + 4 = 10)
    const ok = expenseFormInputSchema.safeParse({
      ...baseInput,
      amount: 10,
      splitMode: 'BY_AMOUNT',
      paidFor: [
        { participant: 'p0', shares: 6 },
        { participant: 'p1', shares: 4 },
      ],
    })
    expect(ok.success).toBe(true)
  })

  it('BY_PERCENTAGE: accepts percentages with sub-percent precision (within ±0.01 drift)', () => {
    // 33.33 + 33.33 + 33.34 = 100 within tolerance
    const result = expenseFormInputSchema.safeParse({
      ...baseInput,
      splitMode: 'BY_PERCENTAGE',
      paidFor: [
        { participant: 'p0', shares: 33.33 },
        { participant: 'p1', shares: 33.33 },
        { participant: 'p2', shares: 33.34 },
      ],
    })
    expect(result.success).toBe(true)
  })

  it('BY_AMOUNT: accepts decimal major-unit amounts and shares', () => {
    const result = expenseFormInputSchema.safeParse({
      ...baseInput,
      amount: 12.5,
      splitMode: 'BY_AMOUNT',
      paidFor: [
        { participant: 'p0', shares: 5 },
        { participant: 'p1', shares: 7.5 },
      ],
    })
    expect(result.success).toBe(true)
  })

  it('coerces string shares to numbers (lets BY_AMOUNT inputs keep in-progress decimals like "10.")', () => {
    const result = expenseFormInputSchema.safeParse({
      ...baseInput,
      paidFor: [{ participant: 'p0', shares: '1.5' as unknown as number }],
    })
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.paidFor[0]?.shares).toBe(1.5)
  })

  it('preserves display percentages verbatim — no x100 transform', () => {
    const result = expenseFormInputSchema.safeParse({
      ...baseInput,
      splitMode: 'BY_PERCENTAGE',
      paidFor: [
        { participant: 'p0', shares: 70 },
        { participant: 'p1', shares: 30 },
      ],
    })
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.paidFor).toEqual([
      { participant: 'p0', shares: 70 },
      { participant: 'p1', shares: 30 },
    ])
  })
})

describe('expenseApiSchema', () => {
  it('validates required fields', () => {
    const result = expenseApiSchema.safeParse(baseApi)
    expect(result.success).toBe(true)
  })

  it('allows valid recurring rules', () => {
    const result = expenseApiSchema.safeParse({
      ...baseApi,
      recurrenceRule: 'MONTHLY',
    })
    expect(result.success).toBe(true)
  })

  it('fails when title is missing', () => {
    const result = expenseApiSchema.safeParse({
      ...baseApi,
      title: undefined,
    })
    expect(result.success).toBe(false)
  })

  it('rejects invalid split mode', () => {
    const result = expenseApiSchema.safeParse({
      ...baseApi,
      splitMode: 'INVALID_MODE',
    })
    expect(result.success).toBe(false)
  })

  it('BY_PERCENTAGE: requires basis points summing to 10000', () => {
    const less = expenseApiSchema.safeParse({
      ...baseApi,
      splitMode: 'BY_PERCENTAGE',
      paidFor: [
        { participant: 'p0', shares: 6000 },
        { participant: 'p1', shares: 3000 },
      ],
    })
    expect(less.success).toBe(false)

    const more = expenseApiSchema.safeParse({
      ...baseApi,
      splitMode: 'BY_PERCENTAGE',
      paidFor: [
        { participant: 'p0', shares: 6000 },
        { participant: 'p1', shares: 5000 },
      ],
    })
    expect(more.success).toBe(false)

    const ok = expenseApiSchema.safeParse({
      ...baseApi,
      splitMode: 'BY_PERCENTAGE',
      paidFor: [
        { participant: 'p0', shares: 7000 },
        { participant: 'p1', shares: 3000 },
      ],
    })
    expect(ok.success).toBe(true)
  })

  it('BY_PERCENTAGE: rejects display percentages (60) that look like they should be basis points (6000)', () => {
    // 60 + 40 = 100, not 10000 — schema rejects as basis points underflow.
    const result = expenseApiSchema.safeParse({
      ...baseApi,
      splitMode: 'BY_PERCENTAGE',
      paidFor: [
        { participant: 'p0', shares: 60 },
        { participant: 'p1', shares: 40 },
      ],
    })
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error.issues[0].message).toBe('percentageSum')
  })

  it('BY_AMOUNT: requires integer-cent shares summing to amount', () => {
    const less = expenseApiSchema.safeParse({
      ...baseApi,
      amount: 1000,
      splitMode: 'BY_AMOUNT',
      paidFor: [
        { participant: 'p0', shares: 300 },
        { participant: 'p1', shares: 400 },
      ],
    })
    expect(less.success).toBe(false)

    const more = expenseApiSchema.safeParse({
      ...baseApi,
      amount: 1000,
      splitMode: 'BY_AMOUNT',
      paidFor: [
        { participant: 'p0', shares: 600 },
        { participant: 'p1', shares: 700 },
      ],
    })
    expect(more.success).toBe(false)

    const ok = expenseApiSchema.safeParse({
      ...baseApi,
      amount: 1000,
      splitMode: 'BY_AMOUNT',
      paidFor: [
        { participant: 'p0', shares: 600 },
        { participant: 'p1', shares: 400 },
      ],
    })
    expect(ok.success).toBe(true)
  })

  it('BY_AMOUNT: rejects display-major-unit shares (sum 12.5 ≠ amount 1000)', () => {
    const result = expenseApiSchema.safeParse({
      ...baseApi,
      amount: 1000,
      splitMode: 'BY_AMOUNT',
      paidFor: [
        { participant: 'p0', shares: 7 },
        { participant: 'p1', shares: 5 },
      ],
    })
    expect(result.success).toBe(false)
  })

  it('rejects string shares outright', () => {
    const result = expenseApiSchema.safeParse({
      ...baseApi,
      paidFor: [{ participant: 'p0', shares: '1' as unknown as number }],
    })
    expect(result.success).toBe(false)
  })

  it('rejects non-integer shares (basis points / cents must be integers)', () => {
    const result = expenseApiSchema.safeParse({
      ...baseApi,
      paidFor: [{ participant: 'p0', shares: 1.5 }],
    })
    expect(result.success).toBe(false)
  })
})

describe('paidByList signed and migrated shapes', () => {
  it('expenseFormInputSchema: negative income expense with signed payer shares validates', () => {
    // amount is negative, paidByList shares are negative.
    // Sum (-7 + -3 = -10) must equal amount (-10) in major units.
    const result = expenseFormInputSchema.safeParse({
      ...baseInput,
      amount: -10,
      paidBySplitMode: 'BY_AMOUNT',
      paidByList: [
        { participant: 'p0', shares: -7 },
        { participant: 'p1', shares: -3 },
      ],
    })
    expect(result.success).toBe(true)
  })

  it('expenseFormInputSchema: positive expense with negative payer shares fails the sum check', () => {
    const result = expenseFormInputSchema.safeParse({
      ...baseInput,
      amount: 10,
      paidBySplitMode: 'BY_AMOUNT',
      paidByList: [
        { participant: 'p0', shares: -7 },
        { participant: 'p1', shares: -3 },
      ],
    })
    expect(result.success).toBe(false)
    if (result.success) return
    expect(
      result.error.issues.some((i) => i.message === 'paidByAmountSum'),
    ).toBe(true)
  })

  it('same-currency: absent conversion validates paidBy against amount', () => {
    const ok = expenseApiSchema.safeParse({
      ...baseApi,
      amount: 1000,
      paidBySplitMode: 'BY_AMOUNT',
      paidByList: [{ participant: 'p0', shares: 1000 }],
    })
    expect(ok.success).toBe(true)
  })

  it('cross-currency: paidBy shares must sum to expense-currency amount', () => {
    // amount is expense-currency input; shares must match amount (not ledger).
    const result = expenseApiSchema.safeParse({
      ...baseApi,
      amount: 10000,
      conversion: { type: 'custom', currency: 'USD', rate: 0.92 },
      paidBySplitMode: 'BY_AMOUNT',
      paidByList: [{ participant: 'p0', shares: 9200 }],
    })
    expect(result.success).toBe(false)
    if (result.success) return
    expect(
      result.error.issues.some((i) => i.message === 'paidByAmountSum'),
    ).toBe(true)
  })
})

describe('cross-currency paidByList BY_AMOUNT', () => {
  it('expenseApiSchema: custom conversion with shares summing to amount is valid', () => {
    const result = expenseApiSchema.safeParse({
      ...baseApi,
      amount: 1000,
      conversion: { type: 'custom', currency: 'EUR', rate: 61 },
      paidBySplitMode: 'BY_AMOUNT',
      paidByList: [{ participant: 'p0', shares: 1000 }],
    })
    expect(result.success).toBe(true)
  })

  it('expenseApiSchema: custom conversion with shares not summing to amount is invalid', () => {
    const result = expenseApiSchema.safeParse({
      ...baseApi,
      amount: 1000,
      conversion: { type: 'custom', currency: 'EUR', rate: 61 },
      paidBySplitMode: 'BY_AMOUNT',
      paidByList: [{ participant: 'p0', shares: 100 }],
    })
    expect(result.success).toBe(false)
    if (result.success) return
    expect(
      result.error.issues.some((i) => i.message === 'paidByAmountSum'),
    ).toBe(true)
  })

  it('expenseApiSchema: absent conversion validates against amount', () => {
    const result = expenseApiSchema.safeParse({
      ...baseApi,
      amount: 1000,
      paidBySplitMode: 'BY_AMOUNT',
      paidByList: [{ participant: 'p0', shares: 1000 }],
    })
    expect(result.success).toBe(true)
  })

  it('expenseApiSchema: validates converted itemized items against amount', () => {
    const result = expenseApiSchema.safeParse({
      ...baseApi,
      amount: 20100,
      conversion: { type: 'custom', currency: 'ARS', rate: 0.00059 },
      splitMode: 'ITEMIZED',
      paidFor: [{ participant: 'p0', shares: 20100 }],
      items: [
        {
          title: 'beer',
          unitPrice: 1,
          quantity: 100,
          amount: 100,
          splitMode: 'EVENLY',
          paidFor: [{ participant: 'p0', shares: 1 }],
        },
      ],
    })

    expect(result.success).toBe(true)
  })
})

describe('groupFormSchema', () => {
  it('validates group creation', () => {
    const result = groupFormSchema.safeParse({
      name: 'Weekend Trip',
      information: 'Beach vacation',
      currency: '$',
      currencyCode: 'USD',
      participants: [{ name: 'Alice' }, { name: 'Bob' }],
    })

    expect(result.success).toBe(true)
  })

  it('requires at least 1 participant (business logic requires 2)', () => {
    // Single participant passes schema validation
    const resultOne = groupFormSchema.safeParse({
      name: 'Solo Trip',
      currency: '$',
      currencyCode: 'USD',
      participants: [{ name: 'Alice' }],
    })

    expect(resultOne.success).toBe(true) // Current behavior

    // Zero participants fails
    const resultZero = groupFormSchema.safeParse({
      name: 'Trip',
      currency: '$',
      currencyCode: 'USD',
      participants: [],
    })

    expect(resultZero.success).toBe(false)

    // Note: Business logic should enforce 2+ participants
    // This test documents current schema behavior
  })
})

// ── friendFormSchema tests ─────────────────────────────────────────
describe('friendFormSchema', () => {
  it('accepts exactly peerAccountId mode — only peerAccountId + currency set, validates successfully', () => {
    const result = friendFormSchema.safeParse({
      peerAccountId: 'some-account-id',
      currency: '$',
    })
    expect(result.success).toBe(true)
  })

  it('accepts exactly peerEmail mode — only peerEmail + currency set, validates successfully', () => {
    const result = friendFormSchema.safeParse({
      peerEmail: 'friend@example.com',
      currency: '$',
    })
    expect(result.success).toBe(true)
  })

  it('accepts exactly useLink mode — useLink + temporaryName + currency set, validates successfully', () => {
    const result = friendFormSchema.safeParse({
      useLink: true,
      temporaryName: 'Bob',
      currency: '$',
    })
    expect(result.success).toBe(true)
  })

  it('rejects 0 modes — none of peerAccountId/peerEmail/useLink set, fails superRefine', () => {
    const result = friendFormSchema.safeParse({
      currency: '$',
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0].message).toBe(
        'Select exactly one: a friend, an email, or a shareable link.',
      )
    }
  })

  it('rejects 2+ modes — peerAccountId and peerEmail both set, fails superRefine', () => {
    const result = friendFormSchema.safeParse({
      peerAccountId: 'some-account-id',
      peerEmail: 'friend@example.com',
      currency: '$',
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0].message).toBe(
        'Select exactly one: a friend, an email, or a shareable link.',
      )
    }
  })

  it('rejects 2+ modes — peerAccountId and useLink both set, fails superRefine', () => {
    const result = friendFormSchema.safeParse({
      peerAccountId: 'some-account-id',
      useLink: true,
      currency: '$',
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0].message).toBe(
        'Select exactly one: a friend, an email, or a shareable link.',
      )
    }
  })

  it('rejects 2+ modes — peerEmail and useLink both set, fails superRefine', () => {
    const result = friendFormSchema.safeParse({
      peerEmail: 'friend@example.com',
      useLink: true,
      currency: '$',
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0].message).toBe(
        'Select exactly one: a friend, an email, or a shareable link.',
      )
    }
  })

  it('rejects 3 modes — all three set, fails superRefine', () => {
    const result = friendFormSchema.safeParse({
      peerAccountId: 'some-account-id',
      peerEmail: 'friend@example.com',
      useLink: true,
      currency: '$',
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0].message).toBe(
        'Select exactly one: a friend, an email, or a shareable link.',
      )
    }
  })

  it('rejects invalid email format in peerEmail', () => {
    const result = friendFormSchema.safeParse({
      peerAccountId: 'some-account-id',
      peerEmail: 'not-an-email',
      currency: '$',
    })
    expect(result.success).toBe(false)
  })

  it('accepts valid email format in peerEmail', () => {
    const result = friendFormSchema.safeParse({
      peerEmail: 'user@example.com',
      currency: '$',
    })
    expect(result.success).toBe(true)
  })

  it('rejects empty temporaryName (min 1)', () => {
    const empty = friendFormSchema.safeParse({
      peerAccountId: 'some-account-id',
      currency: '$',
      temporaryName: '',
    })
    expect(empty.success).toBe(false)

    const whitespace = friendFormSchema.safeParse({
      peerAccountId: 'some-account-id',
      currency: '$',
      temporaryName: '   ',
    })
    expect(whitespace.success).toBe(false)
  })

  it('rejects temporaryName > 120 chars', () => {
    const result = friendFormSchema.safeParse({
      peerAccountId: 'some-account-id',
      currency: '$',
      temporaryName: 'a'.repeat(121),
    })
    expect(result.success).toBe(false)
  })

  it('accepts temporaryName within limits', () => {
    const result = friendFormSchema.safeParse({
      peerAccountId: 'some-account-id',
      currency: '$',
      temporaryName: 'Roommate',
    })
    expect(result.success).toBe(true)
  })

  it('useLink without temporaryName fails validation', () => {
    const result = friendFormSchema.safeParse({
      useLink: true,
      currency: '$',
      temporaryName: '',
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(
        result.error.issues.some(
          (i) =>
            i.path.includes('temporaryName') &&
            i.message === 'temporaryName is required for link invites',
        ),
      ).toBe(true)
    }
  })

  it('useLink with valid temporaryName passes validation', () => {
    const result = friendFormSchema.safeParse({
      useLink: true,
      currency: '$',
      temporaryName: 'Bob',
    })
    expect(result.success).toBe(true)
  })

  it('peerEmail without temporaryName passes validation (email is auto-used as temp name)', () => {
    const result = friendFormSchema.safeParse({
      peerEmail: 'friend@example.com',
      currency: '$',
    })
    expect(result.success).toBe(true)
  })

  it('rejects missing currency (required field)', () => {
    const result = friendFormSchema.safeParse({
      peerAccountId: 'some-account-id',
    })
    expect(result.success).toBe(false)
  })

  it('accepts optional currencyCode and information', () => {
    const result = friendFormSchema.safeParse({
      peerAccountId: 'some-account-id',
      currency: '$',
      currencyCode: 'USD',
      information: 'Notes',
    })
    expect(result.success).toBe(true)
  })
})
