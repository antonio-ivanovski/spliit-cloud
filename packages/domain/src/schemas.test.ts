import {
  expenseApiSchema,
  expenseFormInputSchema,
  groupFormSchema,
} from './schemas'

const baseInput = {
  expenseDate: new Date('2025-01-01T00:00:00.000Z'),
  title: 'Dinner',
  category: 'general',
  amount: 10,
  originalAmount: undefined,
  originalCurrency: '',
  conversionRate: undefined,
  paidBySplitMode: 'EVENLY',
  paidByList: [{ participant: 'p0', shares: 1 }],
  paidFor: [{ participant: 'p0', shares: 1 }],
  isMultiPayer: false,
  splitMode: 'EVENLY',
  saveDefaultSplittingOptions: false,
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
  originalAmount: undefined,
  originalCurrency: '',
  conversionRate: undefined,
  paidBySplitMode: 'EVENLY',
  paidByList: [{ participant: 'p0', shares: 1 }],
  paidFor: [{ participant: 'p0', shares: 1 }],
  isMultiPayer: false,
  splitMode: 'EVENLY',
  saveDefaultSplittingOptions: false,
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

  it("rejects string shares outright (form-coercion is the form schema's job, not this one)", () => {
    const result = expenseFormInputSchema.safeParse({
      ...baseInput,
      paidFor: [{ participant: 'p0', shares: '1' as unknown as number }],
    })
    expect(result.success).toBe(false)
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
      originalAmount: -10,
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

  it('same-currency migrated shape: originalAmount set, originalCurrency null, validates against amount', () => {
    // Both `null` and `''` originalCurrency are valid single-currency paths.
    const ok = expenseApiSchema.safeParse({
      ...baseApi,
      amount: 1000,
      originalAmount: 1000,
      originalCurrency: null,
      paidBySplitMode: 'BY_AMOUNT',
      paidByList: [{ participant: 'p0', shares: 1000 }],
    })
    expect(ok.success).toBe(true)

    const okEmpty = expenseApiSchema.safeParse({
      ...baseApi,
      amount: 1000,
      originalAmount: 1000,
      originalCurrency: '',
      paidBySplitMode: 'BY_AMOUNT',
      paidByList: [{ participant: 'p0', shares: 1000 }],
    })
    expect(okEmpty.success).toBe(true)
  })

  it('cross-currency: sum matching amount but not originalAmount is invalid', () => {
    // Locks in that, when originalCurrency is set, the BY_AMOUNT sum is
    // checked against originalAmount (not amount).
    const result = expenseApiSchema.safeParse({
      ...baseApi,
      amount: 9200,
      originalAmount: 10000,
      originalCurrency: 'USD',
      conversionRate: 0.92,
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
  it('expenseApiSchema: with originalCurrency and shares summing to originalAmount is valid', () => {
    const result = expenseApiSchema.safeParse({
      ...baseApi,
      amount: 61000,
      originalAmount: 1000,
      originalCurrency: 'EUR',
      conversionRate: 61,
      paidBySplitMode: 'BY_AMOUNT',
      paidByList: [{ participant: 'p0', shares: 1000 }],
    })
    expect(result.success).toBe(true)
  })

  it('expenseApiSchema: with originalCurrency and shares not summing to originalAmount is invalid', () => {
    const result = expenseApiSchema.safeParse({
      ...baseApi,
      amount: 61000,
      originalAmount: 1000,
      originalCurrency: 'EUR',
      conversionRate: 61,
      paidBySplitMode: 'BY_AMOUNT',
      paidByList: [{ participant: 'p0', shares: 100 }],
    })
    expect(result.success).toBe(false)
    if (result.success) return
    expect(
      result.error.issues.some((i) => i.message === 'paidByAmountSum'),
    ).toBe(true)
  })

  it('expenseApiSchema: with NO originalCurrency validates against amount', () => {
    const result = expenseApiSchema.safeParse({
      ...baseApi,
      amount: 1000,
      paidBySplitMode: 'BY_AMOUNT',
      paidByList: [{ participant: 'p0', shares: 1000 }],
    })
    expect(result.success).toBe(true)
  })

  it('expenseApiSchema: validates converted itemized items against originalAmount', () => {
    const result = expenseApiSchema.safeParse({
      ...baseApi,
      amount: 12,
      originalAmount: 20100,
      originalCurrency: 'ARS',
      conversionRate: 0.00059,
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
