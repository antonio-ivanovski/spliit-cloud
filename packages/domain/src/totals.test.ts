import {
  calculatePaidByShare,
  calculateShare,
  getTotalActiveUserPaidFor,
  getTotalActiveUserShare,
  getTotalGroupSpending,
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

  // ---------------------------------------------------------------------------
  // Multi-payer tests (Phase 1: getTotalActiveUserPaidFor walks paidByList)
  // ---------------------------------------------------------------------------

  it("multi-payer EVENLY splits each payer's contribution among themselves", () => {
    // 100-cent expense split evenly among u1 and u2 as payers.
    // u1's share is 50 cents per expense, summed across two expenses.
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

    // e1: u1 pays 100/2 = 50; e2: u1 pays 200/3 ≈ 66.67 → ≈ 116.67
    expect(getTotalActiveUserPaidFor('u1', expenses)).toBeCloseTo(
      50 + 200 / 3,
      2,
    )
  })

  it("multi-payer BY_AMOUNT records each payer's literal share contribution", () => {
    // u1's contribution is exactly the shares value when BY_AMOUNT.
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
    // e1: total shares = 3, u1 has 1 → u1 pays 100 * 1/3 ≈ 33.33
    // e2: total shares = 5, u1 has 2 → u1 pays 200 * 2/5 = 80
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

    expect(getTotalActiveUserPaidFor('u1', expenses)).toBeCloseTo(
      100 * (1 / 3) + 80,
      2,
    )
  })

  it('multi-payer BY_PERCENTAGE returns amount × shares / 10000 for each payer', () => {
    // e1: u1 has 3000bp = 30% → 1000 * 0.30 = 300
    // e2: u1 has 5000bp = 50% → 2000 * 0.50 = 1000
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

    expect(getTotalActiveUserPaidFor('u1', expenses)).toBeCloseTo(300 + 1000, 2)
  })
})

describe('getTotalActiveUserShare', () => {
  it('sums active user shares across expenses', () => {
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

    expect(getTotalActiveUserShare('u1', expenses)).toBeCloseTo(
      100 / 3 + 30 + 25,
      2,
    )
  })

  it('rounds total share to 2 decimals', () => {
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

    expect(total).toBe(33.67)
    expect(total.toFixed(2)).toBe('33.67')
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

  it('EVENLY divides expense amount by participants', () => {
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

    expect(calculateShare('u1', expense)).toBeCloseTo(100 / 3)
    expect(calculateShare('u2', expense)).toBeCloseTo(100 / 3)
    expect(calculateShare('u3', expense)).toBeCloseTo(100 / 3)
  })

  it('BY_AMOUNT returns exact share amount', () => {
    const expense: ShareExpense = {
      amount: 999,
      isReimbursement: false,
      splitMode: 'BY_AMOUNT',
      paidFor: [makePaidFor('u1', 123), makePaidFor('u2', 456)],
    }

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
    }

    expect(calculateShare('alice', expense)).toBeCloseTo(4)
    expect(calculateShare('bob', expense)).toBeCloseTo(8)
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
    })

    expect(aliceShare1).toBe(200)
    expect(aliceShare2).toBe(300)
    expect(aliceShare1 + aliceShare2).toBe(500)
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

  it('EVENLY divides expense amount by payer count', () => {
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

    expect(calculatePaidByShare('u1', expense)).toBeCloseTo(100 / 3)
    expect(calculatePaidByShare('u2', expense)).toBeCloseTo(100 / 3)
    expect(calculatePaidByShare('u3', expense)).toBeCloseTo(100 / 3)
  })

  it('BY_AMOUNT returns the literal share', () => {
    const expense: PaidByShareExpense = {
      amount: 999,
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

  // Symmetric coverage vs calculateShare: same mode math on the payer side
  // mirrors the same mode math on the paidFor side. Both are regression
  // guards for the symmetry claim in the design notes.
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
      // shares for BY_PERCENTAGE / BY_SHARES must match: 1 vs 2 out of 3.
      // For BY_PERCENTAGE we encode that as 3333 / 6667 ≈ 33.33% / 66.67%
      // (we use the BPS-as-shares convention, not raw percentages).
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

      expect(paidByU1).toBeCloseTo(shareU1, 5)
      expect(paidByU2).toBeCloseTo(shareU2, 5)
    }
  })

  // ---------------------------------------------------------------------------
  // Phase 1b: when originalCurrency + conversionRate are set, shares are
  // in original currency cents and the returned paid amount is converted
  // to ledger currency.
  // ---------------------------------------------------------------------------

  it('cross-currency BY_AMOUNT returns the share converted to ledger currency', () => {
    // Group EUR, paid USD. originalAmount=10000 USD cents, conversionRate=0.92.
    // u1's share of 7000 USD cents → round(7000 * 0.92) = 6440 EUR cents.
    const expense: PaidByShareExpense = {
      amount: 9200,
      isReimbursement: false,
      paidBySplitMode: 'BY_AMOUNT',
      originalAmount: 10000,
      originalCurrency: 'USD',
      conversionRate: 0.92,
      paidByList: [makePaidBy('u1', 7000), makePaidBy('u2', 3000)],
    }

    expect(calculatePaidByShare('u1', expense)).toBe(Math.round(7000 * 0.92))
    expect(calculatePaidByShare('u2', expense)).toBe(Math.round(3000 * 0.92))
  })

  it('cross-currency BY_PERCENTAGE returns base × shares/10000 × conversionRate', () => {
    // 50% of 10000 USD cents = 5000 USD cents, converted at 0.92 = 4600 EUR.
    const expense: PaidByShareExpense = {
      amount: 9200,
      isReimbursement: false,
      paidBySplitMode: 'BY_PERCENTAGE',
      originalAmount: 10000,
      originalCurrency: 'USD',
      conversionRate: 0.92,
      paidByList: [makePaidBy('u1', 5000), makePaidBy('u2', 5000)],
    }

    expect(calculatePaidByShare('u1', expense)).toBe(Math.round(5000 * 0.92))
    expect(calculatePaidByShare('u2', expense)).toBe(Math.round(5000 * 0.92))
  })

  it('cross-currency getTotalActiveUserPaidFor converts each expense independently', () => {
    // Two cross-currency expenses; only one names u1 as payer.
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

    expect(getTotalActiveUserPaidFor('u1', expenses)).toBe(
      Math.round(7000 * 0.92),
    )
  })
})
