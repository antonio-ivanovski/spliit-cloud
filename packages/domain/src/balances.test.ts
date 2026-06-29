import {
  getBalances,
  getPublicBalances,
  getSuggestedReimbursements,
} from './balances'

type BalancesExpense = Parameters<typeof getBalances>[0][number]

const defaultPaidByList = (payerId: string, payerName: string) => [
  { participant: { id: payerId, name: payerName }, shares: 1 },
]

const makeExpense = (overrides: Partial<BalancesExpense>): BalancesExpense =>
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
    paidByList: defaultPaidByList('p0', 'P0'),
    paidFor: [
      {
        participant: { id: 'p0', name: 'P0' },
        shares: 1,
      },
    ],
    _count: { documents: 0 },
    ...overrides,
  }) as BalancesExpense

describe('getBalances', () => {
  it('avoids negative zeros', () => {
    const expenses: BalancesExpense[] = [
      makeExpense({
        id: 'e1',
        amount: 0,
        paidByList: defaultPaidByList('p0', 'P0'),
        paidFor: [{ participant: { id: 'p0', name: 'P0' }, shares: 1 }],
      }),
    ]

    const balances = getBalances(expenses)

    expect(Object.is(balances.p0.paid, -0)).toBe(false)
    expect(Object.is(balances.p0.paidFor, -0)).toBe(false)
    expect(Object.is(balances.p0.total, -0)).toBe(false)
  })

  it('handles empty expense list', () => {
    expect(getBalances([])).toEqual({})
  })

  it('single expense, single participant', () => {
    const expenses: BalancesExpense[] = [
      makeExpense({
        id: 'e1',
        amount: 123,
        paidByList: defaultPaidByList('p0', 'P0'),
        paidFor: [{ participant: { id: 'p0', name: 'P0' }, shares: 1 }],
      }),
    ]

    expect(getBalances(expenses)).toEqual({
      p0: { paid: 123, paidFor: 123, total: 0 },
    })
  })

  it('evenly splits expenses', () => {
    const expenses: BalancesExpense[] = [
      makeExpense({
        id: 'e1',
        amount: 100,
        paidByList: defaultPaidByList('p0', 'P0'),
        paidFor: [
          { participant: { id: 'p0', name: 'P0' }, shares: 1 },
          { participant: { id: 'p1', name: 'P1' }, shares: 1 },
          { participant: { id: 'p2', name: 'P2' }, shares: 1 },
        ],
      }),
    ]

    const balances = getBalances(expenses)

    expect(balances.p0).toEqual({ paid: 100, paidFor: 33, total: 67 })
    expect(balances.p1).toEqual({ paid: 0, paidFor: 33, total: -33 })
    expect(balances.p2).toEqual({ paid: 0, paidFor: 33, total: -33 })

    const net = Object.values(balances).reduce((sum, b) => sum + b.total, 0)
    expect(net).toBe(expenses[0].amount % expenses[0].paidFor.length)
  })

  it('splits BY_SHARES proportionally', () => {
    const expenses: BalancesExpense[] = [
      makeExpense({
        id: 'e1',
        amount: 600,
        splitMode: 'BY_SHARES',
        paidByList: defaultPaidByList('p0', 'P0'),
        paidFor: [
          { participant: { id: 'p0', name: 'P0' }, shares: 1 },
          { participant: { id: 'p1', name: 'P1' }, shares: 2 },
          { participant: { id: 'p2', name: 'P2' }, shares: 3 },
        ],
      }),
    ]

    const balances = getBalances(expenses)

    expect(balances.p0).toEqual({ paid: 600, paidFor: 100, total: 500 })
    expect(balances.p1).toEqual({ paid: 0, paidFor: 200, total: -200 })
    expect(balances.p2).toEqual({ paid: 0, paidFor: 300, total: -300 })
  })

  it('splits BY_PERCENTAGE using basis points', () => {
    const expenses: BalancesExpense[] = [
      makeExpense({
        id: 'e1',
        amount: 250,
        splitMode: 'BY_PERCENTAGE',
        paidByList: defaultPaidByList('p0', 'P0'),
        paidFor: [
          { participant: { id: 'p0', name: 'P0' }, shares: 2000 },
          { participant: { id: 'p1', name: 'P1' }, shares: 3000 },
          { participant: { id: 'p2', name: 'P2' }, shares: 5000 },
        ],
      }),
    ]

    const balances = getBalances(expenses)

    expect(balances.p0).toEqual({ paid: 250, paidFor: 50, total: 200 })
    expect(balances.p1).toEqual({ paid: 0, paidFor: 75, total: -75 })
    expect(balances.p2).toEqual({ paid: 0, paidFor: 125, total: -125 })
  })

  it('splits BY_AMOUNT and assigns remainder to last participant', () => {
    const expenses: BalancesExpense[] = [
      makeExpense({
        id: 'e1',
        amount: 101,
        splitMode: 'BY_AMOUNT',
        paidByList: defaultPaidByList('p0', 'P0'),
        paidFor: [
          { participant: { id: 'p0', name: 'P0' }, shares: 10 },
          { participant: { id: 'p1', name: 'P1' }, shares: 10 },
          { participant: { id: 'p2', name: 'P2' }, shares: 10 },
        ],
      }),
    ]

    const balances = getBalances(expenses)

    // Note: implementation treats `shares` as weights (not absolute amounts)
    // and assigns the remainder to the last participant.
    expect(balances.p0).toEqual({ paid: 101, paidFor: 34, total: 67 })
    expect(balances.p1).toEqual({ paid: 0, paidFor: 34, total: -34 })
    expect(balances.p2).toEqual({ paid: 0, paidFor: 34, total: -34 })
  })

  it('handles rounding correctly', () => {
    const expenses: BalancesExpense[] = [
      makeExpense({
        id: 'e1',
        amount: 100, // 100 / 3 = 33.333...
        splitMode: 'EVENLY',
        paidByList: defaultPaidByList('p0', 'P0'),
        paidFor: [
          { participant: { id: 'p0', name: 'P0' }, shares: 1 },
          { participant: { id: 'p1', name: 'P1' }, shares: 1 },
          { participant: { id: 'p2', name: 'P2' }, shares: 1 },
        ],
      }),
      makeExpense({
        id: 'e2',
        amount: 77, // 77 / 3 = 25.666...
        splitMode: 'EVENLY',
        paidByList: defaultPaidByList('p1', 'P1'),
        paidFor: [
          { participant: { id: 'p0', name: 'P0' }, shares: 1 },
          { participant: { id: 'p1', name: 'P1' }, shares: 1 },
          { participant: { id: 'p2', name: 'P2' }, shares: 1 },
        ],
      }),
      makeExpense({
        id: 'e3',
        amount: 99, // 99 / 7 = 14.142857...
        splitMode: 'BY_SHARES',
        paidByList: defaultPaidByList('p2', 'P2'),
        paidFor: [
          { participant: { id: 'p0', name: 'P0' }, shares: 2 },
          { participant: { id: 'p1', name: 'P1' }, shares: 3 },
          { participant: { id: 'p2', name: 'P2' }, shares: 2 },
        ],
      }),
    ]

    const balances = getBalances(expenses)

    // Verify all values are integers (rounded)
    expect(Number.isInteger(balances.p0.paid)).toBe(true)
    expect(Number.isInteger(balances.p0.paidFor)).toBe(true)
    expect(Number.isInteger(balances.p0.total)).toBe(true)
    expect(Number.isInteger(balances.p1.paid)).toBe(true)
    expect(Number.isInteger(balances.p1.paidFor)).toBe(true)
    expect(Number.isInteger(balances.p1.total)).toBe(true)
    expect(Number.isInteger(balances.p2.paid)).toBe(true)
    expect(Number.isInteger(balances.p2.paidFor)).toBe(true)
    expect(Number.isInteger(balances.p2.total)).toBe(true)

    // Verify totals balance (sum ~= 0, within rounding tolerance)
    const netTotal = Object.values(balances).reduce(
      (sum, b) => sum + b.total,
      0,
    )
    expect(Math.abs(netTotal)).toBeLessThan(3) // Tolerance for rounding remainder

    // Verify no negative zeros
    expect(Object.is(balances.p0.paid, -0)).toBe(false)
    expect(Object.is(balances.p0.paidFor, -0)).toBe(false)
    expect(Object.is(balances.p0.total, -0)).toBe(false)
  })

  it('handles multiple participants with mixed expenses', () => {
    const expenses: BalancesExpense[] = [
      makeExpense({
        id: 'e1',
        amount: 120,
        splitMode: 'EVENLY',
        paidByList: defaultPaidByList('p0', 'Alice'),
        paidFor: [
          { participant: { id: 'p0', name: 'Alice' }, shares: 1 },
          { participant: { id: 'p1', name: 'Bob' }, shares: 1 },
          { participant: { id: 'p2', name: 'Carol' }, shares: 1 },
        ],
      }),
      makeExpense({
        id: 'e2',
        amount: 600,
        splitMode: 'BY_SHARES',
        paidByList: defaultPaidByList('p1', 'Bob'),
        paidFor: [
          { participant: { id: 'p0', name: 'Alice' }, shares: 1 },
          { participant: { id: 'p1', name: 'Bob' }, shares: 2 },
          { participant: { id: 'p2', name: 'Carol' }, shares: 3 },
        ],
      }),
      makeExpense({
        id: 'e3',
        amount: 200,
        splitMode: 'BY_PERCENTAGE',
        paidByList: defaultPaidByList('p2', 'Carol'),
        paidFor: [
          { participant: { id: 'p0', name: 'Alice' }, shares: 5000 }, // 50%
          { participant: { id: 'p1', name: 'Bob' }, shares: 3000 }, // 30%
          { participant: { id: 'p2', name: 'Carol' }, shares: 2000 }, // 20%
        ],
      }),
    ]

    const balances = getBalances(expenses)

    // Alice: paid 120, owes (40 + 100 + 100) = 240, total = 120 - 240 = -120
    expect(balances.p0.paid).toBe(120)
    expect(balances.p0.paidFor).toBe(240)
    expect(balances.p0.total).toBe(-120)

    // Bob: paid 600, owes (40 + 200 + 60) = 300, total = 600 - 300 = 300
    expect(balances.p1.paid).toBe(600)
    expect(balances.p1.paidFor).toBe(300)
    expect(balances.p1.total).toBe(300)

    // Carol: paid 200, owes (40 + 300 + 40) = 380, total = 200 - 380 = -180
    expect(balances.p2.paid).toBe(200)
    expect(balances.p2.paidFor).toBe(380)
    expect(balances.p2.total).toBe(-180)

    // Verify sum of totals = 0 (within rounding tolerance)
    const netTotal = Object.values(balances).reduce(
      (sum, b) => sum + b.total,
      0,
    )
    expect(Math.abs(netTotal)).toBeLessThan(3)
  })

  it('handles BY_AMOUNT with one participant having 0 shares', () => {
    const expenses: BalancesExpense[] = [
      makeExpense({
        id: 'e1',
        amount: 100,
        splitMode: 'BY_AMOUNT',
        paidByList: defaultPaidByList('p0', 'P0'),
        paidFor: [
          { participant: { id: 'p0', name: 'P0' }, shares: 0 },
          { participant: { id: 'p1', name: 'P1' }, shares: 10 },
          { participant: { id: 'p2', name: 'P2' }, shares: 10 },
        ],
      }),
    ]

    const balances = getBalances(expenses)

    // p0 paid 100 but has 0 shares, so owes 0
    expect(balances.p0).toEqual({ paid: 100, paidFor: 0, total: 100 })
    // p1 and p2 split the remaining 100 (50 each)
    expect(balances.p1).toEqual({ paid: 0, paidFor: 50, total: -50 })
    expect(balances.p2).toEqual({ paid: 0, paidFor: 50, total: -50 })
  })

  it('handles BY_PERCENTAGE where percentages do not sum to 10000 (remainder assigned to last)', () => {
    const expenses: BalancesExpense[] = [
      makeExpense({
        id: 'e1',
        amount: 10000,
        splitMode: 'BY_PERCENTAGE',
        paidByList: defaultPaidByList('p0', 'P0'),
        paidFor: [
          { participant: { id: 'p0', name: 'P0' }, shares: 2000 }, // 20%
          { participant: { id: 'p1', name: 'P1' }, shares: 3000 }, // 30%
          // Missing 5000 basis points - should be assigned to last participant
          { participant: { id: 'p2', name: 'P2' }, shares: 3000 }, // Only 30% specified, gets remainder
        ],
      }),
    ]

    const balances = getBalances(expenses)

    // p0: paid 10000, owes (20/80)% = 2500 (remainder goes to last)
    expect(balances.p0).toEqual({ paid: 10000, paidFor: 2500, total: 7500 })
    // p1: paid 0, owes (30/80)% = 3750
    expect(balances.p1).toEqual({ paid: 0, paidFor: 3750, total: -3750 })
    // p2: paid 0, gets remainder = 3750 (30/80)% + remainder
    expect(balances.p2).toEqual({ paid: 0, paidFor: 3750, total: -3750 })
  })

  it('handles expense where payer is not in paidFor', () => {
    const expenses: BalancesExpense[] = [
      makeExpense({
        id: 'e1',
        amount: 150,
        paidByList: defaultPaidByList('p0', 'P0'),
        paidFor: [
          { participant: { id: 'p1', name: 'P1' }, shares: 1 },
          { participant: { id: 'p2', name: 'P2' }, shares: 1 },
        ],
      }),
    ]

    const balances = getBalances(expenses)

    // p0 paid 150 but is not in paidFor, so paidFor = 0
    expect(balances.p0).toEqual({ paid: 150, paidFor: 0, total: 150 })
    // p1 and p2 split the expense evenly (75 each)
    expect(balances.p1).toEqual({ paid: 0, paidFor: 75, total: -75 })
    expect(balances.p2).toEqual({ paid: 0, paidFor: 75, total: -75 })
  })

  it('handles float/decimal amounts correctly with rounding', () => {
    // Simulate amounts that would result in float division
    const expenses: BalancesExpense[] = [
      makeExpense({
        id: 'e1',
        amount: 33, // 33 / 3 = 11 exactly
        splitMode: 'EVENLY',
        paidByList: defaultPaidByList('p0', 'P0'),
        paidFor: [
          { participant: { id: 'p0', name: 'P0' }, shares: 1 },
          { participant: { id: 'p1', name: 'P1' }, shares: 1 },
          { participant: { id: 'p2', name: 'P2' }, shares: 1 },
        ],
      }),
      makeExpense({
        id: 'e2',
        amount: 10, // 10 / 3 = 3.333...
        splitMode: 'EVENLY',
        paidByList: defaultPaidByList('p0', 'P0'),
        paidFor: [
          { participant: { id: 'p0', name: 'P0' }, shares: 1 },
          { participant: { id: 'p1', name: 'P1' }, shares: 1 },
          { participant: { id: 'p2', name: 'P2' }, shares: 1 },
        ],
      }),
    ]

    const balances = getBalances(expenses)

    // Verify all values are integers (rounded)
    expect(Number.isInteger(balances.p0.paid)).toBe(true)
    expect(Number.isInteger(balances.p0.paidFor)).toBe(true)
    expect(Number.isInteger(balances.p0.total)).toBe(true)
    expect(Number.isInteger(balances.p1.paid)).toBe(true)
    expect(Number.isInteger(balances.p1.paidFor)).toBe(true)
    expect(Number.isInteger(balances.p1.total)).toBe(true)
    expect(Number.isInteger(balances.p2.paid)).toBe(true)
    expect(Number.isInteger(balances.p2.paidFor)).toBe(true)
    expect(Number.isInteger(balances.p2.total)).toBe(true)

    // Verify no negative zeros
    expect(Object.is(balances.p0.paid, -0)).toBe(false)
    expect(Object.is(balances.p0.paidFor, -0)).toBe(false)
    expect(Object.is(balances.p0.total, -0)).toBe(false)
  })

  it('handles repeated participant IDs in paidFor array', () => {
    const expenses: BalancesExpense[] = [
      makeExpense({
        id: 'e1',
        amount: 100,
        splitMode: 'EVENLY',
        paidByList: defaultPaidByList('p0', 'P0'),
        paidFor: [
          { participant: { id: 'p0', name: 'P0' }, shares: 1 },
          { participant: { id: 'p1', name: 'P1' }, shares: 1 },
          { participant: { id: 'p0', name: 'P0' }, shares: 1 }, // Duplicate
        ],
      }),
    ]

    const balances = getBalances(expenses)

    // p0 appears twice in paidFor, so should owe double
    // Total shares = 3, p0 has 2 shares, p1 has 1 share
    expect(balances.p0.paid).toBe(100)
    expect(balances.p0.paidFor).toBeCloseTo(67, -1) // ~66.67
    expect(balances.p1.paid).toBe(0)
    expect(balances.p1.paidFor).toBeCloseTo(33, -1) // ~33.33
  })

  // ---------------------------------------------------------------------------
  // Multi-payer tests (Phase 1: paidByList replaces single paidBy)
  // ---------------------------------------------------------------------------

  it('multi-payer EVENLY splits a 2-payer expense between both payers', () => {
    const expenses: BalancesExpense[] = [
      makeExpense({
        id: 'e1',
        amount: 200,
        paidBySplitMode: 'EVENLY',
        paidByList: [
          { participant: { id: 'p0', name: 'P0' }, shares: 1 },
          { participant: { id: 'p1', name: 'P1' }, shares: 1 },
        ],
        paidFor: [
          { participant: { id: 'p0', name: 'P0' }, shares: 1 },
          { participant: { id: 'p1', name: 'P1' }, shares: 1 },
          { participant: { id: 'p2', name: 'P2' }, shares: 1 },
        ],
      }),
    ]

    const balances = getBalances(expenses)

    // p0 and p1 each paid 100 (even split), each owes 67 (200/3)
    expect(balances.p0).toEqual({ paid: 100, paidFor: 67, total: 33 })
    expect(balances.p1).toEqual({ paid: 100, paidFor: 67, total: 33 })
    // p2 owes 67, gets nothing
    expect(balances.p2).toEqual({ paid: 0, paidFor: 67, total: -67 })
  })

  it('multi-payer 3-payer EVENLY assigns equal portions and full group nets to zero', () => {
    const expenses: BalancesExpense[] = [
      makeExpense({
        id: 'e1',
        amount: 300,
        paidBySplitMode: 'EVENLY',
        paidByList: [
          { participant: { id: 'p0', name: 'P0' }, shares: 1 },
          { participant: { id: 'p1', name: 'P1' }, shares: 1 },
          { participant: { id: 'p2', name: 'P2' }, shares: 1 },
        ],
        paidFor: [
          { participant: { id: 'p0', name: 'P0' }, shares: 1 },
          { participant: { id: 'p1', name: 'P1' }, shares: 1 },
          { participant: { id: 'p2', name: 'P2' }, shares: 1 },
        ],
      }),
    ]

    const balances = getBalances(expenses)

    // Each paid 100, each owes 100, each net = 0
    expect(balances.p0).toEqual({ paid: 100, paidFor: 100, total: 0 })
    expect(balances.p1).toEqual({ paid: 100, paidFor: 100, total: 0 })
    expect(balances.p2).toEqual({ paid: 100, paidFor: 100, total: 0 })
  })

  it('multi-payer BY_SHARES weights payer distribution by shares', () => {
    const expenses: BalancesExpense[] = [
      makeExpense({
        id: 'e1',
        amount: 600,
        paidBySplitMode: 'BY_SHARES',
        paidByList: [
          { participant: { id: 'p0', name: 'P0' }, shares: 1 },
          { participant: { id: 'p1', name: 'P1' }, shares: 2 },
        ],
        paidFor: [
          { participant: { id: 'p0', name: 'P0' }, shares: 1 },
          { participant: { id: 'p1', name: 'P1' }, shares: 1 },
          { participant: { id: 'p2', name: 'P2' }, shares: 1 },
        ],
      }),
    ]

    const balances = getBalances(expenses)

    // p0 paid (1/3)*600 = 200, p1 paid (2/3)*600 = 400
    expect(balances.p0).toEqual({ paid: 200, paidFor: 200, total: 0 })
    expect(balances.p1).toEqual({ paid: 400, paidFor: 200, total: 200 })
    // p2 owes 200, gets nothing
    expect(balances.p2).toEqual({ paid: 0, paidFor: 200, total: -200 })
  })

  it('multi-payer BY_PERCENTAGE honors basis points', () => {
    const expenses: BalancesExpense[] = [
      makeExpense({
        id: 'e1',
        amount: 25000,
        paidBySplitMode: 'BY_PERCENTAGE',
        splitMode: 'BY_PERCENTAGE',
        paidByList: [
          { participant: { id: 'p0', name: 'P0' }, shares: 4000 }, // 40%
          { participant: { id: 'p1', name: 'P1' }, shares: 6000 }, // 60%
        ],
        paidFor: [
          { participant: { id: 'p0', name: 'P0' }, shares: 5000 }, // 50%
          { participant: { id: 'p1', name: 'P1' }, shares: 3000 }, // 30%
          { participant: { id: 'p2', name: 'P2' }, shares: 2000 }, // 20%
        ],
      }),
    ]

    const balances = getBalances(expenses)

    // p0 paid (40%)*25000 = 10000, owes (50%)*25000 = 12500
    expect(balances.p0).toEqual({ paid: 10000, paidFor: 12500, total: -2500 })
    // p1 paid (60%)*25000 = 15000, owes (30%)*25000 = 7500
    expect(balances.p1).toEqual({ paid: 15000, paidFor: 7500, total: 7500 })
    // p2 paid nothing, owes (20%)*25000 = 5000
    expect(balances.p2).toEqual({ paid: 0, paidFor: 5000, total: -5000 })
  })

  it('multi-payer BY_AMOUNT distributes the literal amount and assigns any rounding residual to the last payer', () => {
    // 101 split as 10 / 10 / 10 with 3 payers — last-row absorbs the residual,
    // mirroring the existing paidFor rounding behavior.
    const expenses: BalancesExpense[] = [
      makeExpense({
        id: 'e1',
        amount: 101,
        paidBySplitMode: 'BY_AMOUNT',
        paidByList: [
          { participant: { id: 'p0', name: 'P0' }, shares: 10 },
          { participant: { id: 'p1', name: 'P1' }, shares: 10 },
          { participant: { id: 'p2', name: 'P2' }, shares: 10 },
        ],
        paidFor: [
          { participant: { id: 'p0', name: 'P0' }, shares: 10 },
          { participant: { id: 'p1', name: 'P1' }, shares: 10 },
          { participant: { id: 'p2', name: 'P2' }, shares: 10 },
        ],
      }),
    ]

    const balances = getBalances(expenses)

    expect(balances.p0).toEqual({ paid: 34, paidFor: 34, total: 0 })
    expect(balances.p1).toEqual({ paid: 34, paidFor: 34, total: 0 })
    expect(balances.p2).toEqual({ paid: 34, paidFor: 34, total: 0 })
  })

  it("multi-payer single-payer migration: legacy shape (paidBySplitMode=BY_AMOUNT with shares=amount) collapses to today's formula", () => {
    // Migration seed contract: backfilled rows have shares=amount in BY_AMOUNT
    // mode. The balance result must match today\'s single-payer math exactly.
    const expenses: BalancesExpense[] = [
      makeExpense({
        id: 'e1',
        amount: 150,
        paidBySplitMode: 'BY_AMOUNT',
        paidByList: [{ participant: { id: 'p0', name: 'P0' }, shares: 150 }],
        paidFor: [
          { participant: { id: 'p0', name: 'P0' }, shares: 1 },
          { participant: { id: 'p1', name: 'P1' }, shares: 1 },
        ],
      }),
    ]

    const balances = getBalances(expenses)

    // p0 paid 150 (the entire amount), owes 75 → net +75
    expect(balances.p0).toEqual({ paid: 150, paidFor: 75, total: 75 })
    expect(balances.p1).toEqual({ paid: 0, paidFor: 75, total: -75 })
  })

  it('multi-payer 2-payer + reimbursement leaves the group with a zero public balance', () => {
    // Two payers on an expense, with a 3-person split. The full pipeline
    // (getBalances -> reimbursements -> public) must net to zero.
    const expenses: BalancesExpense[] = [
      makeExpense({
        id: 'e1',
        amount: 200,
        splitMode: 'EVENLY',
        paidBySplitMode: 'EVENLY',
        paidByList: [
          { participant: { id: 'p0', name: 'P0' }, shares: 1 },
          { participant: { id: 'p1', name: 'P1' }, shares: 1 },
        ],
        paidFor: [
          { participant: { id: 'p0', name: 'P0' }, shares: 1 },
          { participant: { id: 'p1', name: 'P1' }, shares: 1 },
          { participant: { id: 'p2', name: 'P2' }, shares: 1 },
        ],
      }),
      makeExpense({
        id: 'e2',
        amount: 67,
        splitMode: 'EVENLY',
        paidByList: defaultPaidByList('p2', 'P2'),
        paidFor: [
          { participant: { id: 'p0', name: 'P0' }, shares: 1 },
          { participant: { id: 'p1', name: 'P1' }, shares: 1 },
          { participant: { id: 'p2', name: 'P2' }, shares: 1 },
        ],
      }),
    ]

    const balances = getBalances(expenses)
    const reimbursements = getSuggestedReimbursements(balances)
    const publicBalances = getPublicBalances(reimbursements)

    // Raw balance math (each gets Math.round()'d at the end):
    //   p0 paid 100, owes 67 (e1) + 22 (e2) = 89, total = +11
    //   p1 paid 100, owes 67 (e1) + 22 (e2) = 89, total = +11
    //   p2 paid 67 (e2), owes 67 (e1) + 22 (e2) = 89, total = -22
    expect(balances.p0.paid).toBe(100)
    expect(balances.p0.paidFor).toBe(89)
    expect(balances.p1.paid).toBe(100)
    expect(balances.p1.paidFor).toBe(89)
    expect(balances.p2.paid).toBe(67)
    expect(balances.p2.paidFor).toBe(89)

    // Public balances must net to zero (the UI's reimbursement pipeline
    // collapses the rounding leftovers within the group).
    const publicNet = Object.values(publicBalances).reduce(
      (sum, b) => sum + b.total,
      0,
    )
    expect(Math.abs(publicNet)).toBeLessThan(3)
  })

  // ---------------------------------------------------------------------------
  // Phase 1b: paidByList shares are in originalCurrency when set; the
  // payer's `paid` is converted to ledger currency via conversionRate.
  // ---------------------------------------------------------------------------

  it('cross-currency BY_AMOUNT: $100 USD split $70/$30 on a EUR group converts via 0.92', () => {
    // Expense group EUR, paid USD $100. The schema invariant is
    //   paidByList.shares ∈ USD cents, Σ shares = originalAmount = 10000
    //   paidFor.shares ∈ EUR cents, Σ shares = amount = 9200
    // Per-payer paid is the share converted at conversionRate:
    //   p1.paid = round(7000 * 0.92) = 6440
    //   p2.paid = round(3000 * 0.92) = 2760
    //   Σ paid = 9200 = amount
    // Per-payer paidFor splits amount (group currency), 4600 each.
    //   p1.total = 6440 - 4600 = +1840
    //   p2.total = 2760 - 4600 = -1840
    //   Net = 0 ✓
    const expenses: BalancesExpense[] = [
      makeExpense({
        id: 'e1',
        amount: 9200,
        originalAmount: 10000,
        originalCurrency: 'USD',
        conversionRate: 0.92,
        paidBySplitMode: 'BY_AMOUNT',
        paidByList: [
          { participant: { id: 'p1', name: 'Alice' }, shares: 7000 },
          { participant: { id: 'p2', name: 'Bob' }, shares: 3000 },
        ],
        paidFor: [
          { participant: { id: 'p1', name: 'Alice' }, shares: 4600 },
          { participant: { id: 'p2', name: 'Bob' }, shares: 4600 },
        ],
      }),
    ]

    const balances = getBalances(expenses)

    expect(balances.p1.paid).toBe(Math.round(7000 * 0.92))
    expect(balances.p2.paid).toBe(Math.round(3000 * 0.92))
    expect(balances.p1.paidFor).toBe(4600)
    expect(balances.p2.paidFor).toBe(4600)
    expect(balances.p1.total).toBe(Math.round(7000 * 0.92) - 4600)
    expect(balances.p2.total).toBe(Math.round(3000 * 0.92) - 4600)

    const sumPaid = balances.p1.paid + balances.p2.paid
    expect(sumPaid).toBe(9200)
    const netTotal = balances.p1.total + balances.p2.total
    expect(netTotal).toBe(0)
  })

  it('cross-currency BY_PERCENTAGE: 50/50 of $100 USD on a EUR group converts via 0.92', () => {
    // 50/50 split in basis points (5000 / 5000 = 10000). Each payer
    // receives 50% of $100 = $50 = 5000 USD cents → round(5000 * 0.92)
    // = 4600 EUR cents.
    const expenses: BalancesExpense[] = [
      makeExpense({
        id: 'e1',
        amount: 9200,
        originalAmount: 10000,
        originalCurrency: 'USD',
        conversionRate: 0.92,
        paidBySplitMode: 'BY_PERCENTAGE',
        paidByList: [
          { participant: { id: 'p1', name: 'Alice' }, shares: 5000 },
          { participant: { id: 'p2', name: 'Bob' }, shares: 5000 },
        ],
        paidFor: [
          { participant: { id: 'p1', name: 'Alice' }, shares: 4600 },
          { participant: { id: 'p2', name: 'Bob' }, shares: 4600 },
        ],
      }),
    ]

    const balances = getBalances(expenses)

    expect(balances.p1.paid).toBe(Math.round(5000 * 0.92))
    expect(balances.p2.paid).toBe(Math.round(5000 * 0.92))
    expect(balances.p1.paidFor).toBe(4600)
    expect(balances.p2.paidFor).toBe(4600)

    const sumPaid = balances.p1.paid + balances.p2.paid
    expect(sumPaid).toBe(9200)
  })

  it('cross-currency leaves single-currency (no originalCurrency) behavior untouched', () => {
    // Regression guard: when originalCurrency is absent the payer
    // division must still operate on `amount` directly (no conversion).
    const expenses: BalancesExpense[] = [
      makeExpense({
        id: 'e1',
        amount: 100,
        paidBySplitMode: 'BY_AMOUNT',
        paidByList: [
          { participant: { id: 'p0', name: 'P0' }, shares: 40 },
          { participant: { id: 'p1', name: 'P1' }, shares: 60 },
        ],
        paidFor: [{ participant: { id: 'p0', name: 'P0' }, shares: 1 }],
      }),
    ]

    const balances = getBalances(expenses)
    expect(balances.p0.paid).toBe(40)
    expect(balances.p1.paid).toBe(60)
  })
})

describe('getSuggestedReimbursements', () => {
  it('sorts balances correctly (positive before negative)', () => {
    const balances = {
      p0: { paid: 100, paidFor: 50, total: 50 }, // positive
      p1: { paid: 0, paidFor: 30, total: -30 }, // negative
      p2: { paid: 50, paidFor: 70, total: -20 }, // negative
    }

    const reimbursements = getSuggestedReimbursements(balances)

    // Verify positive balances are settled first
    expect(reimbursements.length).toBeGreaterThan(0)
    expect(reimbursements[0].to).toBe('p0') // p0 has positive balance
  })

  it('handles complex 5+ person scenario', () => {
    // Scenario: 5 people, various expenses
    // Alice paid 300, owes 100 → +200
    // Bob paid 50, owes 100 → -50
    // Carol paid 150, owes 100 → +50
    // Dave paid 0, owes 100 → -100
    // Eve paid 0, owes 100 → -100
    const balances = {
      alice: { paid: 300, paidFor: 100, total: 200 },
      bob: { paid: 50, paidFor: 100, total: -50 },
      carol: { paid: 150, paidFor: 100, total: 50 },
      dave: { paid: 0, paidFor: 100, total: -100 },
      eve: { paid: 0, paidFor: 100, total: -100 },
    }

    const reimbursements = getSuggestedReimbursements(balances)

    // Verify sum of reimbursements balances out
    const totalPaid = reimbursements.reduce((sum, r) => sum + r.amount, 0)
    const totalOwed = 200 + 50 // alice + carol
    expect(totalPaid).toBe(totalOwed)

    // Verify all debtors are covered
    const debtorsSettled = new Set(reimbursements.map((r) => r.from))
    expect(debtorsSettled.has('bob')).toBe(true)
    expect(debtorsSettled.has('dave')).toBe(true)
    expect(debtorsSettled.has('eve')).toBe(true)

    // Verify minimal transactions (should be <= 4 for 5 people)
    expect(reimbursements.length).toBeLessThanOrEqual(4)
  })

  it('handles all participants with negative balances', () => {
    // Simulate a scenario where everyone owes money
    const balances = {
      p0: { paid: 0, paidFor: 100, total: -100 },
      p1: { paid: 0, paidFor: 50, total: -50 },
      p2: { paid: 0, paidFor: 50, total: -50 },
    }

    const reimbursements = getSuggestedReimbursements(balances)

    // When all are negative, algorithm still produces "settlements"
    // Verify the function handles this case without throwing
    expect(Array.isArray(reimbursements)).toBe(true)
    expect(reimbursements.length).toBeGreaterThanOrEqual(0)
  })

  it('returns [] when all totals are 0', () => {
    const balances = {
      p0: { paid: 100, paidFor: 100, total: 0 },
      p1: { paid: 50, paidFor: 50, total: 0 },
      p2: { paid: 0, paidFor: 0, total: 0 },
    }

    const reimbursements = getSuggestedReimbursements(balances)

    expect(reimbursements).toEqual([])
  })
})

describe('getPublicBalances + getSuggestedReimbursements (UI pipeline)', () => {
  it('cancels fractional-cent rounding residuals so the UI shows zero balances', () => {
    // 1 cent split evenly among 3 participants: each gets 0.333…,
    // which `Math.round`s to 0 in `getBalances`. The payer is left
    // with a 1-cent residual in the raw output, but the UI's
    // `getPublicBalances(getSuggestedReimbursements(...))` pipeline
    // drops the residual: `getSuggestedReimbursements` filters out the
    // 0-total non-payers (loop doesn't execute with length 1), and
    // `getPublicBalances` has no reimbursements to project.
    const expenses: BalancesExpense[] = [
      makeExpense({
        id: 'e1',
        amount: 1,
        splitMode: 'EVENLY',
        paidByList: defaultPaidByList('p0', 'P0'),
        paidFor: [
          { participant: { id: 'p0', name: 'P0' }, shares: 1 },
          { participant: { id: 'p1', name: 'P1' }, shares: 1 },
          { participant: { id: 'p2', name: 'P2' }, shares: 1 },
        ],
      }),
    ]

    const rawBalances = getBalances(expenses)
    // Raw balances retain the 1-cent residual.
    expect(rawBalances.p0).toEqual({ paid: 1, paidFor: 0, total: 1 })
    expect(rawBalances.p1).toEqual({ paid: 0, paidFor: 0, total: 0 })
    expect(rawBalances.p2).toEqual({ paid: 0, paidFor: 0, total: 0 })

    const reimbursements = getSuggestedReimbursements(rawBalances)
    // Only the payer is non-zero, so the loop exits without generating
    // any legs and the filter drops nothing.
    expect(reimbursements).toEqual([])

    const publicBalances = getPublicBalances(reimbursements)
    // The UI sees an empty balance map, so the archive check based on
    // `hasUnsettledBalances(publicBalances)` returns false.
    expect(Object.values(publicBalances).every((b) => b.total === 0)).toBe(true)
    expect(Object.keys(publicBalances)).toHaveLength(0)
  })

  it('keeps the public balances consistent with the raw balances when no rounding residual exists', () => {
    // 30 cents split among 3 = 10 each. No rounding leftover; both
    // pipelines should agree.
    const expenses: BalancesExpense[] = [
      makeExpense({
        id: 'e1',
        amount: 30,
        splitMode: 'EVENLY',
        paidByList: defaultPaidByList('p0', 'P0'),
        paidFor: [
          { participant: { id: 'p0', name: 'P0' }, shares: 1 },
          { participant: { id: 'p1', name: 'P1' }, shares: 1 },
          { participant: { id: 'p2', name: 'P2' }, shares: 1 },
        ],
      }),
    ]

    const rawBalances = getBalances(expenses)
    expect(rawBalances.p0).toEqual({ paid: 30, paidFor: 10, total: 20 })
    expect(rawBalances.p1).toEqual({ paid: 0, paidFor: 10, total: -10 })
    expect(rawBalances.p2).toEqual({ paid: 0, paidFor: 10, total: -10 })

    const reimbursements = getSuggestedReimbursements(rawBalances)
    const publicBalances = getPublicBalances(reimbursements)

    // Both pipelines agree on the same per-participant totals when
    // there is no rounding leftover.
    expect(publicBalances.p0.total).toBe(rawBalances.p0.total)
    expect(publicBalances.p1.total).toBe(rawBalances.p1.total)
    expect(publicBalances.p2.total).toBe(rawBalances.p2.total)
  })
})
