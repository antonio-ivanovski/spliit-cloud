import {
  getBalances,
  getBalancesByCurrency,
  getDirectSettlements,
  getDirectSettlementsByCurrency,
  getPublicBalances,
  getSuggestedSettlements,
  type Balances,
  type SuggestedSettlement,
} from './balances'

type BalancesExpense = Parameters<typeof getBalances>[0][number]

const participant = (id: string) => ({ id, name: id.toUpperCase() })

const paidBy = (id: string, shares = 1) => ({
  participant: participant(id),
  shares,
})

const evenlyFor = (...ids: string[]) =>
  ids.map((id) => ({ participant: participant(id), shares: 1 }))

const makeExpense = (overrides: Partial<BalancesExpense>): BalancesExpense =>
  ({
    id: 'e1',
    expenseDate: new Date('2025-01-01T00:00:00.000Z'),
    title: 'Dinner',
    amount: 0,
    splitMode: 'EVENLY',
    createdAt: new Date('2025-01-01T00:00:00.000Z'),
    recurrenceRule: null,
    category: null,
    paidBySplitMode: 'EVENLY',
    paidByList: [paidBy('a')],
    paidFor: evenlyFor('a'),
    documentCount: 0,
    ...overrides,
  }) as BalancesExpense

/** Net per participant implied by a list of settlement legs. */
function netOf(settlements: SuggestedSettlement[]): Record<string, number> {
  return Object.fromEntries(
    Object.entries(getPublicBalances(settlements)).map(([id, b]) => [
      id,
      b.total,
    ]),
  )
}

function nonZeroTotals(balances: Balances): Record<string, number> {
  return Object.fromEntries(
    Object.entries(balances)
      .filter(([, b]) => b.total !== 0)
      .map(([id, b]) => [id, b.total]),
  )
}

describe('getDirectSettlements', () => {
  it('returns nothing for an empty group', () => {
    expect(getDirectSettlements([])).toEqual([])
  })

  it('matches simplified payments when there is only one payer', () => {
    const expenses = [
      makeExpense({
        amount: 300,
        paidByList: [paidBy('a')],
        paidFor: evenlyFor('a', 'b', 'c'),
      }),
    ]

    expect(getDirectSettlements(expenses)).toEqual([
      { from: 'b', to: 'a', amount: 100 },
      { from: 'c', to: 'a', amount: 100 },
    ])
  })

  it('keeps debts between the people who shared each expense', () => {
    // A pays for B, B pays for C. Simplified: C → A. Direct: B → A, C → B.
    const expenses = [
      makeExpense({
        id: 'e1',
        amount: 1000,
        paidByList: [paidBy('a')],
        paidFor: evenlyFor('b'),
      }),
      makeExpense({
        id: 'e2',
        amount: 1000,
        paidByList: [paidBy('b')],
        paidFor: evenlyFor('c'),
      }),
    ]

    expect(getSuggestedSettlements(getBalances(expenses))).toEqual([
      { from: 'c', to: 'a', amount: 1000 },
    ])
    expect(getDirectSettlements(expenses)).toEqual([
      { from: 'b', to: 'a', amount: 1000 },
      { from: 'c', to: 'b', amount: 1000 },
    ])
  })

  it('nets opposite debts within a pair', () => {
    const expenses = [
      makeExpense({
        id: 'e1',
        amount: 1000,
        paidByList: [paidBy('a')],
        paidFor: evenlyFor('a', 'b'),
      }),
      makeExpense({
        id: 'e2',
        amount: 600,
        paidByList: [paidBy('b')],
        paidFor: evenlyFor('a', 'b'),
      }),
    ]

    expect(getDirectSettlements(expenses)).toEqual([
      { from: 'b', to: 'a', amount: 200 },
    ])
  })

  it('allocates multi-payer expenses proportionally to what each paid', () => {
    // A paid 180, B paid 120 of a 300 dinner split evenly between A, B, C.
    // Each share of 100 is owed 60% to A and 40% to B:
    //   C → A 60, C → B 40, B → A 60 − A → B 40 = B → A 20.
    const expenses = [
      makeExpense({
        amount: 300,
        paidBySplitMode: 'BY_AMOUNT',
        paidByList: [paidBy('a', 180), paidBy('b', 120)],
        paidFor: evenlyFor('a', 'b', 'c'),
      }),
    ]

    expect(getDirectSettlements(expenses)).toEqual([
      { from: 'b', to: 'a', amount: 20 },
      { from: 'c', to: 'a', amount: 60 },
      { from: 'c', to: 'b', amount: 40 },
    ])
  })

  it('handles multi-payer expenses split by shares and percentage', () => {
    const expenses = [
      makeExpense({
        id: 'e1',
        amount: 1000,
        paidBySplitMode: 'BY_PERCENTAGE',
        paidByList: [paidBy('a', 7500), paidBy('b', 2500)],
        splitMode: 'BY_SHARES',
        paidFor: [
          { participant: participant('c'), shares: 3 },
          { participant: participant('d'), shares: 1 },
        ],
      }),
    ]

    expect(getDirectSettlements(expenses)).toEqual([
      { from: 'c', to: 'a', amount: 563 },
      { from: 'c', to: 'b', amount: 187 },
      { from: 'd', to: 'a', amount: 187 },
      { from: 'd', to: 'b', amount: 63 },
    ])
    expect(netOf(getDirectSettlements(expenses))).toEqual(
      nonZeroTotals(getBalances(expenses)),
    )
  })

  it('reduces the matching pair when a settlement is recorded', () => {
    const dinner = makeExpense({
      id: 'dinner',
      amount: 900,
      paidByList: [paidBy('a')],
      paidFor: evenlyFor('a', 'b', 'c'),
    })
    const partialSettlement = makeExpense({
      id: 'settle-b',
      title: 'Settlement',
      amount: 200,
      paidBySplitMode: 'BY_AMOUNT',
      paidByList: [paidBy('b', 200)],
      paidFor: evenlyFor('a'),
    })

    expect(getDirectSettlements([dinner, partialSettlement])).toEqual([
      { from: 'b', to: 'a', amount: 100 },
      { from: 'c', to: 'a', amount: 300 },
    ])

    const fullSettlement = makeExpense({
      id: 'settle-c',
      title: 'Settlement',
      amount: 300,
      paidByList: [paidBy('c')],
      paidFor: evenlyFor('a'),
    })
    expect(
      getDirectSettlements([dinner, partialSettlement, fullSettlement]),
    ).toEqual([{ from: 'b', to: 'a', amount: 100 }])
  })

  it('reduces the matching pair for reimbursements (negative amounts)', () => {
    // A paid 900 for A, B, C; then A received a 300 refund on everyone's
    // behalf, recorded as a negative expense paid by A.
    const expenses = [
      makeExpense({
        id: 'dinner',
        amount: 900,
        paidByList: [paidBy('a')],
        paidFor: evenlyFor('a', 'b', 'c'),
      }),
      makeExpense({
        id: 'refund',
        amount: -300,
        paidByList: [paidBy('a')],
        paidFor: evenlyFor('a', 'b', 'c'),
      }),
    ]

    expect(getDirectSettlements(expenses)).toEqual([
      { from: 'b', to: 'a', amount: 200 },
      { from: 'c', to: 'a', amount: 200 },
    ])
  })

  it('converts cross-currency expenses into the ledger currency', () => {
    // $100 USD paid 70/30 by A and B on a EUR ledger at 0.92, split evenly
    // with C. Payers convert to 6440 / 2760, shares are 9200 / 3 each:
    //   B → A 2146.67 − 920 = 1226.67, C → A 2146.67 − 400 = 1746.67,
    //   C → B 920 − 400 = 520. Rounding residual lands on C → A.
    const expenses = [
      makeExpense({
        id: 'usd',
        amount: 9200,
        originalAmount: 10000,
        originalCurrency: 'USD',
        conversionRate: 0.92,
        paidBySplitMode: 'BY_AMOUNT',
        paidByList: [paidBy('a', 7000), paidBy('b', 3000)],
        paidFor: evenlyFor('a', 'b', 'c'),
      }),
      makeExpense({
        id: 'eur',
        amount: 1200,
        paidByList: [paidBy('c')],
        paidFor: evenlyFor('a', 'b', 'c'),
      }),
    ]

    const direct = getDirectSettlements(expenses)
    expect(direct).toEqual([
      { from: 'b', to: 'a', amount: 1227 },
      { from: 'c', to: 'a', amount: 1746 },
      { from: 'c', to: 'b', amount: 520 },
    ])
    expect(netOf(direct)).toEqual(nonZeroTotals(getBalances(expenses)))
  })

  it('uses itemized normalisation like the simplified view', () => {
    const expenses = [
      makeExpense({
        amount: 1000,
        splitMode: 'ITEMIZED',
        paidByList: [paidBy('a')],
        paidFor: [
          { participant: participant('a'), shares: 333 },
          { participant: participant('b'), shares: 667 },
        ],
        items: [
          {
            amount: 400,
            splitMode: 'EVENLY',
            paidFor: [{ participant: 'a', shares: 1 }],
          },
          {
            amount: 600,
            splitMode: 'EVENLY',
            paidFor: [
              { participant: 'a', shares: 1 },
              { participant: 'b', shares: 1 },
            ],
          },
        ],
      }),
    ]

    expect(getDirectSettlements(expenses)).toEqual([
      { from: 'b', to: 'a', amount: 300 },
    ])
  })

  it('keeps every participant net equal to the simplified view after rounding', () => {
    const ids = ['a', 'b', 'c', 'd', 'e']
    const expenses = Array.from({ length: 40 }, (_, index) => {
      const payerA = ids[index % ids.length]
      const payerB = ids[(index * 3 + 1) % ids.length]
      const multiPayer = index % 3 === 0 && payerA !== payerB
      return makeExpense({
        id: `e${index}`,
        amount: 101 + index * 37,
        paidBySplitMode: multiPayer ? 'BY_SHARES' : 'EVENLY',
        paidByList: multiPayer
          ? [paidBy(payerA, 2), paidBy(payerB, 1)]
          : [paidBy(payerA)],
        paidFor: evenlyFor(...ids.filter((_, i) => (i + index) % 4 !== 0)),
      })
    })

    const balances = getBalances(expenses)
    const simplified = getPublicBalances(getSuggestedSettlements(balances))
    const direct = getDirectSettlements(expenses, balances)

    expect(direct.every((leg) => Number.isInteger(leg.amount))).toBe(true)
    expect(direct.every((leg) => leg.amount > 0)).toBe(true)
    expect(netOf(direct)).toEqual(nonZeroTotals(simplified))
  })
})

describe('getDirectSettlementsByCurrency', () => {
  it('computes direct debts in each entered currency', () => {
    const expenses = [
      makeExpense({
        id: 'usd',
        amount: 9200,
        originalAmount: 10000,
        originalCurrency: 'USD',
        conversionRate: 0.92,
        paidByList: [paidBy('a')],
        paidFor: evenlyFor('b'),
      }),
      makeExpense({
        id: 'eur-1',
        amount: 500,
        paidByList: [paidBy('b')],
        paidFor: evenlyFor('c'),
      }),
      makeExpense({
        id: 'eur-2',
        amount: 300,
        paidByList: [paidBy('c')],
        paidFor: evenlyFor('b'),
      }),
    ]

    const byCurrency = getDirectSettlementsByCurrency(expenses, 'EUR')
    expect(byCurrency).toEqual([
      {
        currencyCode: 'USD',
        directSettlements: [{ from: 'b', to: 'a', amount: 10000 }],
      },
      {
        currencyCode: 'EUR',
        directSettlements: [{ from: 'c', to: 'b', amount: 200 }],
      },
    ])

    const balancesByCurrency = getBalancesByCurrency(expenses, 'EUR')
    for (const { currencyCode, directSettlements } of byCurrency) {
      expect(netOf(directSettlements)).toEqual(
        nonZeroTotals(balancesByCurrency[currencyCode]),
      )
    }
  })
})
