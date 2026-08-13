import { getBalances } from '@spliit/domain'

import {
  balanceExpenseSelect,
  type BalanceExpenseRow,
  toBalanceExpense,
} from './balance-expense'

function row(
  overrides: Partial<BalanceExpenseRow> & Pick<BalanceExpenseRow, 'id'>,
): BalanceExpenseRow {
  return {
    id: overrides.id,
    ledgerId: 'ledger-1',
    amount: 1000,
    createdAt: new Date('2026-07-01T00:00:00.000Z'),
    expenseDate: new Date('2026-07-01T00:00:00.000Z'),
    categoryId: 'general',
    splitMode: 'EVENLY',
    paidBySplitMode: 'BY_AMOUNT',
    originalAmount: null,
    originalCurrency: null,
    conversionRate: null,
    conversionSource: null,
    paidByList: [{ ledgerParticipantId: 'alice', shares: 1000 }],
    paidFor: [
      { ledgerParticipantId: 'alice', shares: 1 },
      { ledgerParticipantId: 'bob', shares: 1 },
    ],
    items: [],
    itemizedRemainder: null,
    ...overrides,
  }
}

describe('balanceExpenseSelect', () => {
  it('preserves itemized and conversion balance math without display joins', () => {
    const itemized = row({
      id: 'itemized',
      amount: 1001,
      splitMode: 'ITEMIZED',
      paidByList: [{ ledgerParticipantId: 'alice', shares: 1001 }],
      items: [
        {
          amount: 600,
          splitMode: 'EVENLY',
          paidFor: [
            { ledgerParticipantId: 'alice', shares: 1 },
            { ledgerParticipantId: 'bob', shares: 1 },
          ],
        },
        {
          amount: 200,
          splitMode: 'BY_AMOUNT',
          paidFor: [{ ledgerParticipantId: 'bob', shares: 200 }],
        },
      ],
      itemizedRemainder: {
        splitMode: 'BY_AMOUNT',
        paidFor: [
          { ledgerParticipantId: 'alice', shares: 101 },
          { ledgerParticipantId: 'bob', shares: 100 },
        ],
      },
    })
    const converted = row({
      id: 'converted',
      amount: 9200,
      originalAmount: 10000,
      originalCurrency: 'USD',
      conversionRate: 0.92,
      conversionSource: 'CUSTOM',
      paidByList: [
        { ledgerParticipantId: 'alice', shares: 7000 },
        { ledgerParticipantId: 'bob', shares: 3000 },
      ],
    })

    expect(getBalances([itemized, converted].map(toBalanceExpense))).toEqual({
      alice: { paid: 7441, paidFor: 5001, total: 2440 },
      bob: { paid: 2760, paidFor: 5200, total: -2440 },
    })
    expect(balanceExpenseSelect).not.toHaveProperty('recurringSeries')
    expect(balanceExpenseSelect).not.toHaveProperty('_count')
    expect(balanceExpenseSelect.paidByList.select).toEqual({
      ledgerParticipantId: true,
      shares: true,
    })
  })
})
