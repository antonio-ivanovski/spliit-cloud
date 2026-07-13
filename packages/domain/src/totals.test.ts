import { getCurrency } from './currency'
import { exactAmountToNumber } from './exact-math'
import {
  calculateExactShares,
  calculatePaidByShare,
  calculatePaidByShares,
  calculateShare,
  calculateShares,
  getTotalActiveUserPaidFor,
  getTotalActiveUserShare,
  getTotalGroupSpending,
  serializePaidBy,
  serializePaidFor,
} from './totals'

type TotalsExpense = Parameters<typeof getTotalActiveUserPaidFor>[1][number]

type ShareExpense = Parameters<typeof calculateShare>[1]

type PaidByShareExpense = Parameters<typeof calculatePaidByShare>[1]

type PaidFor = ShareExpense['paidFor'][number]

const makeExpense = (overrides: Partial<TotalsExpense>): TotalsExpense =>
  ({
    id: 'e1',
    expenseDate: new Date('2025-01-01T00:00:00.000Z'),
    title: 'Dinner',
    amount: 0,
    isReimbursement: false,
    splitMode: 'EVENLY',
    createdAt: new Date('2025-01-01T00:00:00.000Z'),
    recurrenceRule: null,
    category: null,
    paidBySplitMode: 'EVENLY',
    paidByList: [{ participant: { id: 'u1', name: 'User 1' }, shares: 1 }],
    paidFor: [
      {
        participant: { id: 'u1', name: 'User 1' },
        shares: 1,
      },
    ],
    _count: { documents: 0 },
    ...overrides,
  }) as TotalsExpense

const makePaidFor = (participantId: string, shares: number): PaidFor =>
  ({
    participant: { id: participantId, name: participantId },
    shares,
  }) as PaidFor

const makePaidBy = (participantId: string, shares: number) => ({
  participant: { id: participantId, name: participantId },
  shares,
})

const sumValues = (map: Record<string, number>) =>
  Object.values(map).reduce((s, n) => s + n, 0)

describe('getTotalGroupSpending', () => {
  it('sums all non-reimbursement expenses', () => {
    const expenses = [
      makeExpense({ id: 'e1', amount: 100, isReimbursement: false }),
      makeExpense({ id: 'e2', amount: 250, isReimbursement: false }),
      makeExpense({ id: 'e3', amount: 50, isReimbursement: false }),
    ]

    expect(getTotalGroupSpending(expenses)).toBe(400)
  })

  it('excludes reimbursements from total spending', () => {
    const expenses = [
      makeExpense({ id: 'e1', amount: 100, isReimbursement: false }),
      makeExpense({ id: 'e2', amount: 999, isReimbursement: true }),
      makeExpense({ id: 'e3', amount: 250, isReimbursement: false }),
    ]

    expect(getTotalGroupSpending(expenses)).toBe(350)
  })

  it('handles empty array', () => {
    const expenses: TotalsExpense[] = []

    expect(getTotalGroupSpending(expenses)).toBe(0)
  })
})

describe('getTotalActiveUserPaidFor', () => {
  it('sums amounts paid by active user', () => {
    const expenses: TotalsExpense[] = [
      makeExpense({
        id: 'e1',
        amount: 1250,
        paidByList: [makePaidBy('u1', 1)],
      }),
      makeExpense({
        id: 'e2',
        amount: 600,
        paidByList: [makePaidBy('u2', 1)],
      }),
      makeExpense({
        id: 'e3',
        amount: 775,
        paidByList: [makePaidBy('u1', 1)],
      }),
    ]

    expect(getTotalActiveUserPaidFor('u1', expenses)).toBe(2025)
  })

  it('excludes reimbursements even if paid by active user', () => {
    const expenses: TotalsExpense[] = [
      makeExpense({
        id: 'e1',
        amount: 1000,
        isReimbursement: false,
        paidByList: [makePaidBy('u1', 1)],
      }),
      makeExpense({
        id: 'e2',
        amount: 500,
        isReimbursement: true,
        paidByList: [makePaidBy('u1', 1)],
      }),
    ]

    expect(getTotalActiveUserPaidFor('u1', expenses)).toBe(1000)
  })

  it('returns 0 when active user is null', () => {
    const expenses: TotalsExpense[] = [makeExpense({ id: 'e1', amount: 1000 })]

    expect(getTotalActiveUserPaidFor(null, expenses)).toBe(0)
  })

  it("multi-payer EVENLY splits each payer's contribution among themselves", () => {
    // getBalances still uses old float + last-absorbs; totals delegate to it.
    // e1: 100/2 → 50 each; e2: 200/3 with last absorbs → 66.67/66.67/66.66 rounded.
    const expenses: TotalsExpense[] = [
      makeExpense({
        id: 'e1',
        amount: 100,
        paidBySplitMode: 'EVENLY',
        paidByList: [makePaidBy('u1', 1), makePaidBy('u2', 1)],
      }),
      makeExpense({
        id: 'e2',
        amount: 200,
        paidBySplitMode: 'EVENLY',
        paidByList: [
          makePaidBy('u1', 1),
          makePaidBy('u2', 1),
          makePaidBy('u3', 1),
        ],
      }),
    ]

    const total = getTotalActiveUserPaidFor('u1', expenses)
    expect(total).toBe(Math.round(50 + 200 / 3))
  })

  it("multi-payer BY_AMOUNT records each payer's contribution via getBalances", () => {
    // Old getBalances treats BY_AMOUNT as weights; 40+60=100 → exact.
    const expenses: TotalsExpense[] = [
      makeExpense({
        id: 'e1',
        amount: 100,
        paidBySplitMode: 'BY_AMOUNT',
        paidByList: [makePaidBy('u1', 40), makePaidBy('u2', 60)],
      }),
      makeExpense({
        id: 'e2',
        amount: 200,
        paidBySplitMode: 'BY_AMOUNT',
        paidByList: [makePaidBy('u1', 70), makePaidBy('u3', 130)],
      }),
    ]

    expect(getTotalActiveUserPaidFor('u1', expenses)).toBe(40 + 70)
  })

  it('multi-payer BY_SHARES weights each payer by share ratio', () => {
    const expenses: TotalsExpense[] = [
      makeExpense({
        id: 'e1',
        amount: 100,
        paidBySplitMode: 'BY_SHARES',
        paidByList: [makePaidBy('u1', 1), makePaidBy('u2', 2)],
      }),
      makeExpense({
        id: 'e2',
        amount: 200,
        paidBySplitMode: 'BY_SHARES',
        paidByList: [makePaidBy('u1', 2), makePaidBy('u3', 3)],
      }),
    ]

    // e1 last-absorbs: u1 gets floor path then Math.round on total
    const total = getTotalActiveUserPaidFor('u1', expenses)
    expect(total).toBe(Math.round(100 * (1 / 3) + 80))
  })

  it('multi-payer BY_PERCENTAGE returns amount × shares / 10000 for each payer', () => {
    const expenses: TotalsExpense[] = [
      makeExpense({
        id: 'e1',
        amount: 1000,
        paidBySplitMode: 'BY_PERCENTAGE',
        paidByList: [makePaidBy('u1', 3000), makePaidBy('u2', 7000)],
      }),
      makeExpense({
        id: 'e2',
        amount: 2000,
        paidBySplitMode: 'BY_PERCENTAGE',
        paidByList: [makePaidBy('u1', 5000), makePaidBy('u3', 5000)],
      }),
    ]

    expect(getTotalActiveUserPaidFor('u1', expenses)).toBe(300 + 1000)
  })
})

describe('getTotalActiveUserShare', () => {
  it('sums active user shares across expenses via getBalances', () => {
    const expenses: TotalsExpense[] = [
      makeExpense({
        id: 'e1',
        amount: 100,
        isReimbursement: false,
        splitMode: 'EVENLY',
        paidFor: [
          makePaidFor('u1', 1),
          makePaidFor('u2', 1),
          makePaidFor('u3', 1),
        ],
      }),
      makeExpense({
        id: 'e2',
        amount: 90,
        isReimbursement: false,
        splitMode: 'BY_AMOUNT',
        paidFor: [makePaidFor('u1', 30), makePaidFor('u2', 60)],
      }),
      makeExpense({
        id: 'e3',
        amount: 50,
        isReimbursement: false,
        splitMode: 'EVENLY',
        paidFor: [makePaidFor('u1', 1), makePaidFor('u2', 1)],
      }),
    ]

    // Global getBalances: exact u1 = 100/3 + 30 + 25 ≈ 88.333 → 89 after remainder
    const total = getTotalActiveUserShare('u1', expenses)
    expect(total).toBe(89)
  })

  it('returns integer cents (no parseFloat toFixed)', () => {
    const expenses: TotalsExpense[] = [
      makeExpense({
        id: 'e1',
        amount: 100,
        splitMode: 'EVENLY',
        paidFor: [
          makePaidFor('u1', 1),
          makePaidFor('u2', 1),
          makePaidFor('u3', 1),
        ],
      }),
      makeExpense({
        id: 'e2',
        amount: 1,
        splitMode: 'EVENLY',
        paidFor: [
          makePaidFor('u1', 1),
          makePaidFor('u2', 1),
          makePaidFor('u3', 1),
        ],
      }),
    ]

    const total = getTotalActiveUserShare('u1', expenses)
    expect(Number.isInteger(total)).toBe(true)
  })
})

describe('calculateExactShares', () => {
  it('EVENLY divides amount by N as exact rationals', () => {
    const result = calculateExactShares({
      amount: 100,
      splitMode: 'EVENLY',
      participants: [
        { id: 'a', shares: 1 },
        { id: 'b', shares: 1 },
        { id: 'c', shares: 1 },
      ],
    })
    expect(result.a).toEqual({ numerator: 100n, denominator: 3n })
    expect(result.b).toEqual({ numerator: 100n, denominator: 3n })
    expect(result.c).toEqual({ numerator: 100n, denominator: 3n })
  })

  it('BY_SHARES weights by shares / Σshares', () => {
    const result = calculateExactShares({
      amount: 600,
      splitMode: 'BY_SHARES',
      participants: [
        { id: 'a', shares: 1 },
        { id: 'b', shares: 2 },
        { id: 'c', shares: 3 },
      ],
    })
    expect(exactAmountToNumber(result.a)).toBe(100)
    expect(exactAmountToNumber(result.b)).toBe(200)
    expect(exactAmountToNumber(result.c)).toBe(300)
  })

  it('BY_PERCENTAGE uses shares / 10000', () => {
    const result = calculateExactShares({
      amount: 1000,
      splitMode: 'BY_PERCENTAGE',
      participants: [
        { id: 'a', shares: 2500 },
        { id: 'b', shares: 7500 },
      ],
    })
    expect(exactAmountToNumber(result.a)).toBe(250)
    expect(exactAmountToNumber(result.b)).toBe(750)
  })

  it('rounds display-float percentages before exact BigInt math', () => {
    const result = calculateExactShares({
      amount: 1000,
      splitMode: 'BY_PERCENTAGE',
      participants: [
        { id: 'a', shares: 4029.9999999999995 },
        { id: 'b', shares: 5970.000000000001 },
      ],
    })
    expect(exactAmountToNumber(result.a)).toBeCloseTo(403)
    expect(exactAmountToNumber(result.b)).toBeCloseTo(597)
  })

  it('BY_AMOUNT returns literal shares', () => {
    const result = calculateExactShares({
      amount: 999,
      splitMode: 'BY_AMOUNT',
      participants: [
        { id: 'a', shares: 123 },
        { id: 'b', shares: 456 },
      ],
    })
    expect(exactAmountToNumber(result.a)).toBe(123)
    expect(exactAmountToNumber(result.b)).toBe(456)
  })

  it('ITEMIZED returns literal shares (same as BY_AMOUNT)', () => {
    const result = calculateExactShares({
      amount: 10000,
      splitMode: 'ITEMIZED',
      participants: [
        { id: 'alice', shares: 7000 },
        { id: 'bob', shares: 3000 },
      ],
    })
    expect(exactAmountToNumber(result.alice)).toBe(7000)
    expect(exactAmountToNumber(result.bob)).toBe(3000)
  })

  it('0 amount yields all zeros', () => {
    const result = calculateExactShares({
      amount: 0,
      splitMode: 'EVENLY',
      participants: [
        { id: 'a', shares: 1 },
        { id: 'b', shares: 1 },
      ],
    })
    expect(exactAmountToNumber(result.a)).toBe(0)
    expect(exactAmountToNumber(result.b)).toBe(0)
  })

  it('empty participants yields empty record', () => {
    expect(
      calculateExactShares({
        amount: 100,
        splitMode: 'EVENLY',
        participants: [],
      }),
    ).toEqual({})
  })

  it('BY_SHARES with 0 total shares yields zeros', () => {
    const result = calculateExactShares({
      amount: 100,
      splitMode: 'BY_SHARES',
      participants: [
        { id: 'a', shares: 0 },
        { id: 'b', shares: 0 },
      ],
    })
    expect(exactAmountToNumber(result.a)).toBe(0)
    expect(exactAmountToNumber(result.b)).toBe(0)
  })
})

describe('calculateShares', () => {
  it('sums to expense.amount exactly for EVENLY', () => {
    const expense = makeExpense({
      amount: 100,
      splitMode: 'EVENLY',
      paidFor: [
        makePaidFor('u1', 1),
        makePaidFor('u2', 1),
        makePaidFor('u3', 1),
      ],
    })
    const shares = calculateShares(expense)
    expect(sumValues(shares)).toBe(100)
    expect(Object.values(shares).sort((a, b) => a - b)).toEqual([33, 33, 34])
  })

  it('BY_AMOUNT mismatch gives residual to first payer', () => {
    const expense = makeExpense({
      amount: 100,
      splitMode: 'BY_AMOUNT',
      paidByList: [makePaidBy('payer', 1)],
      paidFor: [makePaidFor('u1', 30), makePaidFor('u2', 30)],
    })
    const shares = calculateShares(expense)
    expect(shares.u1).toBe(30)
    expect(shares.u2).toBe(30)
    expect(shares.payer).toBe(40)
    expect(sumValues(shares)).toBe(100)
  })

  it('payer-not-in-paidFor still receives residual for BY_AMOUNT', () => {
    const expense = makeExpense({
      amount: 101,
      splitMode: 'BY_AMOUNT',
      paidByList: [makePaidBy('payer', 1)],
      paidFor: [
        makePaidFor('u1', 10),
        makePaidFor('u2', 10),
        makePaidFor('u3', 10),
      ],
    })
    const shares = calculateShares(expense)
    expect(shares.payer).toBe(71)
    expect(shares.u1).toBe(10)
    expect(sumValues(shares)).toBe(101)
  })

  it('negative amounts distribute with toward-zero truncation', () => {
    const expense = makeExpense({
      amount: -101,
      splitMode: 'EVENLY',
      paidFor: [
        makePaidFor('u1', 1),
        makePaidFor('u2', 1),
        makePaidFor('u3', 1),
      ],
    })
    const shares = calculateShares(expense)
    expect(sumValues(shares)).toBe(-101)
  })

  it('tie-break depends on expense id seed', () => {
    const base = {
      amount: 100,
      splitMode: 'EVENLY' as const,
      paidFor: [
        makePaidFor('u1', 1),
        makePaidFor('u2', 1),
        makePaidFor('u3', 1),
      ],
    }
    // id-0/1/2 hash to distinct seed % 3 → different remainder winners.
    const a = calculateShares(makeExpense({ ...base, id: 'id-0' }))
    const b = calculateShares(makeExpense({ ...base, id: 'id-1' }))
    const c = calculateShares(makeExpense({ ...base, id: 'id-2' }))
    const aAgain = calculateShares(makeExpense({ ...base, id: 'id-0' }))
    expect(sumValues(a)).toBe(100)
    expect(sumValues(b)).toBe(100)
    expect(sumValues(c)).toBe(100)
    expect(a).toEqual(aAgain)
    expect(a).toEqual({ u1: 34, u2: 33, u3: 33 })
    expect(b).toEqual({ u1: 33, u2: 34, u3: 33 })
    expect(c).toEqual({ u1: 33, u2: 33, u3: 34 })
  })

  it('missing expense id falls back to seed 0', () => {
    const base = {
      amount: 100,
      splitMode: 'EVENLY' as const,
      paidFor: [
        makePaidFor('u1', 1),
        makePaidFor('u2', 1),
        makePaidFor('u3', 1),
      ],
    }
    const withMissingId = calculateShares(
      makeExpense({ ...base, id: undefined }),
    )
    const withEmptyId = calculateShares(makeExpense({ ...base, id: '' }))
    // seed 0: equal fracs → first by participant id ascending (u1)
    expect(withMissingId).toEqual({ u1: 34, u2: 33, u3: 33 })
    expect(withEmptyId).toEqual(withMissingId)
  })

  it('ITEMIZED cross-currency treats shares as BY_SHARES weights', () => {
    const expense = makeExpense({
      amount: 12,
      originalAmount: 20100,
      originalCurrency: 'ARS',
      conversionRate: 0.00059,
      splitMode: 'ITEMIZED',
      paidFor: [makePaidFor('alice', 6700), makePaidFor('bob', 13400)],
      paidByList: [makePaidBy('alice', 1)],
    })
    const shares = calculateShares(expense)
    expect(sumValues(shares)).toBe(12)
    expect(shares.alice + shares.bob).toBe(12)
  })
})

describe('calculatePaidByShares', () => {
  it('sums to expense.amount for EVENLY', () => {
    const expense = makeExpense({
      amount: 100,
      paidBySplitMode: 'EVENLY',
      paidByList: [
        makePaidBy('u1', 1),
        makePaidBy('u2', 1),
        makePaidBy('u3', 1),
      ],
    })
    const shares = calculatePaidByShares(expense)
    expect(sumValues(shares)).toBe(100)
  })

  it('cross-currency converts then distributes against ledger amount', () => {
    const expense = makeExpense({
      amount: 9200,
      originalAmount: 10000,
      originalCurrency: 'USD',
      conversionRate: 0.92,
      paidBySplitMode: 'BY_AMOUNT',
      paidByList: [makePaidBy('u1', 7000), makePaidBy('u2', 3000)],
    })
    const shares = calculatePaidByShares(expense)
    expect(sumValues(shares)).toBe(9200)
    // 7000*0.92=6440, 3000*0.92=2760 exact
    expect(shares.u1).toBe(6440)
    expect(shares.u2).toBe(2760)
  })

  it('cross-currency fractional remainder uses frac distribution (not first payer)', () => {
    // 7000*0.3333=2333.1, 3000*0.3333=999.9 → fracs 0.1 / 0.9 → u2 gets +1¢
    // (matches getBalances; old payerId dump would give u1 the cent).
    const expense = makeExpense({
      id: 'fx-paidby',
      amount: 3333,
      originalAmount: 10000,
      originalCurrency: 'EUR',
      conversionRate: 0.3333,
      paidBySplitMode: 'BY_AMOUNT',
      paidByList: [makePaidBy('u1', 7000), makePaidBy('u2', 3000)],
    })
    const shares = calculatePaidByShares(expense)
    expect(sumValues(shares)).toBe(3333)
    expect(shares.u1).toBe(2333)
    expect(shares.u2).toBe(1000)
  })

  it('BY_AMOUNT mismatch residual goes to first payer', () => {
    const expense = makeExpense({
      amount: 100,
      paidBySplitMode: 'BY_AMOUNT',
      paidByList: [makePaidBy('u1', 40), makePaidBy('u2', 40)],
    })
    const shares = calculatePaidByShares(expense)
    expect(shares.u1).toBe(60) // 40 + residual 20
    expect(shares.u2).toBe(40)
    expect(sumValues(shares)).toBe(100)
  })

  it('ITEMIZED paidBySplitMode treated as BY_AMOUNT', () => {
    const expense = makeExpense({
      amount: 100,
      paidBySplitMode: 'ITEMIZED',
      paidByList: [makePaidBy('u1', 60), makePaidBy('u2', 40)],
    })
    const shares = calculatePaidByShares(expense)
    expect(shares.u1).toBe(60)
    expect(shares.u2).toBe(40)
  })
})

describe('calculateShare', () => {
  it('returns 0 for reimbursements', () => {
    const expense: ShareExpense = {
      amount: 100,
      isReimbursement: true,
      splitMode: 'EVENLY',
      paidFor: [makePaidFor('u1', 1), makePaidFor('u2', 1)],
    }

    expect(calculateShare('u1', expense)).toBe(0)
    expect(calculateShare('u2', expense)).toBe(0)
  })

  it('returns 0 if participant not in paidFor', () => {
    const expense: ShareExpense = {
      amount: 100,
      isReimbursement: false,
      splitMode: 'EVENLY',
      paidFor: [makePaidFor('u1', 1), makePaidFor('u2', 1)],
    }

    expect(calculateShare('u3', expense)).toBe(0)
  })

  it('EVENLY returns integer cents summing to amount', () => {
    const expense: ShareExpense = {
      amount: 100,
      isReimbursement: false,
      splitMode: 'EVENLY',
      paidFor: [
        makePaidFor('u1', 1),
        makePaidFor('u2', 1),
        makePaidFor('u3', 1),
      ],
    }

    const s1 = calculateShare('u1', expense)
    const s2 = calculateShare('u2', expense)
    const s3 = calculateShare('u3', expense)
    expect(s1 + s2 + s3).toBe(100)
    expect([s1, s2, s3].sort((a, b) => a - b)).toEqual([33, 33, 34])
  })

  it('BY_AMOUNT returns exact share amount', () => {
    const expense: ShareExpense = {
      amount: 999,
      isReimbursement: false,
      splitMode: 'BY_AMOUNT',
      paidFor: [makePaidFor('u1', 123), makePaidFor('u2', 456)],
      paidByList: [makePaidBy('payer', 1)],
    }

    // residual 999-123-456=420 goes to payer; participants keep literals
    expect(calculateShare('u1', expense)).toBe(123)
    expect(calculateShare('u2', expense)).toBe(456)
  })

  it('BY_PERCENTAGE calculates share using shares/10000', () => {
    const expense: ShareExpense = {
      amount: 1000,
      isReimbursement: false,
      splitMode: 'BY_PERCENTAGE',
      paidFor: [makePaidFor('u1', 2500), makePaidFor('u2', 7500)],
    }

    expect(calculateShare('u1', expense)).toBe(250)
    expect(calculateShare('u2', expense)).toBe(750)
  })

  it('BY_SHARES weights shares by ratio', () => {
    const expense: ShareExpense = {
      amount: 600,
      isReimbursement: false,
      splitMode: 'BY_SHARES',
      paidFor: [
        makePaidFor('u1', 1),
        makePaidFor('u2', 2),
        makePaidFor('u3', 3),
      ],
    }

    expect(calculateShare('u1', expense)).toBe(100)
    expect(calculateShare('u2', expense)).toBe(200)
    expect(calculateShare('u3', expense)).toBe(300)
  })

  it('ITEMIZED returns exact share (cents) for each participant', () => {
    const expense: ShareExpense = {
      amount: 10000,
      isReimbursement: false,
      splitMode: 'ITEMIZED',
      paidFor: [makePaidFor('alice', 7000), makePaidFor('bob', 3000)],
      paidByList: [makePaidBy('alice', 1)],
    }

    expect(calculateShare('alice', expense)).toBe(7000)
    expect(calculateShare('bob', expense)).toBe(3000)
  })

  it('ITEMIZED cross-currency shares are weighted against the ledger amount', () => {
    const expense: ShareExpense = {
      amount: 12,
      originalAmount: 20100,
      originalCurrency: 'ARS',
      conversionRate: 0.00059,
      isReimbursement: false,
      splitMode: 'ITEMIZED',
      paidFor: [makePaidFor('alice', 6700), makePaidFor('bob', 13400)],
      paidByList: [makePaidBy('alice', 1)],
    }

    const alice = calculateShare('alice', expense)
    const bob = calculateShare('bob', expense)
    expect(alice + bob).toBe(12)
  })

  it('mixed EVENLY + ITEMIZED totals for calculateShare', () => {
    const aliceShare1 = calculateShare('alice', {
      amount: 600,
      isReimbursement: false,
      splitMode: 'EVENLY',
      paidFor: [
        makePaidFor('alice', 1),
        makePaidFor('bob', 1),
        makePaidFor('carol', 1),
      ],
    })
    const aliceShare2 = calculateShare('alice', {
      amount: 1000,
      isReimbursement: false,
      splitMode: 'ITEMIZED',
      paidFor: [
        makePaidFor('alice', 300),
        makePaidFor('bob', 200),
        makePaidFor('carol', 500),
      ],
      paidByList: [makePaidBy('alice', 1)],
    })

    expect(aliceShare1).toBe(200)
    expect(aliceShare2).toBe(300)
    expect(aliceShare1 + aliceShare2).toBe(500)
  })

  it('delegates to calculateShares', () => {
    const expense = makeExpense({
      amount: 100,
      splitMode: 'EVENLY',
      paidFor: [
        makePaidFor('u1', 1),
        makePaidFor('u2', 1),
        makePaidFor('u3', 1),
      ],
    })
    const all = calculateShares(expense)
    expect(calculateShare('u1', expense)).toBe(all.u1)
    expect(calculateShare('u2', expense)).toBe(all.u2)
  })
})

describe('calculatePaidByShare', () => {
  it('returns 0 for reimbursements', () => {
    const expense: PaidByShareExpense = {
      amount: 100,
      isReimbursement: true,
      paidBySplitMode: 'EVENLY',
      paidByList: [makePaidBy('u1', 1), makePaidBy('u2', 1)],
    }

    expect(calculatePaidByShare('u1', expense)).toBe(0)
    expect(calculatePaidByShare('u2', expense)).toBe(0)
  })

  it('returns 0 if participant not in paidByList', () => {
    const expense: PaidByShareExpense = {
      amount: 100,
      isReimbursement: false,
      paidBySplitMode: 'EVENLY',
      paidByList: [makePaidBy('u1', 1), makePaidBy('u2', 1)],
    }

    expect(calculatePaidByShare('u3', expense)).toBe(0)
  })

  it('EVENLY divides expense amount by payer count as integer cents', () => {
    const expense: PaidByShareExpense = {
      amount: 100,
      isReimbursement: false,
      paidBySplitMode: 'EVENLY',
      paidByList: [
        makePaidBy('u1', 1),
        makePaidBy('u2', 1),
        makePaidBy('u3', 1),
      ],
    }

    const s1 = calculatePaidByShare('u1', expense)
    const s2 = calculatePaidByShare('u2', expense)
    const s3 = calculatePaidByShare('u3', expense)
    expect(s1 + s2 + s3).toBe(100)
  })

  it('BY_AMOUNT returns the literal share when sums match', () => {
    const expense: PaidByShareExpense = {
      amount: 579,
      isReimbursement: false,
      paidBySplitMode: 'BY_AMOUNT',
      paidByList: [makePaidBy('u1', 123), makePaidBy('u2', 456)],
    }

    expect(calculatePaidByShare('u1', expense)).toBe(123)
    expect(calculatePaidByShare('u2', expense)).toBe(456)
  })

  it('BY_PERCENTAGE uses shares/10000 of the amount', () => {
    const expense: PaidByShareExpense = {
      amount: 1000,
      isReimbursement: false,
      paidBySplitMode: 'BY_PERCENTAGE',
      paidByList: [makePaidBy('u1', 2500), makePaidBy('u2', 7500)],
    }

    expect(calculatePaidByShare('u1', expense)).toBe(250)
    expect(calculatePaidByShare('u2', expense)).toBe(750)
  })

  it('BY_SHARES weights by shares ratio', () => {
    const expense: PaidByShareExpense = {
      amount: 600,
      isReimbursement: false,
      paidBySplitMode: 'BY_SHARES',
      paidByList: [
        makePaidBy('u1', 1),
        makePaidBy('u2', 2),
        makePaidBy('u3', 3),
      ],
    }

    expect(calculatePaidByShare('u1', expense)).toBe(100)
    expect(calculatePaidByShare('u2', expense)).toBe(200)
    expect(calculatePaidByShare('u3', expense)).toBe(300)
  })

  it('mirrors calculateShare for each split mode', () => {
    const baseExpense = {
      amount: 600,
      isReimbursement: false,
    } as const

    for (const mode of ['EVENLY', 'BY_SHARES', 'BY_PERCENTAGE'] as const) {
      const paidFors = [
        { participant: { id: 'u1' }, shares: 1 },
        { participant: { id: 'u2' }, shares: 2 },
      ]
      const paidBys = [
        { participant: { id: 'u1' }, shares: 1 },
        { participant: { id: 'u2' }, shares: 2 },
      ]
      const sharesForMode = (
        mode === 'BY_PERCENTAGE' ? [3333, 6667] : [1, 2]
      ) as [number, number]

      const paidForExpense = {
        ...baseExpense,
        splitMode: mode,
        paidFor:
          mode === 'BY_PERCENTAGE'
            ? [
                { participant: { id: 'u1' }, shares: sharesForMode[0] },
                { participant: { id: 'u2' }, shares: sharesForMode[1] },
              ]
            : paidFors,
      }
      const paidByExpense = {
        ...baseExpense,
        paidBySplitMode: mode,
        paidByList:
          mode === 'BY_PERCENTAGE'
            ? [
                { participant: { id: 'u1' }, shares: sharesForMode[0] },
                { participant: { id: 'u2' }, shares: sharesForMode[1] },
              ]
            : paidBys,
      }

      const shareU1 = calculateShare('u1', paidForExpense)
      const shareU2 = calculateShare('u2', paidForExpense)
      const paidByU1 = calculatePaidByShare('u1', paidByExpense)
      const paidByU2 = calculatePaidByShare('u2', paidByExpense)

      expect(paidByU1).toBe(shareU1)
      expect(paidByU2).toBe(shareU2)
    }
  })

  it('cross-currency BY_AMOUNT returns the share converted to ledger currency', () => {
    const expense: PaidByShareExpense = {
      amount: 9200,
      isReimbursement: false,
      paidBySplitMode: 'BY_AMOUNT',
      originalAmount: 10000,
      originalCurrency: 'USD',
      conversionRate: 0.92,
      paidByList: [makePaidBy('u1', 7000), makePaidBy('u2', 3000)],
    }

    expect(calculatePaidByShare('u1', expense)).toBe(6440)
    expect(calculatePaidByShare('u2', expense)).toBe(2760)
  })

  it('cross-currency BY_PERCENTAGE converts after percentage of original', () => {
    const expense: PaidByShareExpense = {
      amount: 9200,
      isReimbursement: false,
      paidBySplitMode: 'BY_PERCENTAGE',
      originalAmount: 10000,
      originalCurrency: 'USD',
      conversionRate: 0.92,
      paidByList: [makePaidBy('u1', 5000), makePaidBy('u2', 5000)],
    }

    expect(calculatePaidByShare('u1', expense)).toBe(4600)
    expect(calculatePaidByShare('u2', expense)).toBe(4600)
  })

  it('cross-currency getTotalActiveUserPaidFor converts each expense independently', () => {
    const expenses: TotalsExpense[] = [
      makeExpense({
        id: 'e1',
        amount: 9200,
        paidBySplitMode: 'BY_AMOUNT',
        originalAmount: 10000,
        originalCurrency: 'USD',
        conversionRate: 0.92,
        paidByList: [makePaidBy('u1', 7000), makePaidBy('u2', 3000)],
      }),
      makeExpense({
        id: 'e2',
        amount: 1840,
        paidBySplitMode: 'BY_AMOUNT',
        originalAmount: 2000,
        originalCurrency: 'USD',
        conversionRate: 0.92,
        paidByList: [makePaidBy('u3', 2000)],
      }),
    ]

    // Old getBalances: Math.round(7000*0.92) = 6440
    expect(getTotalActiveUserPaidFor('u1', expenses)).toBe(6440)
  })
})

describe('serializePaidFor', () => {
  const usd = getCurrency('USD')!

  it('BY_AMOUNT converts major units to minor units', () => {
    const result = serializePaidFor({
      splitMode: 'BY_AMOUNT',
      amount: 100,
      currency: usd,
      paidFor: [
        { participant: { id: 'a' }, shares: 10.5 },
        { participant: { id: 'b' }, shares: 20 },
      ],
    })
    expect(result.map((p) => p.shares)).toEqual([1050, 2000])
  })

  it('BY_AMOUNT with conversionRate converts original → ledger', () => {
    const result = serializePaidFor({
      splitMode: 'BY_AMOUNT',
      amount: 92,
      currency: usd,
      conversionRate: 0.92,
      paidFor: [
        { participant: { id: 'a' }, shares: 70 },
        { participant: { id: 'b' }, shares: 30 },
      ],
    })
    // amountAsMinorUnits(70*0.92, USD) = round(64.4 * 100) = 6440
    expect(result.map((p) => p.shares)).toEqual([6440, 2760])
  })

  it('BY_PERCENTAGE converts to basis points', () => {
    const result = serializePaidFor({
      splitMode: 'BY_PERCENTAGE',
      amount: 100,
      currency: usd,
      paidFor: [
        { participant: { id: 'a' }, shares: 25 },
        { participant: { id: 'b' }, shares: 75 },
      ],
    })
    expect(result.map((p) => p.shares)).toEqual([2500, 7500])
  })

  it('EVENLY/BY_SHARES round weights', () => {
    const evenly = serializePaidFor({
      splitMode: 'EVENLY',
      amount: 100,
      currency: usd,
      paidFor: [
        { participant: { id: 'a' }, shares: 1.2 },
        { participant: { id: 'b' }, shares: 1.8 },
      ],
    })
    expect(evenly.map((p) => p.shares)).toEqual([1, 2])

    const byShares = serializePaidFor({
      splitMode: 'BY_SHARES',
      amount: 100,
      currency: usd,
      paidFor: [
        { participant: { id: 'a' }, shares: 1.4 },
        { participant: { id: 'b' }, shares: 2.6 },
      ],
    })
    expect(byShares.map((p) => p.shares)).toEqual([1, 3])
  })

  it('does not convert unitless modes with conversionRate', () => {
    const result = serializePaidFor({
      splitMode: 'BY_PERCENTAGE',
      amount: 100,
      currency: usd,
      conversionRate: 0.92,
      paidFor: [
        { participant: { id: 'a' }, shares: 50 },
        { participant: { id: 'b' }, shares: 50 },
      ],
    })
    expect(result.map((p) => p.shares)).toEqual([5000, 5000])
  })

  it('ITEMIZED same as BY_AMOUNT', () => {
    const result = serializePaidFor({
      splitMode: 'ITEMIZED',
      amount: 100,
      currency: usd,
      paidFor: [{ participant: { id: 'a' }, shares: 12.34 }],
    })
    expect(result[0].shares).toBe(1234)
  })
})

describe('serializePaidBy', () => {
  const usd = getCurrency('USD')!
  const eur = getCurrency('EUR')!

  it('BY_AMOUNT always stores original/input currency minor units', () => {
    const result = serializePaidBy({
      paidBySplitMode: 'BY_AMOUNT',
      amount: 100,
      inputCurrency: usd,
      conversionRate: 0.92,
      paidByList: [
        { participant: { id: 'a' }, shares: 70 },
        { participant: { id: 'b' }, shares: 30 },
      ],
    })
    // NOT multiplied by conversionRate
    expect(result.map((p) => p.shares)).toEqual([7000, 3000])
  })

  it('BY_PERCENTAGE converts to BPS', () => {
    const result = serializePaidBy({
      paidBySplitMode: 'BY_PERCENTAGE',
      amount: 100,
      inputCurrency: eur,
      paidByList: [
        { participant: { id: 'a' }, shares: 33.33 },
        { participant: { id: 'b' }, shares: 66.67 },
      ],
    })
    expect(result.map((p) => p.shares)).toEqual([3333, 6667])
  })

  it('EVENLY/BY_SHARES round weights', () => {
    const result = serializePaidBy({
      paidBySplitMode: 'EVENLY',
      amount: 100,
      inputCurrency: usd,
      paidByList: [
        { participant: { id: 'a' }, shares: 1 },
        { participant: { id: 'b' }, shares: 1 },
      ],
    })
    expect(result.map((p) => p.shares)).toEqual([1, 1])
  })

  it('ITEMIZED paidBy treated as BY_AMOUNT', () => {
    const result = serializePaidBy({
      paidBySplitMode: 'ITEMIZED',
      amount: 100,
      inputCurrency: usd,
      paidByList: [{ participant: { id: 'a' }, shares: 5.5 }],
    })
    expect(result[0].shares).toBe(550)
  })
})
