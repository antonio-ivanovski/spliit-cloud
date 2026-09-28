import {
  getFormItemBreakdown,
  getStoredItemBreakdown,
} from '@/app/groups/[groupId]/expenses/expense-item-breakdown'

const USD = {
  code: 'USD',
  symbol: '$',
  decimal_digits: 2,
  rounding: 0,
} as never

describe('getStoredItemBreakdown', () => {
  it('splits evenly and sums to the item amount', () => {
    const shares = getStoredItemBreakdown({
      amount: 1001,
      splitMode: 'EVENLY',
      paidFor: [
        { participant: 'a', shares: 1 },
        { participant: 'b', shares: 1 },
      ],
    })

    expect(Object.values(shares).reduce((sum, n) => sum + n, 0)).toBe(1001)
    expect(Math.abs(shares.a! - shares.b!)).toBeLessThanOrEqual(1)
  })

  it('splits by percentage weights', () => {
    const shares = getStoredItemBreakdown({
      amount: 1000,
      splitMode: 'BY_PERCENTAGE',
      paidFor: [
        { participant: 'a', shares: 2500 },
        { participant: 'b', shares: 7500 },
      ],
    })

    expect(shares).toMatchObject({ a: 250, b: 750 })
  })

  it('splits by share weights', () => {
    const shares = getStoredItemBreakdown({
      amount: 1000,
      splitMode: 'BY_SHARES',
      paidFor: [
        { participant: 'a', shares: 100 },
        { participant: 'b', shares: 300 },
      ],
    })

    expect(shares).toMatchObject({ a: 250, b: 750 })
  })

  it('passes through by-amount shares', () => {
    const shares = getStoredItemBreakdown({
      amount: 1000,
      splitMode: 'BY_AMOUNT',
      paidFor: [
        { participant: 'a', shares: 400 },
        { participant: 'b', shares: 600 },
      ],
    })

    expect(shares).toMatchObject({ a: 400, b: 600 })
  })

  it('returns no shares without assignees', () => {
    expect(
      getStoredItemBreakdown({
        amount: 1000,
        splitMode: 'EVENLY',
        paidFor: [],
      }),
    ).toEqual({})
  })
})

describe('getFormItemBreakdown', () => {
  it('splits a display-unit total evenly in minor units', () => {
    const shares = getFormItemBreakdown(
      {
        unitPrice: 10,
        quantity: 1,
        splitMode: 'EVENLY',
        paidFor: [
          { participant: 'a', shares: 1 },
          { participant: 'b', shares: 1 },
        ],
      },
      USD,
    )

    expect(shares).toMatchObject({ a: 500, b: 500 })
  })

  it('converts display percentages to minor units', () => {
    const shares = getFormItemBreakdown(
      {
        unitPrice: 10,
        quantity: 2,
        splitMode: 'BY_PERCENTAGE',
        paidFor: [
          { participant: 'a', shares: 25 },
          { participant: 'b', shares: 75 },
        ],
      },
      USD,
    )

    expect(shares).toMatchObject({ a: 500, b: 1500 })
  })

  it('converts display by-amount shares to minor units', () => {
    const shares = getFormItemBreakdown(
      {
        unitPrice: 10,
        quantity: 1,
        splitMode: 'BY_AMOUNT',
        paidFor: [
          { participant: 'a', shares: 4 },
          { participant: 'b', shares: 6 },
        ],
      },
      USD,
    )

    expect(shares).toMatchObject({ a: 400, b: 600 })
  })

  it('returns no shares without assignees', () => {
    expect(
      getFormItemBreakdown(
        { unitPrice: 10, quantity: 1, splitMode: 'EVENLY', paidFor: [] },
        USD,
      ),
    ).toEqual({})
  })
})
