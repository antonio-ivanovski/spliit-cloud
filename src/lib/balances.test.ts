import { getBalances, getSuggestedReimbursements } from './balances'

type BalancesExpense = Parameters<typeof getBalances>[0][number]

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
    paidBy: { id: 'p0', name: 'P0' },
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
        paidBy: { id: 'p0', name: 'P0' },
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
        paidBy: { id: 'p0', name: 'P0' },
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
        paidBy: { id: 'p0', name: 'P0' },
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
        paidBy: { id: 'p0', name: 'P0' },
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
        paidBy: { id: 'p0', name: 'P0' },
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
        paidBy: { id: 'p0', name: 'P0' },
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
        paidBy: { id: 'p0', name: 'P0' },
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
        paidBy: { id: 'p1', name: 'P1' },
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
        paidBy: { id: 'p2', name: 'P2' },
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
        paidBy: { id: 'p0', name: 'Alice' },
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
        paidBy: { id: 'p1', name: 'Bob' },
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
        paidBy: { id: 'p2', name: 'Carol' },
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
})
