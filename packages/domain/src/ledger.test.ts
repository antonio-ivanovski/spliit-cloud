import { getBalances, type BalanceExpense } from './balances'
import {
  calculateShare,
  getTotalActiveUserShare,
  getTotalGroupSpending,
  type TotalsExpense,
} from './totals'

describe('Ledger split unit preservation', () => {
  type InferredBalanceExpense = Parameters<typeof getBalances>[0][number]

  const makeExpense = (
    overrides: Partial<InferredBalanceExpense>,
  ): InferredBalanceExpense =>
    ({
      id: 'lp-ledger-1',
      amount: 0,
      isReimbursement: false,
      splitMode: 'EVENLY',
      paidBy: { id: 'lp-owner', name: 'Owner' },
      paidFor: [{ participant: { id: 'lp-owner', name: 'Owner' }, shares: 1 }],
      ...overrides,
    }) as InferredBalanceExpense

  it('BY_AMOUNT shares are ledger base-currency minor units', () => {
    const amount = 1500 // 15.00 in minor units
    const expenses: InferredBalanceExpense[] = [
      makeExpense({
        amount,
        splitMode: 'BY_AMOUNT',
        paidBy: { id: 'lp-alice', name: 'Alice' },
        paidFor: [
          { participant: { id: 'lp-alice', name: 'Alice' }, shares: 500 },
          { participant: { id: 'lp-bob', name: 'Bob' }, shares: 1000 },
        ],
      }),
    ]

    const balances = getBalances(expenses)

    expect(balances['lp-alice'].paid).toBe(amount)
    expect(balances['lp-alice'].paidFor).toBe(500)
    expect(balances['lp-bob'].paidFor).toBe(1000)
    expect(balances['lp-alice'].total).toBe(1000)
    expect(balances['lp-bob'].total).toBe(-1000)
  })

  it('BY_PERCENTAGE shares are basis points out of 10000', () => {
    const expenses: InferredBalanceExpense[] = [
      makeExpense({
        amount: 20000, // 200.00
        splitMode: 'BY_PERCENTAGE',
        paidBy: { id: 'lp-alice', name: 'Alice' },
        paidFor: [
          { participant: { id: 'lp-alice', name: 'Alice' }, shares: 2500 },
          { participant: { id: 'lp-bob', name: 'Bob' }, shares: 7500 },
        ],
      }),
    ]

    const balances = getBalances(expenses)
    expect(balances['lp-alice'].paidFor).toBe(5000)
    expect(balances['lp-bob'].paidFor).toBe(15000)
  })

  it('EVENLY splits equally regardless of shares value', () => {
    const expenses: InferredBalanceExpense[] = [
      makeExpense({
        amount: 3000,
        splitMode: 'EVENLY',
        paidBy: { id: 'lp-alice', name: 'Alice' },
        paidFor: [
          { participant: { id: 'lp-alice', name: 'Alice' }, shares: 99 },
          { participant: { id: 'lp-bob', name: 'Bob' }, shares: 1 },
          { participant: { id: 'lp-carol', name: 'Carol' }, shares: 50 },
        ],
      }),
    ]

    const balances = getBalances(expenses)
    expect(balances['lp-alice'].paidFor).toBe(1000)
    expect(balances['lp-bob'].paidFor).toBe(1000)
    expect(balances['lp-carol'].paidFor).toBe(1000)
  })

  it('BY_SHARES uses relative shares', () => {
    const expenses: InferredBalanceExpense[] = [
      makeExpense({
        amount: 6000,
        splitMode: 'BY_SHARES',
        paidBy: { id: 'lp-alice', name: 'Alice' },
        paidFor: [
          { participant: { id: 'lp-alice', name: 'Alice' }, shares: 1 },
          { participant: { id: 'lp-bob', name: 'Bob' }, shares: 2 },
          { participant: { id: 'lp-carol', name: 'Carol' }, shares: 3 },
        ],
      }),
    ]

    const balances = getBalances(expenses)
    expect(balances['lp-alice'].paidFor).toBe(1000)
    expect(balances['lp-bob'].paidFor).toBe(2000)
    expect(balances['lp-carol'].paidFor).toBe(3000)
  })
})

describe('Ledger participant identifiers in domain math', () => {
  type InferredTotalsExpense = Parameters<
    typeof getTotalGroupSpending
  >[0][number]

  const makeExpense = (
    overrides: Partial<InferredTotalsExpense>,
  ): InferredTotalsExpense =>
    ({
      id: 'le-1',
      amount: 1000,
      isReimbursement: false,
      splitMode: 'EVENLY',
      paidBy: { id: 'lp-alice', name: 'Alice' },
      paidFor: [
        { participant: { id: 'lp-alice', name: 'Alice' }, shares: 1 },
        { participant: { id: 'lp-bob', name: 'Bob' }, shares: 1 },
      ],
      ...overrides,
    }) as InferredTotalsExpense

  it('calculateShare works with ledger participant IDs', () => {
    const share = calculateShare('lp-bob', makeExpense({}))
    expect(share).toBe(500)
  })

  it('getTotalActiveUserShare works with ledger participant IDs', () => {
    const expenses: InferredTotalsExpense[] = [
      makeExpense({
        id: 'le-1',
        amount: 3000,
        splitMode: 'BY_AMOUNT',
        paidBy: { id: 'lp-alice', name: 'Alice' },
        paidFor: [
          { participant: { id: 'lp-alice', name: 'Alice' }, shares: 1000 },
          { participant: { id: 'lp-bob', name: 'Bob' }, shares: 2000 },
        ],
      }),
      makeExpense({
        id: 'le-2',
        amount: 600,
        splitMode: 'BY_PERCENTAGE',
        paidBy: { id: 'lp-bob', name: 'Bob' },
        paidFor: [
          { participant: { id: 'lp-alice', name: 'Alice' }, shares: 2500 },
          { participant: { id: 'lp-bob', name: 'Bob' }, shares: 7500 },
        ],
      }),
    ]

    expect(getTotalActiveUserShare('lp-alice', expenses)).toBe(1150)
    expect(getTotalActiveUserShare('lp-bob', expenses)).toBe(2450)
  })
})

describe('Ledger balance inputs', () => {
  it('getBalances produces integer results for ledger minor-unit amounts', () => {
    const expenses: BalanceExpense[] = [
      {
        id: 'le-1',
        amount: 333,
        splitMode: 'EVENLY',
        isReimbursement: false,
        paidBy: { id: 'lp-a', name: 'A' },
        paidFor: [
          { participant: { id: 'lp-a', name: 'A' }, shares: 1 },
          { participant: { id: 'lp-b', name: 'B' }, shares: 1 },
          { participant: { id: 'lp-c', name: 'C' }, shares: 1 },
        ],
      },
    ]

    const balances = getBalances(expenses)
    for (const key of Object.keys(balances)) {
      expect(Number.isInteger(balances[key].paid)).toBe(true)
      expect(Number.isInteger(balances[key].paidFor)).toBe(true)
      expect(Number.isInteger(balances[key].total)).toBe(true)
    }
  })

  it('currency conversion metadata does not affect balance math', () => {
    const ledgerCents = 1000
    const expenses: BalanceExpense[] = [
      {
        id: 'le-1',
        amount: ledgerCents,
        splitMode: 'BY_AMOUNT',
        isReimbursement: false,
        paidBy: { id: 'lp-a', name: 'A' },
        paidFor: [
          { participant: { id: 'lp-a', name: 'A' }, shares: 400 },
          { participant: { id: 'lp-b', name: 'B' }, shares: 600 },
        ],
      },
    ]

    const balances = getBalances(expenses)
    expect(balances['lp-a'].paid).toBe(1000)
    expect(balances['lp-a'].paidFor).toBe(400)
    expect(balances['lp-b'].paidFor).toBe(600)
    expect(balances['lp-a'].total).toBe(600)
    expect(balances['lp-b'].total).toBe(-600)
  })

  it('reimbursement does not affect split math from ledger amounts', () => {
    const expenses: BalanceExpense[] = [
      {
        id: 'le-1',
        amount: 5000,
        splitMode: 'EVENLY',
        isReimbursement: true,
        paidBy: { id: 'lp-alice', name: 'Alice' },
        paidFor: [
          { participant: { id: 'lp-alice', name: 'Alice' }, shares: 1 },
          { participant: { id: 'lp-bob', name: 'Bob' }, shares: 1 },
        ],
      },
    ]

    const totals: TotalsExpense[] = [
      {
        id: 'le-1',
        amount: 5000,
        splitMode: 'EVENLY',
        isReimbursement: true,
        paidBy: { id: 'lp-alice', name: 'Alice' },
        paidFor: [
          { participant: { id: 'lp-alice', name: 'Alice' }, shares: 1 },
          { participant: { id: 'lp-bob', name: 'Bob' }, shares: 1 },
        ],
      },
    ]

    const balances = getBalances(expenses)
    expect(balances['lp-alice'].paid).toBe(5000)
    expect(balances['lp-alice'].paidFor).toBe(2500)

    const totalSpending = getTotalGroupSpending(totals)
    expect(totalSpending).toBe(0)
  })
})
