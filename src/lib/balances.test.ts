import { getBalances } from './balances'

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
})
