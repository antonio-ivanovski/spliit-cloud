import { describe, expect, it } from 'vitest'

import '../../../test/mocks'
import { prismaMock } from '../../../test/state'
import { getFinancialSummary, overviewRouter, summarizeBalances } from './index'

const expense = (overrides: Record<string, unknown> = {}) =>
  ({
    ledgerId: 'ledger-1',
    amount: 1000,
    createdAt: new Date('2026-06-03T00:00:00Z'),
    splitMode: 'EVENLY',
    paidBySplitMode: 'BY_AMOUNT',
    originalAmount: null,
    originalCurrency: null,
    conversionRate: null,
    conversionSource: null,
    paidByList: [{ ledgerParticipantId: 'bob', shares: 1 }],
    paidFor: [
      { ledgerParticipantId: 'alice', shares: 1 },
      { ledgerParticipantId: 'bob', shares: 1 },
    ],
    items: [],
    itemizedRemainder: null,
    ...overrides,
  }) as never

describe('overview financial summaries', () => {
  it('distinguishes no expenses from an unavailable participant', () => {
    expect(getFinancialSummary([], 'alice')).toMatchObject({
      expenseCount: 0,
      netBalance: 0,
      state: 'NO_EXPENSES',
    })
    expect(getFinancialSummary([], null)).toMatchObject({
      expenseCount: 0,
      netBalance: null,
      state: 'UNAVAILABLE',
    })
  })

  it('uses the existing balance math and preserves the newest expense timestamp', () => {
    expect(
      getFinancialSummary(
        [
          expense(),
          expense({
            amount: 400,
            createdAt: new Date('2026-06-04T00:00:00Z'),
          }),
        ],
        'alice',
      ),
    ).toMatchObject({
      expenseCount: 2,
      netBalance: -700,
      state: 'YOU_OWE',
      latestExpenseCreatedAt: '2026-06-04T00:00:00.000Z',
    })
  })

  it('reports settled when the payer and share totals cancel out', () => {
    expect(
      getFinancialSummary(
        [
          expense(),
          expense({
            paidByList: [{ ledgerParticipantId: 'alice', shares: 1 }],
          }),
        ],
        'alice',
      ).state,
    ).toBe('SETTLED')
  })

  it('aggregates owed and owing totals per currency without netting them together', () => {
    expect(
      summarizeBalances([
        {
          ledger: { currency: '$', currencyCode: 'USD' },
          financialSummary: { netBalance: 1200 },
        },
        {
          ledger: { currency: '$', currencyCode: 'USD' },
          financialSummary: { netBalance: -500 },
        },
        {
          ledger: { currency: '€', currencyCode: 'EUR' },
          financialSummary: { netBalance: 900 },
        },
        {
          ledger: { currency: '$', currencyCode: 'USD' },
          financialSummary: { netBalance: 0 },
        },
      ]),
    ).toEqual([
      {
        currency: '$',
        currencyCode: 'USD',
        owedToYou: 1200,
        owedToYouGroupCount: 1,
        youOwe: 500,
        youOweGroupCount: 1,
      },
      {
        currency: '€',
        currencyCode: 'EUR',
        owedToYou: 900,
        owedToYouGroupCount: 1,
        youOwe: 0,
        youOweGroupCount: 0,
      },
    ])
  })
})

describe('overviewRouter.get', () => {
  it('returns an empty authenticated overview without querying unrelated ledgers', async () => {
    prismaMock.groupMember.findMany.mockResolvedValue([] as never)
    prismaMock.accountGroupPreference.findMany.mockResolvedValue([] as never)

    const caller = overviewRouter.createCaller({
      auth: {
        session: { id: 'session-1' },
        user: {
          id: 'acct-1',
          email: 'alice@example.com',
          emailVerified: true,
          name: 'Alice',
        },
      },
    } as never)

    await expect(caller.get()).resolves.toEqual({
      stats: {
        balanceSummaries: [],
        friendCount: 0,
      },
      groups: [],
    })
    expect(prismaMock.expense.findMany).not.toHaveBeenCalled()
  })
})
