import { describe, expect, it } from 'vitest'

import type { CreateExpenseSearch } from '@/router/schemas'

import { buildExpenseFormDefaults, type GroupShape } from './default-values'

const EUR = { code: 'EUR', symbol: '€', decimal_digits: 2, rounding: 0 }

const group = {
  participants: [
    { id: 'alice', name: 'Alice' },
    { id: 'bob', name: 'Bob' },
    { id: 'carol', name: 'Carol' },
  ],
  currencyCode: 'EUR',
} as GroupShape

function searchParams(overrides: Partial<CreateExpenseSearch> = {}) {
  return {
    reimbursement: 'yes',
    amount: '4000',
    ...overrides,
  } as CreateExpenseSearch
}

function build(search: CreateExpenseSearch) {
  return buildExpenseFormDefaults({
    isCreate: true,
    searchParams: search,
    group,
    groupCurrency: EUR,
    currentLedgerParticipantId: 'alice',
    reimbursementTitle: 'Settlement payment',
  })
}

describe('buildExpenseFormDefaults grouped reimbursements', () => {
  it('prefills one payer and multiple exact recipients', () => {
    const values = build(
      searchParams({
        settlements: JSON.stringify({
          direction: 'pay',
          participantId: 'alice',
          legs: [
            { from: 'alice', to: 'bob', amount: 2500 },
            { from: 'alice', to: 'carol', amount: 1500 },
          ],
        }),
      }),
    )

    expect(values.amount).toBe(40)
    expect(values.splitMode).toBe('BY_AMOUNT')
    expect(values.paidByList).toEqual([{ participant: 'alice', shares: 40 }])
    expect(values.paidFor).toEqual([
      { participant: 'bob', shares: 25 },
      { participant: 'carol', shares: 15 },
    ])
    expect(values.isMultiPayer).toBe(false)
  })

  it('prefills multiple payers and one exact recipient', () => {
    const values = build(
      searchParams({
        settlements: JSON.stringify({
          direction: 'receive',
          participantId: 'alice',
          legs: [
            { from: 'bob', to: 'alice', amount: 2500 },
            { from: 'carol', to: 'alice', amount: 1500 },
          ],
        }),
      }),
    )

    expect(values.paidByList).toEqual([
      { participant: 'bob', shares: 25 },
      { participant: 'carol', shares: 15 },
    ])
    expect(values.paidFor).toEqual([{ participant: 'alice', shares: 40 }])
    expect(values.isMultiPayer).toBe(true)
  })

  it('falls back to scalar reimbursement defaults for malformed grouped state', () => {
    const values = build(
      searchParams({
        from: 'alice',
        to: 'bob',
        amount: '2500',
        settlements: '{not-json',
      }),
    )

    expect(values.splitMode).toBe('EVENLY')
    expect(values.paidByList).toEqual([{ participant: 'alice', shares: 25 }])
    expect(values.paidFor).toEqual([{ participant: 'bob', shares: 1 }])
  })
})

describe('buildExpenseFormDefaults edit-mode item hydration', () => {
  const itemizedExpense = {
    id: 'expense-1',
    title: 'Dinner',
    expenseDate: new Date('2025-06-15'),
    amount: 10000,
    originalCurrency: null,
    originalAmount: null,
    conversionRate: null,
    categoryId: 'food-and-drink',
    paidBySplitMode: 'BY_AMOUNT',
    paidByList: [{ ledgerParticipantId: 'alice', shares: 10000 }],
    paidFor: [],
    splitMode: 'ITEMIZED',
    isReimbursement: false,
    documents: [],
    notes: '',
    recurrenceRule: 'NONE',
    isPayer: true,
    expense: null,
    items: [
      {
        id: 'it-1',
        title: 'Beer',
        unitPrice: 5000,
        quantity: 1,
        amount: 5000,
        splitMode: 'BY_SHARES',
        paidFor: [
          { ledgerParticipantId: 'alice', shares: 50 },
          { ledgerParticipantId: 'bob', shares: 150 },
        ],
      },
    ],
    itemizedRemainder: {
      splitMode: 'BY_SHARES',
      paidFor: [
        { ledgerParticipantId: 'bob', shares: 150 },
        { ledgerParticipantId: 'carol', shares: 200 },
      ],
    },
  }

  it('hydrates stored fixed units to display shares for items and remainder', () => {
    const values = buildExpenseFormDefaults({
      isCreate: false,
      expense: itemizedExpense as never,
      searchParams: {} as CreateExpenseSearch,
      group,
      groupCurrency: EUR,
      currentLedgerParticipantId: 'alice',
      reimbursementTitle: 'Settlement payment',
    })

    expect(values.items?.[0]?.paidFor).toEqual([
      { participant: 'alice', shares: 0.5 },
      { participant: 'bob', shares: 1.5 },
    ])
    expect(values.itemizedRemainder?.paidFor).toEqual([
      { participant: 'bob', shares: 1.5 },
      { participant: 'carol', shares: 2 },
    ])
  })
})
