import { describe, expect, it } from 'vitest'

import type { Expense } from '@spliit/domain'

import {
  conversionRateDiffer,
  conversionSourceDiffer,
} from './conversion.differ'
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
    isReimbursement: false,
    documents: [],
    recurrenceRule: 'NONE',
    ...overrides,
  } as Expense
}

const ctx: ChangeContext = {
  getParticipantName: (id) => id,
  getCategoryName: (id) => id,
  formatCurrencyCents: (c, cur) => `${cur ?? 'EUR'} ${c / 100}`,
  ledgerCurrencyCode: 'EUR',
}

describe('conversionSourceDiffer', () => {
  it('check returns false when source is unchanged', () => {
    expect(
      conversionSourceDiffer.check(
        makeExpense({ conversionSource: 'EXCHANGE' }),
        makeExpense({ conversionSource: 'EXCHANGE' }),
      ),
    ).toBe(false)
  })

  it('check returns true when source changes', () => {
    expect(
      conversionSourceDiffer.check(
        makeExpense({ conversionSource: 'EXCHANGE' }),
        makeExpense({ conversionSource: 'CUSTOM' }),
      ),
    ).toBe(true)
  })

  it('diff labels EXCHANGE → CUSTOM', () => {
    expect(
      conversionSourceDiffer.diff(
        makeExpense({ conversionSource: 'EXCHANGE' }),
        makeExpense({ conversionSource: 'CUSTOM' }),
        ctx,
      ),
    ).toEqual({
      field: 'conversionSource',
      before: 'Exchange rate',
      after: 'Custom rate',
    })
  })

  it('treats missing source as same currency', () => {
    expect(
      conversionSourceDiffer.diff(
        makeExpense({ conversionSource: undefined }),
        makeExpense({ conversionSource: 'EXCHANGE' }),
        ctx,
      ),
    ).toEqual({
      field: 'conversionSource',
      before: 'None (same currency)',
      after: 'Exchange rate',
    })
  })
})

describe('conversionRateDiffer', () => {
  it('check returns false for identical rates', () => {
    expect(
      conversionRateDiffer.check(
        makeExpense({ conversionRate: 1.1 }),
        makeExpense({ conversionRate: 1.1 }),
      ),
    ).toBe(false)
  })

  it('check returns true when rate changes', () => {
    expect(
      conversionRateDiffer.check(
        makeExpense({ conversionRate: 1.1 }),
        makeExpense({ conversionRate: 1.15 }),
      ),
    ).toBe(true)
  })

  it('diff formats rates', () => {
    expect(
      conversionRateDiffer.diff(
        makeExpense({ conversionRate: 1.1 }),
        makeExpense({ conversionRate: 1.15 }),
        ctx,
      ),
    ).toEqual({
      field: 'conversionRate',
      before: '1.1',
      after: '1.15',
    })
  })

  it('diff shows dash when rate is cleared', () => {
    expect(
      conversionRateDiffer.diff(
        makeExpense({ conversionRate: 1.1 }),
        makeExpense({ conversionRate: undefined }),
        ctx,
      ),
    ).toEqual({
      field: 'conversionRate',
      before: '1.1',
      after: '—',
    })
  })
})
