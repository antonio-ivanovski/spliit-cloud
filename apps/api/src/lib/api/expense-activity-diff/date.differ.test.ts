import { describe, expect, it } from 'vitest'

import type { Expense } from '@spliit/domain'

import { dateDiffer } from './date.differ'
import type { ChangeContext } from './types'

function makeExpense(overrides: Partial<Expense> = {}): Expense {
  return {
    expenseDate: new Date('2026-01-01T00:00:00.000Z'),
    expenseTimeZone: 'UTC',
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

describe('dateDiffer', () => {
  it('check returns false for identical dates', () => {
    expect(
      dateDiffer.check(
        makeExpense({ expenseDate: new Date('2026-01-01') }),
        makeExpense({ expenseDate: new Date('2026-01-01') }),
      ),
    ).toBe(false)
  })

  it('check returns true for different dates', () => {
    expect(
      dateDiffer.check(
        makeExpense({ expenseDate: new Date('2026-01-01') }),
        makeExpense({ expenseDate: new Date('2026-01-02') }),
      ),
    ).toBe(true)
  })

  it('check treats Date and ISO-string of same instant as identical', () => {
    expect(
      dateDiffer.check(
        makeExpense({ expenseDate: new Date('2026-01-01T00:00:00.000Z') }),
        makeExpense({
          expenseDate: '2026-01-01T00:00:00.000Z' as unknown as Date,
        }),
      ),
    ).toBe(false)
  })

  it('check handles year-rollover', () => {
    expect(
      dateDiffer.check(
        makeExpense({ expenseDate: new Date('2026-12-31T00:00:00Z') }),
        makeExpense({ expenseDate: new Date('2027-01-01T00:00:00Z') }),
      ),
    ).toBe(true)
  })

  it('diff returns null for identical dates', () => {
    expect(dateDiffer.diff(makeExpense(), makeExpense(), ctx)).toBeNull()
  })

  it('diff formats before/after as wall-clock timestamps', () => {
    const result = dateDiffer.diff(
      makeExpense({ expenseDate: new Date('2026-01-15T00:00:00Z') }),
      makeExpense({ expenseDate: new Date('2026-01-16T00:00:00Z') }),
      ctx,
    )
    expect(result).toEqual({
      field: 'date',
      before: '2026-01-15 00:00 · UTC',
      after: '2026-01-16 00:00 · UTC',
    })
  })

  it('includes wall time when a timezone-aware timestamp changes', () => {
    const result = dateDiffer.diff(
      makeExpense({
        expenseDate: new Date('2026-01-15T11:00:00Z'),
        expenseTimeZone: 'Europe/Skopje',
      }),
      makeExpense({
        expenseDate: new Date('2026-01-15T12:00:00Z'),
        expenseTimeZone: 'Europe/Skopje',
      }),
      ctx,
    )
    expect(result).toEqual({
      field: 'date',
      before: '2026-01-15 12:00 · Europe/Skopje',
      after: '2026-01-15 13:00 · Europe/Skopje',
    })
  })

  it('records a timezone-only change as a temporal change', () => {
    const result = dateDiffer.diff(
      makeExpense({ expenseTimeZone: 'UTC' }),
      makeExpense({ expenseTimeZone: 'America/Los_Angeles' }),
      ctx,
    )
    expect(result).toEqual({
      field: 'date',
      before: '2026-01-01 00:00 · UTC',
      after: '2025-12-31 16:00 · America/Los_Angeles',
    })
  })

  it('field is "date"', () => {
    expect(dateDiffer.field).toBe('date')
  })
})
