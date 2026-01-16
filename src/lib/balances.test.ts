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
})
