import type { CreateExpenseSearch } from '@/router/schemas'
import { describe, expect, it } from 'vitest'
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
