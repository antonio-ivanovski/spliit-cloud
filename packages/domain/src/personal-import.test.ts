import { describe, expect, it } from 'vitest'

import {
  buildPersonalImportEntry,
  resolvePersonalImportKind,
} from './personal-import'

describe('personal import row builder', () => {
  it('infers expense from negative amounts by default', () => {
    expect(resolvePersonalImportKind(-100, 'expense')).toBe('EXPENSE')
    expect(resolvePersonalImportKind(100, 'expense')).toBe('INCOME')
  })

  it('flips inference when negative means income', () => {
    expect(resolvePersonalImportKind(-100, 'income')).toBe('INCOME')
    expect(resolvePersonalImportKind(100, 'income')).toBe('EXPENSE')
  })

  it('builds positive minor units and resolves the income default', () => {
    const built = buildPersonalImportEntry(
      {
        amount: -1250,
        currency: 'usd',
        expenseDate: '2026-10-01',
        title: ' Market ',
        category: 'general',
        notes: null,
      },
      { negativeIs: 'expense' },
    )
    expect(built.error).toBeNull()
    expect(built.entry).toMatchObject({
      kind: 'EXPENSE',
      amount: 1250,
      currency: 'USD',
      date: '2026-10-01',
      title: 'Market',
      categoryId: 'general',
    })
  })

  it('maps general to income for income rows and rejects zero/settlement', () => {
    const income = buildPersonalImportEntry(
      {
        amount: 2000,
        currency: 'USD',
        expenseDate: '2026-10-02',
        title: 'Pay',
        category: 'general',
        notes: null,
      },
      { negativeIs: 'expense' },
    )
    expect(income.entry).toMatchObject({ kind: 'INCOME', categoryId: 'income' })

    expect(
      buildPersonalImportEntry(
        {
          amount: 0,
          currency: 'USD',
          expenseDate: '2026-10-02',
          title: 'Zero',
          category: 'general',
          notes: null,
        },
        { negativeIs: 'expense' },
      ).error,
    ).toBe('INVALID_AMOUNT')

    expect(
      buildPersonalImportEntry(
        {
          amount: -100,
          currency: 'USD',
          expenseDate: '2026-10-02',
          title: 'Settle',
          category: 'settlement',
          notes: null,
        },
        { negativeIs: 'expense' },
      ).error,
    ).toBe('SETTLEMENT_NOT_ALLOWED')
  })
})
