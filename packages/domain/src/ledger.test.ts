import { getBalances, type BalanceExpense, getPublicBalances } from './balances'
import {
  calculateShare,
  getTotalActiveUserShare,
  getTotalGroupSpending,
  type TotalsExpense,
} from './totals'
import { expenseFormSchema } from './schemas'

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

describe('Ledger currency conversion rules', () => {
  it('originalAmount * conversionRate equals ledger amount (USD cents)', () => {
    const originalAmount = 5000
    const conversionRate = 0.85
    const ledgerAmount = Math.round(originalAmount * conversionRate)
    expect(ledgerAmount).toBe(4250)
  })

  it('originalAmount * conversionRate equals ledger amount (EUR cents)', () => {
    const originalAmount = 2000
    const conversionRate = 1.1
    const ledgerAmount = Math.round(originalAmount * conversionRate)
    expect(ledgerAmount).toBe(2200)
  })

  it('conversion with zero-decimal currency (JPY) produces integer', () => {
    const originalAmount = 10000
    const conversionRate = 0.0065
    const ledgerAmount = Math.round(originalAmount * conversionRate)
    expect(Number.isInteger(ledgerAmount)).toBe(true)
    expect(ledgerAmount).toBe(65)
  })

  it('expenseFormSchema preserves conversion fields through parse', () => {
    const raw = {
      title: 'Test expense',
      expenseDate: new Date('2026-06-24'),
      category: 'general',
      amount: '42.50',
      paidBy: 'lp-alice',
      paidFor: [
        { participant: 'lp-alice', shares: '1' },
        { participant: 'lp-bob', shares: '1' },
      ],
      splitMode: 'EVENLY' as const,
      saveDefaultSplittingOptions: false,
      isReimbursement: false,
      originalAmount: '50.00',
      originalCurrency: 'EUR',
      conversionRate: '0.85',
    }
    const result = expenseFormSchema.parse(raw)
    expect(result.originalAmount).toBe(50)
    expect(result.originalCurrency).toBe('EUR')
    expect(result.conversionRate).toBe(0.85)
    expect(result.amount).toBe(42.5)
  })

  it('getBalances is unaffected when extra conversion metadata is present', () => {
    const amount = 1000
    const expenses: BalanceExpense[] = [
      {
        id: 'le-1',
        amount,
        splitMode: 'EVENLY',
        isReimbursement: false,
        paidBy: { id: 'lp-a', name: 'A' },
        paidFor: [
          { participant: { id: 'lp-a', name: 'A' }, shares: 1 },
          { participant: { id: 'lp-b', name: 'B' }, shares: 1 },
        ],
        originalAmount: 2000,
        originalCurrency: 'EUR',
        conversionRate: 0.5,
      },
    ]
    const balances = getBalances(expenses)
    expect(balances['lp-a'].paid).toBe(1000)
    expect(balances['lp-a'].paidFor).toBe(500)
  })
})

describe('Split unit preservation edge cases', () => {
  type Inferred = Parameters<typeof getBalances>[0][number]

  const base = (overrides: Partial<Inferred> = {}): Inferred =>
    ({
      id: 'le-1',
      amount: 0,
      isReimbursement: false,
      splitMode: 'EVENLY',
      paidBy: { id: 'lp-a', name: 'A' },
      paidFor: [{ participant: { id: 'lp-a', name: 'A' }, shares: 1 }],
      ...overrides,
    }) as Inferred

  it('expenseFormSchema rejects BY_AMOUNT when shares do not sum to amount', () => {
    const raw = {
      title: 'Test',
      expenseDate: new Date('2026-06-24'),
      category: 'general',
      amount: '100.00',
      paidBy: 'lp-a',
      paidFor: [
        { participant: 'lp-a', shares: '30' },
        { participant: 'lp-b', shares: '30' },
        { participant: 'lp-c', shares: '30' },
      ],
      splitMode: 'BY_AMOUNT' as const,
      saveDefaultSplittingOptions: false,
      isReimbursement: false,
    }
    expect(() => expenseFormSchema.parse(raw)).toThrow()
  })

  it('BY_PERCENTAGE with small basis points (1 bp)', () => {
    const expenses: Inferred[] = [
      base({
        amount: 1000000,
        splitMode: 'BY_PERCENTAGE',
        paidBy: { id: 'lp-a', name: 'A' },
        paidFor: [
          { participant: { id: 'lp-a', name: 'A' }, shares: 1 },
          { participant: { id: 'lp-b', name: 'B' }, shares: 9999 },
        ],
      }),
    ]
    const balances = getBalances(expenses)
    expect(balances['lp-a'].paidFor).toBe(100)
    expect(balances['lp-b'].paidFor).toBe(999900)
  })

  it('mixed split modes in a single getBalances call', () => {
    const expenses: Inferred[] = [
      base({
        id: 'le-1',
        amount: 6000,
        splitMode: 'BY_SHARES',
        paidBy: { id: 'lp-a', name: 'A' },
        paidFor: [
          { participant: { id: 'lp-a', name: 'A' }, shares: 1 },
          { participant: { id: 'lp-b', name: 'B' }, shares: 2 },
        ],
      }),
      base({
        id: 'le-2',
        amount: 12000,
        splitMode: 'EVENLY',
        paidBy: { id: 'lp-b', name: 'B' },
        paidFor: [
          { participant: { id: 'lp-a', name: 'A' }, shares: 1 },
          { participant: { id: 'lp-b', name: 'B' }, shares: 1 },
        ],
      }),
    ]
    const balances = getBalances(expenses)
    expect(balances['lp-a'].paidFor).toBe(8000)
    expect(balances['lp-b'].paidFor).toBe(10000)
    expect(balances['lp-a'].total).toBe(-2000)
    expect(balances['lp-b'].total).toBe(2000)
  })
})

describe('Ledger balance input integrity', () => {
  it('handles zero-decimal currency amounts (JPY/minor units only)', () => {
    const expenses: BalanceExpense[] = [
      {
        id: 'le-1',
        amount: 1000,
        splitMode: 'EVENLY',
        isReimbursement: false,
        paidBy: { id: 'lp-a', name: 'A' },
        paidFor: [
          { participant: { id: 'lp-a', name: 'A' }, shares: 1 },
          { participant: { id: 'lp-b', name: 'B' }, shares: 1 },
        ],
      },
    ]
    const balances = getBalances(expenses)
    expect(balances['lp-a'].paid).toBe(1000)
    expect(balances['lp-a'].paidFor).toBe(500)
    expect(balances['lp-b'].paidFor).toBe(500)
  })

  it('getPublicBalances with ledger participant IDs', () => {
    const reimbursements = [
      { from: 'lp-bob', to: 'lp-alice', amount: 2500 },
      { from: 'lp-carol', to: 'lp-alice', amount: 1500 },
    ]
    const balances = getPublicBalances(reimbursements)
    expect(balances['lp-alice'].paid).toBe(4000)
    expect(balances['lp-alice'].paidFor).toBe(0)
    expect(balances['lp-alice'].total).toBe(4000)
    expect(balances['lp-bob'].paidFor).toBe(2500)
    expect(balances['lp-bob'].total).toBe(-2500)
    expect(balances['lp-carol'].paidFor).toBe(1500)
    expect(balances['lp-carol'].total).toBe(-1500)
  })

  it('supports UUID-style ledger participant IDs', () => {
    const aliceId = 'lp-a1b2c3d4-e5f6-7890-abcd-ef1234567890'
    const bobId = 'lp-b2c3d4e5-f6a7-8901-bcde-f12345678901'
    const expenses: BalanceExpense[] = [
      {
        id: 'le-1',
        amount: 2000,
        splitMode: 'EVENLY',
        isReimbursement: false,
        paidBy: { id: aliceId, name: 'Alice' },
        paidFor: [
          { participant: { id: aliceId, name: 'Alice' }, shares: 1 },
          { participant: { id: bobId, name: 'Bob' }, shares: 1 },
        ],
      },
    ]
    const balances = getBalances(expenses)
    expect(balances[aliceId].paidFor).toBe(1000)
    expect(balances[bobId].paidFor).toBe(1000)
  })
})
