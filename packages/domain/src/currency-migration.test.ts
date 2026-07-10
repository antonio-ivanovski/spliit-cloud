import { describe, expect, it } from 'vitest'
import {
  calculateMigrationRewrite,
  effectiveOriginalExpense,
  getMigrationEligibility,
  migrationRateKey,
} from './currency-migration'

describe('currency migration domain helpers', () => {
  it('uses the old ledger amount for a same-currency expense', () => {
    expect(
      effectiveOriginalExpense(
        {
          id: 'same',
          expenseDate: '2026-01-02',
          amount: 1234,
          originalAmount: null,
          originalCurrency: null,
          conversionSource: null,
        },
        'USD',
      ),
    ).toMatchObject({
      effectiveOriginalAmount: 1234,
      effectiveOriginalCurrency: 'USD',
    })
  })

  it('retains the original input for an already converted expense', () => {
    expect(
      effectiveOriginalExpense(
        {
          id: 'foreign',
          expenseDate: '2026-01-02',
          amount: 1100,
          originalAmount: 1000,
          originalCurrency: 'eur',
          conversionSource: 'CUSTOM',
        },
        'USD',
      ),
    ).toMatchObject({
      effectiveOriginalAmount: 1000,
      effectiveOriginalCurrency: 'EUR',
    })
  })

  it('groups effective originals into direct pairs and reports unsupported codes', () => {
    const result = getMigrationEligibility({
      oldLedgerCurrency: 'USD',
      destinationCurrency: 'GBP',
      expenses: [
        {
          id: 'same',
          expenseDate: '2026-01-02',
          amount: 100,
        },
        {
          id: 'foreign',
          expenseDate: '2026-01-03',
          amount: 110,
          originalAmount: 100,
          originalCurrency: 'EUR',
          conversionSource: 'CUSTOM',
        },
        {
          id: 'unsupported',
          expenseDate: '2026-01-04',
          amount: 100,
          originalAmount: 100,
          originalCurrency: 'ZZZ',
          conversionSource: 'CUSTOM',
        },
      ],
    })

    expect(result.eligible).toBe(false)
    expect(result.unsupportedCurrencies).toEqual([
      { code: 'ZZZ', expenseIds: ['unsupported'] },
    ])
    expect(result.pairs).toEqual([
      {
        base: 'USD',
        target: 'GBP',
        expenseIds: ['same'],
        dates: ['2026-01-02'],
      },
      {
        base: 'EUR',
        target: 'GBP',
        expenseIds: ['foreign'],
        dates: ['2026-01-03'],
      },
      {
        base: 'ZZZ',
        target: 'GBP',
        expenseIds: ['unsupported'],
        dates: ['2026-01-04'],
      },
    ])
    expect(result.customRateExpenseCount).toBe(2)
  })

  it.each([
    ['perDate', 'EXCHANGE'],
    ['fixedProvider', 'CUSTOM'],
    ['fixedCustom', 'CUSTOM'],
  ] as const)('calculates a direct %s rewrite', (policyType, source) => {
    const policy =
      policyType === 'perDate'
        ? { type: 'perDate' as const }
        : policyType === 'fixedProvider'
          ? { type: 'fixedProvider' as const, date: '2026-01-02' }
          : { type: 'fixedCustom' as const, rate: 1.2 }
    const rate = policyType === 'fixedCustom' ? 1.2 : 1.1
    const rewrite = calculateMigrationRewrite({
      expense: {
        id: 'foreign',
        expenseDate: '2026-01-03',
        effectiveOriginalAmount: 1000,
        effectiveOriginalCurrency: 'EUR',
        existingConversionSource: 'CUSTOM',
      },
      oldLedgerCurrency: 'USD',
      destinationCurrency: 'GBP',
      policy,
      ratesByDate: {
        [migrationRateKey(
          policyType === 'fixedProvider' ? '2026-01-02' : '2026-01-03',
          'EUR',
          'GBP',
        )]: rate,
      },
    })
    expect(rewrite).toMatchObject({
      amount: policyType === 'fixedCustom' ? 1200 : 1100,
      originalAmount: 1000,
      originalCurrency: 'EUR',
      conversionRate: rate,
      conversionSource: source,
    })
  })

  it('rewrites an expense already in the destination as same-currency', () => {
    expect(
      calculateMigrationRewrite({
        expense: {
          id: 'dest',
          expenseDate: '2026-01-01',
          effectiveOriginalAmount: 500,
          effectiveOriginalCurrency: 'GBP',
          existingConversionSource: 'EXCHANGE',
        },
        oldLedgerCurrency: 'USD',
        destinationCurrency: 'GBP',
        policy: { type: 'perDate' },
      }),
    ).toEqual({
      amount: 500,
      originalAmount: null,
      originalCurrency: null,
      conversionRate: null,
      conversionSource: null,
    })
  })
})
