import type { Expense } from '@spliit/domain'
import { describe, expect, it } from 'vitest'
import { amountDiffer } from './amount.differ'
import type { ChangeContext } from './types'

function makeExpense(overrides: Partial<Expense> = {}): Expense {
  return {
    expenseDate: new Date('2026-01-01T00:00:00.000Z'),
    title: 'Dinner',
    category: 'general',
    amount: 4500,
    paidBySplitMode: 'BY_AMOUNT',
    paidByList: [{ participant: 'lp-alice', shares: 4500 }],
    paidFor: [
      { participant: 'lp-alice', shares: 1 },
      { participant: 'lp-bob', shares: 1 },
    ],
    isMultiPayer: false,
    splitMode: 'EVENLY',
    saveDefaultSplittingOptions: false,
    isReimbursement: false,
    documents: [],
    recurrenceRule: 'NONE',
    ...overrides,
  } as Expense
}

const ctx: ChangeContext = {
  getParticipantName: (id) => id,
  getCategoryName: (id) => id,
  formatCurrencyCents: (cents, currency) => {
    const code = currency ?? 'EUR'
    const whole = Math.floor(Math.abs(cents) / 100)
    const frac = Math.abs(cents) % 100
    const sign = cents < 0 ? '-' : ''
    return `${sign}${code} ${whole}.${frac.toString().padStart(2, '0')}`
  },
  ledgerCurrencyCode: 'EUR',
}

describe('amountDiffer', () => {
  it('check returns false for identical amounts', () => {
    expect(
      amountDiffer.check(
        makeExpense({ amount: 1000 }),
        makeExpense({ amount: 1000 }),
      ),
    ).toBe(false)
  })

  it('check returns true for different amounts', () => {
    expect(
      amountDiffer.check(
        makeExpense({ amount: 1000 }),
        makeExpense({ amount: 2000 }),
      ),
    ).toBe(true)
  })

  it('check detects cent-level differences', () => {
    expect(
      amountDiffer.check(
        makeExpense({ amount: 100 }),
        makeExpense({ amount: 101 }),
      ),
    ).toBe(true)
  })

  it('diff returns null for identical amounts', () => {
    expect(
      amountDiffer.diff(
        makeExpense({ amount: 1000 }),
        makeExpense({ amount: 1000 }),
        ctx,
      ),
    ).toBeNull()
  })

  it('diff uses default currency when no originalCurrency', () => {
    const result = amountDiffer.diff(
      makeExpense({ amount: 1200, originalCurrency: undefined }),
      makeExpense({ amount: 1500, originalCurrency: undefined }),
      ctx,
    )
    expect(result).toEqual({
      field: 'amount',
      before: 'EUR 12.00',
      after: 'EUR 15.00',
    })
  })

  it('diff shows dual-currency format when originalAmount is set', () => {
    const result = amountDiffer.diff(
      makeExpense({
        amount: 4500,
        originalAmount: undefined,
        originalCurrency: undefined,
      }),
      makeExpense({
        amount: 4140,
        originalAmount: 4500,
        originalCurrency: 'USD',
        conversionRate: 0.92,
      }),
      ctx,
    )
    expect(result).toEqual({
      field: 'amount',
      before: 'EUR 45.00',
      after: 'USD 45.00 (EUR 41.40)',
    })
  })

  it('diff uses amount directly when originalAmount is not set (amount must differ)', () => {
    // Currency-only change without amount cents difference is NOT an amount
    // change — check() returns false, diff() returns null.
    const result = amountDiffer.diff(
      makeExpense({
        amount: 4500,
        originalAmount: undefined,
        originalCurrency: undefined,
      }),
      makeExpense({
        amount: 4500,
        originalAmount: undefined,
        originalCurrency: 'USD',
      }),
      ctx,
    )
    expect(result).toBeNull()
  })

  it('field is "amount"', () => {
    expect(amountDiffer.field).toBe('amount')
  })

  it('dual format: shows original + converted when originalAmount is set', () => {
    const result = amountDiffer.diff(
      makeExpense({
        amount: 1642,
        originalAmount: 12300,
        originalCurrency: 'CNY',
        conversionRate: 0.1335,
      }),
      makeExpense({
        amount: 1805,
        originalAmount: 12300,
        originalCurrency: 'CNY',
        conversionRate: 0.1467,
      }),
      ctx,
    )
    expect(result).toEqual({
      field: 'amount',
      before: 'CNY 123.00 (EUR 16.42)',
      after: 'CNY 123.00 (EUR 18.05)',
    })
  })

  it('dual format: conversion rate change shows in converted portion only', () => {
    const result = amountDiffer.diff(
      makeExpense({
        amount: 1000,
        originalAmount: 5000,
        originalCurrency: 'JPY',
        conversionRate: 0.2,
      }),
      makeExpense({
        amount: 1500,
        originalAmount: 5000,
        originalCurrency: 'JPY',
        conversionRate: 0.3,
      }),
      ctx,
    )
    expect(result).toEqual({
      field: 'amount',
      before: 'JPY 50.00 (EUR 10.00)',
      after: 'JPY 50.00 (EUR 15.00)',
    })
  })

  it('dual format: no originalAmount falls back to single-currency display', () => {
    const result = amountDiffer.diff(
      makeExpense({ amount: 1200 }),
      makeExpense({ amount: 1500 }),
      ctx,
    )
    expect(result).toEqual({
      field: 'amount',
      before: 'EUR 12.00',
      after: 'EUR 15.00',
    })
  })
})
