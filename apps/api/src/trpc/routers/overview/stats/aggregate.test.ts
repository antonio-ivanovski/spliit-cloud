import { describe, expect, it } from 'vitest'

import type { BalanceExpenseRow } from '../../../../lib/api/selects/balance-expense'
import { overviewStatsInputSchema } from '../../../outputs/overview-stats'
import { aggregateOverviewStats, type StatsLedger } from './aggregate'

const ledger: StatsLedger = {
  id: 'ledger',
  groupId: 'group',
  name: 'Trip',
  currency: '€',
  currencyCode: 'EUR',
  participantId: 'alice',
}
const now = new Date('2026-10-08T12:00:00Z')
function expense(
  id: string,
  amount: number,
  overrides: Partial<BalanceExpenseRow> = {},
): BalanceExpenseRow {
  return {
    id,
    ledgerId: 'ledger',
    amount,
    createdAt: now,
    expenseDate: now,
    expenseTimeZone: 'Europe/Rome',
    categoryId: 'general',
    splitMode: 'EVENLY',
    paidBySplitMode: 'BY_AMOUNT',
    originalAmount: null,
    originalCurrency: null,
    conversionRate: null,
    conversionSource: null,
    paidByList: [{ ledgerParticipantId: 'bob', shares: amount }],
    paidFor: [
      { ledgerParticipantId: 'alice', shares: 1 },
      { ledgerParticipantId: 'bob', shares: 1 },
    ],
    items: [],
    itemizedRemainder: null,
    ...overrides,
  }
}
const input = overviewStatsInputSchema.parse({ timeZone: 'Europe/Rome' })

describe('overview statistics accounting', () => {
  it.each([
    ['WEEK', '2026-10-05', 'DAY'],
    ['MONTH', '2026-10-01', 'DAY'],
    ['QUARTER', '2026-10-01', 'DAY'],
    ['YEAR', '2026-01-01', 'MONTH'],
  ] as const)(
    'uses a current calendar range for %s even without activity',
    (period, from, granularity) => {
      expect(
        aggregateOverviewStats(
          [ledger],
          [],
          overviewStatsInputSchema.parse({ period, timeZone: 'Europe/Rome' }),
          now,
        ),
      ).toMatchObject({ range: { from, to: '2026-10-08' }, granularity })
    },
  )
  it.each([
    ['2026-01-10T12:00:00Z', 'UTC', '2025-12-01', '2025-12-31'],
    ['2024-03-01T12:00:00Z', 'UTC', '2024-02-01', '2024-02-29'],
    ['2026-05-31T12:00:00Z', 'UTC', '2026-04-01', '2026-04-30'],
    ['2026-03-01T00:30:00Z', 'America/Los_Angeles', '2026-01-01', '2026-01-31'],
  ])(
    'resolves the complete previous calendar month at %s in %s',
    (instant, timeZone, from, to) => {
      expect(
        aggregateOverviewStats(
          [ledger],
          [],
          overviewStatsInputSchema.parse({ period: 'LAST_MONTH', timeZone }),
          new Date(instant),
        ).range,
      ).toEqual({ from, to })
    },
  )

  it('includes both expense-local edges of last month and excludes the surrounding months', () => {
    const rows = [
      expense('before', 9000, {
        expenseDate: new Date('2026-08-31T10:00:00Z'),
      }),
      expense('first', 1000, { expenseDate: new Date('2026-08-31T22:30:00Z') }),
      expense('last', 2000, { expenseDate: new Date('2026-09-30T21:30:00Z') }),
      expense('after', 9000, { expenseDate: new Date('2026-09-30T22:30:00Z') }),
    ]
    const result = aggregateOverviewStats(
      [ledger],
      rows,
      overviewStatsInputSchema.parse({
        period: 'LAST_MONTH',
        timeZone: 'Europe/Rome',
      }),
      now,
    )
    expect(result.range).toEqual({ from: '2026-09-01', to: '2026-09-30' })
    expect(result.currencies[0]).toMatchObject({
      expenses: 1500,
      income: 0,
      netSpending: 1500,
      transactionCount: 2,
    })
  })

  it('uses allocated spending, nets refunds, separates income and excludes only settlements', () => {
    const result = aggregateOverviewStats(
      [ledger],
      [
        expense('purchase', 12000),
        expense('refund', -2000),
        expense('income', -4000, { categoryId: 'income' }),
        expense('transfer', 1000, { categoryId: 'payment' }),
        expense('settlement', 99999, { categoryId: 'settlement' }),
      ],
      input,
      now,
    )
    expect(result.currencies[0]).toMatchObject({
      expenses: 5500,
      income: 2000,
      netSpending: 3500,
      transactionCount: 4,
      ledgerCount: 1,
    })
    expect(result.currencies[0].categories).toEqual([
      { categoryId: 'general', amount: 5000 },
      { categoryId: 'payment', amount: 500 },
    ])
    expect(result.currencies[0].timeline).toEqual([
      { date: '2026-10-08', expenses: 5500, income: 2000, netSpending: 3500 },
    ])
  })

  it('accumulates fractional cents before rounding and reconciles all breakdowns', () => {
    const result = aggregateOverviewStats(
      [ledger],
      [
        expense('a', 1, { expenseDate: new Date('2026-10-01T12:00:00Z') }),
        expense('b', 1, {
          categoryId: 'payment',
          expenseDate: new Date('2026-10-02T12:00:00Z'),
        }),
      ],
      input,
      now,
    )
    const currency = result.currencies[0]
    expect(currency.expenses).toBe(1)
    expect(currency.transactionCount).toBe(2)
    expect(
      currency.timeline.reduce((sum, bucket) => sum + bucket.expenses, 0),
    ).toBe(1)
    expect(
      currency.categories.reduce((sum, category) => sum + category.amount, 0),
    ).toBe(1)
    expect(currency.ledgers[0].expenses).toBe(1)
  })

  it.each([
    [1, 'general'],
    [-1, 'general'],
    [1, 'income'],
    [-1, 'income'],
  ])(
    'preserves signed fractional contributions for direction %s in %s',
    (direction, categoryId) => {
      // Alice's shares are +0.8, +0.8, -0.9 cents before applying direction.
      // The ledger rounds her net 0.7 cents to 1; a refund must not get that cent.
      const rows = [8, 8, -9].map((amount, index) =>
        expense(`signed-${index}`, direction * amount, {
          categoryId:
            categoryId === 'income'
              ? 'income'
              : index === 2
                ? 'payment'
                : 'general',
          expenseDate: new Date(`2026-10-0${index + 1}T12:00:00Z`),
          splitMode: 'BY_PERCENTAGE',
          paidFor: [
            { ledgerParticipantId: 'alice', shares: 1000 },
            { ledgerParticipantId: 'bob', shares: 9000 },
          ],
        }),
      )
      const currency = aggregateOverviewStats([ledger], rows, input, now)
        .currencies[0]
      const metric = categoryId === 'income' ? 'income' : 'expenses'
      const expected = categoryId === 'income' ? -direction : direction
      expect(currency[metric]).toBe(expected)
      expect(currency.timeline.map((bucket) => bucket[metric])).toEqual([
        expected,
        0,
        0,
      ])
      expect(currency.transactionCount).toBe(3)
      expect(currency.ledgers[0][metric]).toBe(expected)
      expect(currency.netSpending).toBe(direction)
      if (categoryId !== 'income') {
        expect(
          currency.categories.find(
            (category) => category.categoryId === 'general',
          )?.amount,
        ).toBe(direction)
        expect(
          currency.categories.find(
            (category) => category.categoryId === 'payment',
          )?.amount,
        ).toBe(0)
      }
    },
  )

  it('respects percentage basis points, itemized remainder and converted amount splits', () => {
    const result = aggregateOverviewStats(
      [ledger],
      [
        expense('percent', 10000, {
          splitMode: 'BY_PERCENTAGE',
          paidFor: [
            { ledgerParticipantId: 'alice', shares: 2500 },
            { ledgerParticipantId: 'bob', shares: 7500 },
          ],
        }),
        expense('itemized', 1000, {
          splitMode: 'ITEMIZED',
          items: [
            {
              amount: 600,
              splitMode: 'EVENLY',
              paidFor: [{ ledgerParticipantId: 'alice', shares: 1 }],
            },
          ],
          itemizedRemainder: {
            splitMode: 'EVENLY',
            allocationMode: 'CUSTOM',
            paidFor: [
              { ledgerParticipantId: 'alice', shares: 1 },
              { ledgerParticipantId: 'bob', shares: 1 },
            ],
          },
        }),
        expense('converted', 900, {
          splitMode: 'BY_AMOUNT',
          originalAmount: 1000,
          originalCurrency: 'USD',
          conversionRate: 0.9,
          conversionSource: 'EXCHANGE',
          paidFor: [
            { ledgerParticipantId: 'alice', shares: 250 },
            { ledgerParticipantId: 'bob', shares: 750 },
          ],
          paidByList: [{ ledgerParticipantId: 'bob', shares: 1000 }],
        }),
      ],
      input,
      now,
    )
    expect(result.currencies[0].expenses).toBe(3525)
  })

  it('retains ledger rounding boundaries and never mixes currencies', () => {
    const result = aggregateOverviewStats(
      [
        ledger,
        {
          ...ledger,
          id: 'second',
          groupId: 'second',
          participantId: 'alice-2',
        },
        {
          ...ledger,
          id: 'usd',
          groupId: 'usd',
          currency: '$',
          currencyCode: 'USD',
        },
      ],
      [
        expense('one', 1),
        expense('two', 1, {
          ledgerId: 'second',
          paidFor: [
            { ledgerParticipantId: 'alice-2', shares: 1 },
            { ledgerParticipantId: 'bob-2', shares: 1 },
          ],
        }),
        expense('usd', 100, { ledgerId: 'usd' }),
        expense('foreign', 100000, { ledgerId: 'inaccessible' }),
      ],
      input,
      now,
    )
    expect(
      result.currencies.map((currency) => [
        currency.currencyCode,
        currency.expenses,
      ]),
    ).toEqual([
      ['EUR', 2],
      ['USD', 50],
    ])
  })

  it('anchors the range to today and includes expense-local boundary dates', () => {
    const result = aggregateOverviewStats(
      [ledger],
      [
        expense('local-october', 100, {
          expenseDate: new Date('2026-09-30T22:30:00Z'),
        }),
        expense('september', 100, {
          expenseDate: new Date('2026-09-30T21:30:00Z'),
        }),
        expense('future', 100, {
          expenseDate: new Date('2026-10-09T12:00:00Z'),
        }),
      ],
      input,
      now,
    )
    expect(result.range).toEqual({ from: '2026-10-01', to: '2026-10-08' })
    expect(result.currencies[0].expenses).toBe(50)
    expect(aggregateOverviewStats([ledger], [], input, now).range).toEqual(
      result.range,
    )
  })

  it('uses full transactions once for shared totals and reports missing personal attribution', () => {
    const missing = { ...ledger, participantId: null }
    expect(
      aggregateOverviewStats([missing], [expense('a', 100)], input, now),
    ).toMatchObject({
      coverage: { unavailableLedgerCount: 1 },
      currencies: [{ expenses: 0 }],
    })
    expect(
      aggregateOverviewStats(
        [missing],
        [expense('a', 100)],
        overviewStatsInputSchema.parse({ person: { kind: 'SHARED' } }),
        now,
      ),
    ).toMatchObject({
      coverage: { unavailableLedgerCount: 0 },
      currencies: [{ expenses: 100 }],
    })
  })

  it('includes signed income corrections and future dates in inclusive custom ranges', () => {
    const result = aggregateOverviewStats(
      [ledger],
      [
        expense('income', -400, { categoryId: 'income' }),
        expense('correction', 100, { categoryId: 'income' }),
        expense('future-income', -200, {
          categoryId: 'income',
          expenseDate: new Date('2026-10-09T12:00:00Z'),
        }),
      ],
      overviewStatsInputSchema.parse({
        period: 'CUSTOM',
        customRange: { from: '2026-10-08', to: '2026-10-09' },
      }),
      now,
    )
    expect(result.currencies[0]).toMatchObject({
      expenses: 0,
      income: 250,
      netSpending: -250,
    })
  })
})
