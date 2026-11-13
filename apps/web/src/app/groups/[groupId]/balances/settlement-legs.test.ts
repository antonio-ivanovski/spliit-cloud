import { describe, expect, it } from 'vitest'

import { hasUnsettledBalance, withDirectLegs } from './settlement-legs'

// Alice paid for Bob, Bob paid for Carol, then Bob was removed. Bob nets to
// zero, so the simplified plan is Carol → Alice, but Bob still has direct legs.
const balances = {
  alice: { paid: 1000, paidFor: 0, total: 1000 },
  bob: { paid: 1000, paidFor: 1000, total: 0 },
  carol: { paid: 0, paidFor: 1000, total: -1000 },
}
const simplifiedLegs = [{ from: 'carol', to: 'alice', amount: 1000 }]
const direct = {
  suggestedSettlements: [
    { from: 'bob', to: 'alice', amount: 1000 },
    { from: 'carol', to: 'bob', amount: 1000 },
  ],
  currencies: [
    {
      currencyCode: 'EUR',
      directSettlements: [
        { from: 'bob', to: 'alice', amount: 1000 },
        { from: 'carol', to: 'bob', amount: 1000 },
      ],
    },
  ],
}
const currencyBalances = [
  { currencyCode: 'EUR', balances, suggestedSettlements: simplifiedLegs },
]

describe('withDirectLegs', () => {
  it('swaps each currency bucket to its direct legs', () => {
    expect(withDirectLegs(currencyBalances, direct)).toEqual([
      {
        currencyCode: 'EUR',
        balances,
        suggestedSettlements: direct.currencies[0].directSettlements,
      },
    ])
  })

  it('leaves a currency without direct legs empty', () => {
    expect(
      withDirectLegs(
        [
          {
            currencyCode: 'USD',
            balances,
            suggestedSettlements: simplifiedLegs,
          },
        ],
        direct,
      )[0].suggestedSettlements,
    ).toEqual([])
  })
})

describe('hasUnsettledBalance', () => {
  it('drops a net-zero removed member in the simplified view', () => {
    expect(
      hasUnsettledBalance('bob', balances, simplifiedLegs, currencyBalances),
    ).toBe(false)
  })

  it('keeps a net-zero removed member who is on a direct leg', () => {
    expect(
      hasUnsettledBalance(
        'bob',
        balances,
        direct.suggestedSettlements,
        withDirectLegs(currencyBalances, direct),
      ),
    ).toBe(true)
  })
})
