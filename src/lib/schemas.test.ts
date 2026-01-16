import { expenseFormSchema, groupFormSchema } from './schemas'

describe('expenseFormSchema', () => {
  it('validates required fields', () => {
    const result = expenseFormSchema.safeParse({
      expenseDate: new Date('2025-01-01T00:00:00.000Z'),
      title: 'Dinner',
      category: 0,
      amount: 1000,
      originalAmount: undefined,
      originalCurrency: '',
      conversionRate: undefined,
      paidBy: 'p0',
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
      category: 0,
      amount: 1000,
      originalAmount: undefined,
      originalCurrency: '',
      conversionRate: undefined,
      paidBy: 'p0',
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
      category: 0,
      amount: 1000,
      originalCurrency: '',
      paidBy: 'p0',
      paidFor: [{ participant: 'p0', shares: 1 }],
      splitMode: 'EVENLY',
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
})
