import { expenseFormSchema, groupFormSchema } from './schemas'

describe('expenseFormSchema', () => {
  it('validates required fields', () => {
    const result = expenseFormSchema.safeParse({
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
      splitMode: 'EVENLY',
      saveDefaultSplittingOptions: false,
      isReimbursement: false,
      documents: [],
      notes: undefined,
      recurrenceRule: 'NONE',
    })

    expect(result.success).toBe(true)
  })

  it('allows valid recurring rules', () => {
    const result = expenseFormSchema.safeParse({
      expenseDate: new Date('2025-01-01T00:00:00.000Z'),
      title: 'Rent',
      category: 'general',
      amount: 1000,
      originalAmount: undefined,
      originalCurrency: '',
      conversionRate: undefined,
      paidBySplitMode: 'EVENLY',
      paidByList: [{ participant: 'p0', shares: 1 }],
      paidFor: [{ participant: 'p0', shares: 1 }],
      splitMode: 'EVENLY',
      saveDefaultSplittingOptions: false,
      isReimbursement: false,
      documents: [],
      notes: undefined,
      recurrenceRule: 'MONTHLY',
    })

    expect(result.success).toBe(true)
  })

  it('fails when title is missing', () => {
    const result = expenseFormSchema.safeParse({
      expenseDate: new Date('2025-01-01T00:00:00.000Z'),
      category: 'general',
      amount: 1000,
      originalCurrency: '',
      paidBySplitMode: 'EVENLY',
      paidByList: [{ participant: 'p0', shares: 1 }],
      paidFor: [{ participant: 'p0', shares: 1 }],
      splitMode: 'EVENLY',
      saveDefaultSplittingOptions: false,
      isReimbursement: false,
      documents: [],
      recurrenceRule: 'NONE',
    })

    expect(result.success).toBe(false)
  })

  it('rejects invalid split mode', () => {
    const result = expenseFormSchema.safeParse({
      expenseDate: new Date('2025-01-01T00:00:00.000Z'),
      title: 'Dinner',
      category: 'general',
      amount: 1000,
      paidBySplitMode: 'EVENLY',
      paidByList: [{ participant: 'p0', shares: 1 }],
      paidFor: [{ participant: 'p0', shares: 1 }],
      splitMode: 'INVALID_MODE',
      saveDefaultSplittingOptions: false,
      isReimbursement: false,
      documents: [],
      recurrenceRule: 'NONE',
    })

    expect(result.success).toBe(false)
  })

  it('validates currency format', () => {
    const valid = groupFormSchema.safeParse({
      name: 'Trip',
      information: undefined,
      currency: '€',
      currencyCode: 'EUR',
      participants: [{ name: 'Alice' }],
    })

    expect(valid.success).toBe(true)

    const invalid = groupFormSchema.safeParse({
      name: 'Trip',
      information: undefined,
      currency: 'TOO_LONG',
      currencyCode: 'EUR',
      participants: [{ name: 'Alice' }],
    })

    expect(invalid.success).toBe(false)
  })

  it('validates percentage sums to 100%', () => {
    // Invalid: sum < 100% (2500 + 3000 = 5500 = 55%)
    const resultLess = expenseFormSchema.safeParse({
      expenseDate: new Date('2025-01-01T00:00:00.000Z'),
      title: 'Dinner',
      category: 'general',
      amount: 1000,
      paidBySplitMode: 'EVENLY',
      paidByList: [{ participant: 'p0', shares: 1 }],
      paidFor: [
        { participant: 'p0', shares: 2500 },
        { participant: 'p1', shares: 3000 },
      ],
      splitMode: 'BY_PERCENTAGE',
      saveDefaultSplittingOptions: false,
      isReimbursement: false,
      documents: [],
      recurrenceRule: 'NONE',
    })

    expect(resultLess.success).toBe(false)

    // Invalid: sum > 100% (6000 + 5000 = 11000 = 110%)
    const resultMore = expenseFormSchema.safeParse({
      expenseDate: new Date('2025-01-01T00:00:00.000Z'),
      title: 'Dinner',
      category: 'general',
      amount: 1000,
      paidBySplitMode: 'EVENLY',
      paidByList: [{ participant: 'p0', shares: 1 }],
      paidFor: [
        { participant: 'p0', shares: 6000 },
        { participant: 'p1', shares: 5000 },
      ],
      splitMode: 'BY_PERCENTAGE',
      saveDefaultSplittingOptions: false,
      isReimbursement: false,
      documents: [],
      recurrenceRule: 'NONE',
    })

    expect(resultMore.success).toBe(false)

    // Valid: sum = 100% (7000 + 3000 = 10000 = 100%)
    const resultValid = expenseFormSchema.safeParse({
      expenseDate: new Date('2025-01-01T00:00:00.000Z'),
      title: 'Dinner',
      category: 'general',
      amount: 1000,
      paidBySplitMode: 'EVENLY',
      paidByList: [{ participant: 'p0', shares: 1 }],
      paidFor: [
        { participant: 'p0', shares: 7000 },
        { participant: 'p1', shares: 3000 },
      ],
      splitMode: 'BY_PERCENTAGE',
      saveDefaultSplittingOptions: false,
      isReimbursement: false,
      documents: [],
      recurrenceRule: 'NONE',
    })

    expect(resultValid.success).toBe(true)
  })

  it('rejects BY_PERCENTAGE shares sent as strings of basis points', () => {
    // Regression: the import wizard used to send shares as strings of
    // basis points (e.g. "3000" for 30%). The schema's string branch
    // multiplies by 100, so this doubled the values and tripped the
    // percentageSum check. The wizard now sends numbers.
    const result = expenseFormSchema.safeParse({
      expenseDate: new Date('2025-01-01T00:00:00.000Z'),
      title: 'Dinner',
      category: 'general',
      amount: 1000,
      paidBySplitMode: 'EVENLY',
      paidByList: [{ participant: 'p0', shares: 1 }],
      paidFor: [
        { participant: 'p0', shares: '7000' },
        { participant: 'p1', shares: '3000' },
      ],
      splitMode: 'BY_PERCENTAGE',
      saveDefaultSplittingOptions: false,
      isReimbursement: false,
      documents: [],
      recurrenceRule: 'NONE',
    })

    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error.issues[0].message).toBe('percentageSum')
  })

  it('passes BY_PERCENTAGE shares sent as numbers in basis points', () => {
    // The wizard contract: shares are already in basis points
    // (3000 = 30%). The schema must accept this directly.
    const result = expenseFormSchema.safeParse({
      expenseDate: new Date('2025-01-01T00:00:00.000Z'),
      title: 'Dinner',
      category: 'general',
      amount: 1000,
      paidBySplitMode: 'EVENLY',
      paidByList: [{ participant: 'p0', shares: 1 }],
      paidFor: [
        { participant: 'p0', shares: 7000 },
        { participant: 'p1', shares: 3000 },
      ],
      splitMode: 'BY_PERCENTAGE',
      saveDefaultSplittingOptions: false,
      isReimbursement: false,
      documents: [],
      recurrenceRule: 'NONE',
    })

    expect(result.success).toBe(true)
  })

  it('validates amount sum equals total', () => {
    // Invalid: sum < total (300 + 400 = 700 < 1000)
    const resultLess = expenseFormSchema.safeParse({
      expenseDate: new Date('2025-01-01T00:00:00.000Z'),
      title: 'Dinner',
      category: 'general',
      amount: 1000,
      paidBySplitMode: 'EVENLY',
      paidByList: [{ participant: 'p0', shares: 1 }],
      paidFor: [
        { participant: 'p0', shares: 300 },
        { participant: 'p1', shares: 400 },
      ],
      splitMode: 'BY_AMOUNT',
      saveDefaultSplittingOptions: false,
      isReimbursement: false,
      documents: [],
      recurrenceRule: 'NONE',
    })

    expect(resultLess.success).toBe(false)

    // Invalid: sum > total (600 + 700 = 1300 > 1000)
    const resultMore = expenseFormSchema.safeParse({
      expenseDate: new Date('2025-01-01T00:00:00.000Z'),
      title: 'Dinner',
      category: 'general',
      amount: 1000,
      paidBySplitMode: 'EVENLY',
      paidByList: [{ participant: 'p0', shares: 1 }],
      paidFor: [
        { participant: 'p0', shares: 600 },
        { participant: 'p1', shares: 700 },
      ],
      splitMode: 'BY_AMOUNT',
      saveDefaultSplittingOptions: false,
      isReimbursement: false,
      documents: [],
      recurrenceRule: 'NONE',
    })

    expect(resultMore.success).toBe(false)

    // Valid: sum = total (600 + 400 = 1000)
    const resultValid = expenseFormSchema.safeParse({
      expenseDate: new Date('2025-01-01T00:00:00.000Z'),
      title: 'Dinner',
      category: 'general',
      amount: 1000,
      paidBySplitMode: 'EVENLY',
      paidByList: [{ participant: 'p0', shares: 1 }],
      paidFor: [
        { participant: 'p0', shares: 600 },
        { participant: 'p1', shares: 400 },
      ],
      splitMode: 'BY_AMOUNT',
      saveDefaultSplittingOptions: false,
      isReimbursement: false,
      documents: [],
      recurrenceRule: 'NONE',
    })

    expect(resultValid.success).toBe(true)
  })

  // ---------------------------------------------------------------------------
  // Phase 1b: paidByList shares are in originalCurrency when set; the
  // BY_AMOUNT sum must therefore be validated against originalAmount
  // (falling back to amount when originalCurrency is absent).
  // ---------------------------------------------------------------------------

  it('paidByList BY_AMOUNT rejects mismatched sum against originalAmount', () => {
    // Group EUR, paid USD $100 (10000 USD cents). Shares 7000 + 2000 = 9000 ≠ 10000.
    const result = expenseFormSchema.safeParse({
      expenseDate: new Date('2025-01-01T00:00:00.000Z'),
      title: 'Dinner',
      category: 'general',
      amount: 9200,
      originalAmount: 10000,
      originalCurrency: 'USD',
      conversionRate: 0.92,
      paidBySplitMode: 'BY_AMOUNT',
      paidByList: [
        { participant: 'p0', shares: 7000 },
        { participant: 'p1', shares: 2000 },
      ],
      paidFor: [{ participant: 'p0', shares: 1 }],
      splitMode: 'EVENLY',
      saveDefaultSplittingOptions: false,
      isReimbursement: false,
      documents: [],
      recurrenceRule: 'NONE',
    })

    expect(result.success).toBe(false)
    if (result.success) return
    expect(
      result.error.issues.some((i) => i.message === 'paidByAmountSum'),
    ).toBe(true)
  })

  it('paidByList BY_AMOUNT accepts sum equal to originalAmount', () => {
    // Group EUR, paid USD $100 (10000 USD cents). Shares 7000 + 3000 = 10000 ✓.
    const result = expenseFormSchema.safeParse({
      expenseDate: new Date('2025-01-01T00:00:00.000Z'),
      title: 'Dinner',
      category: 'general',
      amount: 9200,
      originalAmount: 10000,
      originalCurrency: 'USD',
      conversionRate: 0.92,
      paidBySplitMode: 'BY_AMOUNT',
      paidByList: [
        { participant: 'p0', shares: 7000 },
        { participant: 'p1', shares: 3000 },
      ],
      paidFor: [{ participant: 'p0', shares: 1 }],
      splitMode: 'EVENLY',
      saveDefaultSplittingOptions: false,
      isReimbursement: false,
      documents: [],
      recurrenceRule: 'NONE',
    })

    expect(result.success).toBe(true)
  })

  it('paidByList BY_AMOUNT validates against amount when originalAmount is null', () => {
    // Single-currency path: no originalCurrency set, so the sum is
    // checked against amount (existing Phase 1 behavior preserved).
    const mismatch = expenseFormSchema.safeParse({
      expenseDate: new Date('2025-01-01T00:00:00.000Z'),
      title: 'Dinner',
      category: 'general',
      amount: 1000,
      paidBySplitMode: 'BY_AMOUNT',
      paidByList: [
        { participant: 'p0', shares: 700 },
        { participant: 'p1', shares: 200 },
      ],
      paidFor: [{ participant: 'p0', shares: 1 }],
      splitMode: 'EVENLY',
      saveDefaultSplittingOptions: false,
      isReimbursement: false,
      documents: [],
      recurrenceRule: 'NONE',
    })
    expect(mismatch.success).toBe(false)

    const matches = expenseFormSchema.safeParse({
      expenseDate: new Date('2025-01-01T00:00:00.000Z'),
      title: 'Dinner',
      category: 'general',
      amount: 1000,
      paidBySplitMode: 'BY_AMOUNT',
      paidByList: [
        { participant: 'p0', shares: 700 },
        { participant: 'p1', shares: 300 },
      ],
      paidFor: [{ participant: 'p0', shares: 1 }],
      splitMode: 'EVENLY',
      saveDefaultSplittingOptions: false,
      isReimbursement: false,
      documents: [],
      recurrenceRule: 'NONE',
    })
    expect(matches.success).toBe(true)
  })
})

describe('expenseFormSchema paidByList signed and migrated shapes', () => {
  it('negative income expense with signed payer shares validates', () => {
    // Negative-income flow: amount is negative, and each paidBy share is
    // also negative. The sum (-700 + -300 = -1000) must equal amount.
    const result = expenseFormSchema.safeParse({
      expenseDate: new Date('2025-01-01T00:00:00.000Z'),
      title: 'Refund',
      category: 'general',
      amount: -1000,
      originalAmount: -1000,
      originalCurrency: '',
      paidBySplitMode: 'BY_AMOUNT',
      paidByList: [
        { participant: 'p0', shares: -700 },
        { participant: 'p1', shares: -300 },
      ],
      paidFor: [{ participant: 'p0', shares: 1 }],
      splitMode: 'EVENLY',
      saveDefaultSplittingOptions: false,
      isReimbursement: false,
      documents: [],
      recurrenceRule: 'NONE',
    })

    expect(result.success).toBe(true)
  })

  it('positive expense with negative payer shares fails the sum check', () => {
    // Same negative shares as above, but amount is positive, so the sum
    // (-1000) cannot equal amount (1000). The inner per-share sign check
    // must no longer reject this; the outer sum check should.
    const result = expenseFormSchema.safeParse({
      expenseDate: new Date('2025-01-01T00:00:00.000Z'),
      title: 'Dinner',
      category: 'general',
      amount: 1000,
      originalCurrency: '',
      paidBySplitMode: 'BY_AMOUNT',
      paidByList: [
        { participant: 'p0', shares: -700 },
        { participant: 'p1', shares: -300 },
      ],
      paidFor: [{ participant: 'p0', shares: 1 }],
      splitMode: 'EVENLY',
      saveDefaultSplittingOptions: false,
      isReimbursement: false,
      documents: [],
      recurrenceRule: 'NONE',
    })

    expect(result.success).toBe(false)
    if (result.success) return
    expect(
      result.error.issues.some((i) => i.message === 'paidByAmountSum'),
    ).toBe(true)
  })

  it('same-currency migrated shape: originalAmount set, originalCurrency null, validates against amount', () => {
    // Migrated single-currency shape: originalAmount is populated by the
    // migration but originalCurrency is null, so the BY_AMOUNT sum must be
    // checked against amount, not originalAmount.
    const ok = expenseFormSchema.safeParse({
      expenseDate: new Date('2025-01-01T00:00:00.000Z'),
      title: 'Dinner',
      category: 'general',
      amount: 1000,
      originalAmount: 1000,
      originalCurrency: null,
      paidBySplitMode: 'BY_AMOUNT',
      paidByList: [{ participant: 'p0', shares: 1000 }],
      paidFor: [{ participant: 'p0', shares: 1 }],
      splitMode: 'EVENLY',
      saveDefaultSplittingOptions: false,
      isReimbursement: false,
      documents: [],
      recurrenceRule: 'NONE',
    })
    expect(ok.success).toBe(true)

    // Same shape with originalCurrency '' (string) instead of null.
    const okEmpty = expenseFormSchema.safeParse({
      expenseDate: new Date('2025-01-01T00:00:00.000Z'),
      title: 'Dinner',
      category: 'general',
      amount: 1000,
      originalAmount: 1000,
      originalCurrency: '',
      paidBySplitMode: 'BY_AMOUNT',
      paidByList: [{ participant: 'p0', shares: 1000 }],
      paidFor: [{ participant: 'p0', shares: 1 }],
      splitMode: 'EVENLY',
      saveDefaultSplittingOptions: false,
      isReimbursement: false,
      documents: [],
      recurrenceRule: 'NONE',
    })
    expect(okEmpty.success).toBe(true)
  })

  it('same-currency migrated shape: originalAmount differs from amount and sum tracks amount', () => {
    // originalAmount is 2000 but originalCurrency is null, so we should
    // validate against amount (1000). A sum of 1000 matches amount and
    // is accepted even though it does not match originalAmount.
    const matchesAmount = expenseFormSchema.safeParse({
      expenseDate: new Date('2025-01-01T00:00:00.000Z'),
      title: 'Dinner',
      category: 'general',
      amount: 1000,
      originalAmount: 2000,
      originalCurrency: null,
      paidBySplitMode: 'BY_AMOUNT',
      paidByList: [{ participant: 'p0', shares: 1000 }],
      paidFor: [{ participant: 'p0', shares: 1 }],
      splitMode: 'EVENLY',
      saveDefaultSplittingOptions: false,
      isReimbursement: false,
      documents: [],
      recurrenceRule: 'NONE',
    })
    expect(matchesAmount.success).toBe(true)

    // A sum of 1000 matches amount but not originalAmount (2000); with
    // originalCurrency null the schema should accept the amount match.
    // Now a sum that matches neither amount nor originalAmount fails.
    const mismatchesBoth = expenseFormSchema.safeParse({
      expenseDate: new Date('2025-01-01T00:00:00.000Z'),
      title: 'Dinner',
      category: 'general',
      amount: 1000,
      originalAmount: 2000,
      originalCurrency: null,
      paidBySplitMode: 'BY_AMOUNT',
      paidByList: [{ participant: 'p0', shares: 1500 }],
      paidFor: [{ participant: 'p0', shares: 1 }],
      splitMode: 'EVENLY',
      saveDefaultSplittingOptions: false,
      isReimbursement: false,
      documents: [],
      recurrenceRule: 'NONE',
    })
    expect(mismatchesBoth.success).toBe(false)
    if (mismatchesBoth.success) return
    expect(
      mismatchesBoth.error.issues.some((i) => i.message === 'paidByAmountSum'),
    ).toBe(true)
  })

  it('cross-currency: sum matching amount but not originalAmount is invalid', () => {
    // Locks in that, when originalCurrency is set, the BY_AMOUNT sum is
    // checked against originalAmount (not amount).
    const result = expenseFormSchema.safeParse({
      expenseDate: new Date('2025-01-01T00:00:00.000Z'),
      title: 'Dinner',
      category: 'general',
      amount: 9200,
      originalAmount: 10000,
      originalCurrency: 'USD',
      conversionRate: 0.92,
      paidBySplitMode: 'BY_AMOUNT',
      paidByList: [{ participant: 'p0', shares: 9200 }],
      paidFor: [{ participant: 'p0', shares: 1 }],
      splitMode: 'EVENLY',
      saveDefaultSplittingOptions: false,
      isReimbursement: false,
      documents: [],
      recurrenceRule: 'NONE',
    })

    expect(result.success).toBe(false)
    if (result.success) return
    expect(
      result.error.issues.some((i) => i.message === 'paidByAmountSum'),
    ).toBe(true)
  })
})

describe('expenseFormSchema cross-currency paidByList BY_AMOUNT', () => {
  it('paidByList BY_AMOUNT with originalCurrency EUR and shares summing to originalAmount is valid', () => {
    const result = expenseFormSchema.safeParse({
      expenseDate: new Date('2025-01-01T00:00:00.000Z'),
      title: 'Dinner',
      category: 'general',
      amount: 61000,
      originalAmount: 1000,
      originalCurrency: 'EUR',
      conversionRate: 61,
      paidBySplitMode: 'BY_AMOUNT',
      paidByList: [{ participant: 'p0', shares: 1000 }],
      paidFor: [{ participant: 'p0', shares: 1 }],
      splitMode: 'EVENLY',
      saveDefaultSplittingOptions: false,
      isReimbursement: false,
      documents: [],
      recurrenceRule: 'NONE',
    })
    expect(result.success).toBe(true)
  })

  it('paidByList BY_AMOUNT with originalCurrency and shares not summing to originalAmount is invalid', () => {
    const result = expenseFormSchema.safeParse({
      expenseDate: new Date('2025-01-01T00:00:00.000Z'),
      title: 'Dinner',
      category: 'general',
      amount: 61000,
      originalAmount: 1000,
      originalCurrency: 'EUR',
      conversionRate: 61,
      paidBySplitMode: 'BY_AMOUNT',
      paidByList: [{ participant: 'p0', shares: 100 }],
      paidFor: [{ participant: 'p0', shares: 1 }],
      splitMode: 'EVENLY',
      saveDefaultSplittingOptions: false,
      isReimbursement: false,
      documents: [],
      recurrenceRule: 'NONE',
    })
    expect(result.success).toBe(false)
    if (result.success) return
    expect(
      result.error.issues.some((i) => i.message === 'paidByAmountSum'),
    ).toBe(true)
  })

  it('paidByList BY_AMOUNT with NO originalCurrency validates against amount', () => {
    const result = expenseFormSchema.safeParse({
      expenseDate: new Date('2025-01-01T00:00:00.000Z'),
      title: 'Dinner',
      category: 'general',
      amount: 1000,
      paidBySplitMode: 'BY_AMOUNT',
      paidByList: [{ participant: 'p0', shares: 1000 }],
      paidFor: [{ participant: 'p0', shares: 1 }],
      splitMode: 'EVENLY',
      saveDefaultSplittingOptions: false,
      isReimbursement: false,
      documents: [],
      recurrenceRule: 'NONE',
    })
    expect(result.success).toBe(true)
  })

  it('cross-currency paidByList BY_AMOUNT transform returns correct minor units', () => {
    const result = expenseFormSchema.safeParse({
      expenseDate: new Date('2025-01-01T00:00:00.000Z'),
      title: 'Dinner',
      category: 'general',
      amount: 61000,
      originalAmount: 1000,
      originalCurrency: 'EUR',
      conversionRate: 61,
      paidBySplitMode: 'BY_AMOUNT',
      paidByList: [{ participant: 'p0', shares: '1000' }],
      paidFor: [{ participant: 'p0', shares: 1 }],
      splitMode: 'EVENLY',
      saveDefaultSplittingOptions: false,
      isReimbursement: false,
      documents: [],
      recurrenceRule: 'NONE',
    })
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.paidByList[0].shares).toBe(1000)
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
