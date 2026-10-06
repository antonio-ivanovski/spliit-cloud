import { describe, expect, it } from 'vitest'

import {
  formatPersonalShareLine,
  personalShareForRecipient,
  type PersonalExpenseShare,
} from './personal-expense-share'

const fmt = (cents: number) => `EUR ${(cents / 100).toFixed(2)}`

function share(overrides: Partial<PersonalExpenseShare>): PersonalExpenseShare {
  return {
    paid: 0,
    owed: 0,
    currencyCode: 'EUR',
    isSettlement: false,
    ...overrides,
  }
}

describe('personalShareForRecipient', () => {
  const balances = {
    'lp-bob': { paid: 0, paidFor: 1500, total: -1500 },
    'lp-alice': { paid: 4500, paidFor: 3000, total: 1500 },
    'lp-zero': { paid: 0, paidFor: 0, total: 0 },
  }

  it('returns paid and owed for a known participant', () => {
    expect(
      personalShareForRecipient({
        balances,
        ledgerParticipantId: 'lp-bob',
        currencyCode: 'EUR',
        isSettlement: false,
      }),
    ).toEqual({ paid: 0, owed: 1500, currencyCode: 'EUR', isSettlement: false })
  })

  it('returns null for an unknown participant', () => {
    expect(
      personalShareForRecipient({
        balances,
        ledgerParticipantId: 'lp-gone',
        currencyCode: 'EUR',
        isSettlement: false,
      }),
    ).toBeNull()
  })

  it('returns null when the participant id is missing', () => {
    expect(
      personalShareForRecipient({
        balances,
        ledgerParticipantId: undefined,
        currencyCode: 'EUR',
        isSettlement: false,
      }),
    ).toBeNull()
  })

  it('returns null when both sides are zero so no noise line renders', () => {
    expect(
      personalShareForRecipient({
        balances,
        ledgerParticipantId: 'lp-zero',
        currencyCode: 'EUR',
        isSettlement: false,
      }),
    ).toBeNull()
  })

  it('returns null for negative shares from income or refund expenses', () => {
    expect(
      personalShareForRecipient({
        balances: {
          'lp-bob': { paid: 0, paidFor: -1500, total: 1500 },
        },
        ledgerParticipantId: 'lp-bob',
        currencyCode: 'EUR',
        isSettlement: false,
      }),
    ).toBeNull()
  })
})

describe('formatPersonalShareLine', () => {
  it.each([
    {
      name: 'owe only',
      input: share({ owed: 1500 }),
      expected: 'You owe EUR 15.00',
    },
    {
      name: 'paid only',
      input: share({ paid: 3000 }),
      expected: 'You paid EUR 30.00',
    },
    {
      name: 'both sides',
      input: share({ paid: 4500, owed: 1500 }),
      expected: 'You owe EUR 15.00 · You paid EUR 45.00',
    },
    {
      name: 'settlement credit',
      input: share({ paid: 2000, owed: 0, isSettlement: true }),
      expected: 'You lent EUR 20.00',
    },
    {
      name: 'settlement debt',
      input: share({ paid: 0, owed: 2000, isSettlement: true }),
      expected: 'You borrowed EUR 20.00',
    },
  ])('renders $name', ({ input, expected }) => {
    expect(formatPersonalShareLine(input, fmt)).toBe(expected)
  })

  it.each([
    { name: 'plain zero', input: share({}) },
    {
      name: 'settled net zero',
      input: share({ paid: 500, owed: 500, isSettlement: true }),
    },
  ])('returns null for $name', ({ input }) => {
    expect(formatPersonalShareLine(input, fmt)).toBeNull()
  })

  it('returns null when the amount cannot be formatted', () => {
    expect(
      formatPersonalShareLine(share({ owed: 1500 }), () => null),
    ).toBeNull()
  })
})
