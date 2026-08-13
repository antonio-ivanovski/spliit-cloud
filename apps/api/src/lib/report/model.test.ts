import {
  getBalances,
  getPublicBalances,
  getSuggestedSettlements,
} from '@spliit/domain'

import {
  buildExpenseReport,
  type ReportExpenseRow,
  type ReportParticipant,
} from './model'

function row(
  overrides: Partial<ReportExpenseRow> & Pick<ReportExpenseRow, 'id'>,
): ReportExpenseRow {
  return {
    id: overrides.id,
    amount: 1000,
    expenseDate: new Date('2026-07-01T00:00:00.000Z'),
    createdAt: new Date('2026-07-01T00:00:00.000Z'),
    categoryId: 'general',
    title: 'Dinner',
    splitMode: 'EVENLY',
    paidBySplitMode: 'EVENLY',
    originalAmount: null,
    originalCurrency: null,
    conversionRate: null,
    conversionSource: null,
    paidByList: [{ ledgerParticipantId: 'alice', shares: 1000 }],
    paidFor: [
      { ledgerParticipantId: 'alice', shares: 1 },
      { ledgerParticipantId: 'bob', shares: 1 },
    ],
    items: [],
    itemizedRemainder: null,
    ...overrides,
  }
}

const participants: ReportParticipant[] = [
  { id: 'alice', name: 'Alice', removed: false },
  { id: 'bob', name: 'Bob', removed: false },
  { id: 'carol', name: 'Carol', removed: true },
]

const baseInput = {
  groupName: 'Trip',
  currencyCode: 'EUR',
  currencySymbol: '€',
  currencyDecimalDigits: 2,
  from: new Date('2026-07-01T00:00:00.000Z'),
  to: new Date('2026-07-31T00:00:00.000Z'),
  rows: [] as ReportExpenseRow[],
  participants,
}

describe('buildExpenseReport', () => {
  it('derives period totals and categories from regular expenses in from..to', () => {
    const model = buildExpenseReport({
      ...baseInput,
      rows: [
        row({
          id: 'e1',
          amount: 3000,
          categoryId: 'food',
          expenseDate: new Date('2026-07-10T00:00:00.000Z'),
        }),
        row({
          id: 'e2',
          amount: 5000,
          categoryId: 'travel',
          expenseDate: new Date('2026-07-15T00:00:00.000Z'),
        }),
        row({
          id: 'e3',
          amount: 9999,
          categoryId: 'travel',
          expenseDate: new Date('2026-08-01T00:00:00.000Z'),
        }),
      ],
    })

    expect(model.from).toBe('2026-07-01')
    expect(model.to).toBe('2026-07-31')
    expect(model.period.total).toBe(8000)
    expect(model.period.expenseCount).toBe(2)
    expect(model.period.categories).toEqual([
      { categoryId: 'travel', amount: 5000 },
      { categoryId: 'food', amount: 3000 },
    ])
    expect(model.expenses.map((expense) => expense.id)).toEqual(['e1', 'e2'])
  })

  it('orders expenses by date then creation time', () => {
    const model = buildExpenseReport({
      ...baseInput,
      rows: [
        row({
          id: 'later-created',
          expenseDate: new Date('2026-07-02T00:00:00.000Z'),
          createdAt: new Date('2026-07-02T12:00:00.000Z'),
        }),
        row({
          id: 'earlier-created',
          expenseDate: new Date('2026-07-02T00:00:00.000Z'),
          createdAt: new Date('2026-07-02T09:00:00.000Z'),
        }),
        row({
          id: 'first-day',
          expenseDate: new Date('2026-07-01T00:00:00.000Z'),
        }),
      ],
    })

    expect(model.expenses.map((expense) => expense.id)).toEqual([
      'first-day',
      'earlier-created',
      'later-created',
    ])
  })

  it('excludes settlements from period totals but records them as recorded settlements', () => {
    const model = buildExpenseReport({
      ...baseInput,
      rows: [
        row({ id: 'e1', amount: 3000, categoryId: 'food' }),
        row({
          id: 'r1',
          amount: 2000,
          categoryId: 'settlement',
          expenseDate: new Date('2026-07-20T00:00:00.000Z'),
          paidByList: [{ ledgerParticipantId: 'bob', shares: 2000 }],
          paidFor: [{ ledgerParticipantId: 'alice', shares: 2000 }],
        }),
        row({
          id: 'r2',
          amount: 500,
          categoryId: 'settlement',
          expenseDate: new Date('2026-06-20T00:00:00.000Z'),
          paidByList: [{ ledgerParticipantId: 'alice', shares: 500 }],
          paidFor: [{ ledgerParticipantId: 'bob', shares: 500 }],
        }),
        row({
          id: 'r3',
          amount: 700,
          categoryId: 'settlement',
          expenseDate: new Date('2026-08-05T00:00:00.000Z'),
          paidByList: [{ ledgerParticipantId: 'alice', shares: 700 }],
          paidFor: [{ ledgerParticipantId: 'bob', shares: 700 }],
        }),
      ],
    })

    expect(model.period.total).toBe(3000)
    expect(model.period.expenseCount).toBe(1)
    expect(model.expenses.map((expense) => expense.id)).toEqual(['e1'])
    // Only settlements dated through end of `to` are recorded.
    expect(model.recordedSettlements.map((r) => r.date)).toEqual([
      '2026-06-20',
      '2026-07-20',
    ])
    expect(model.recordedSettlements[1]).toEqual({
      date: '2026-07-20',
      fromIds: ['bob'],
      toIds: ['alice'],
      amount: 2000,
    })
  })

  it('computes per-participant period paid/share and as-of public balances', () => {
    const model = buildExpenseReport({
      ...baseInput,
      rows: [
        row({
          id: 'e1',
          amount: 1000,
          paidByList: [{ ledgerParticipantId: 'alice', shares: 1000 }],
          paidFor: [
            { ledgerParticipantId: 'alice', shares: 1 },
            { ledgerParticipantId: 'bob', shares: 1 },
          ],
        }),
        row({
          id: 'r1',
          amount: 300,
          categoryId: 'settlement',
          paidByList: [{ ledgerParticipantId: 'bob', shares: 300 }],
          paidFor: [{ ledgerParticipantId: 'alice', shares: 300 }],
        }),
      ],
    })

    const alice = model.participants.find(
      (participant) => participant.id === 'alice',
    )!
    const bob = model.participants.find(
      (participant) => participant.id === 'bob',
    )!

    // Alice paid 1000, owes 500 in the period; Bob owes 500.
    expect(alice.periodPaid).toBe(1000)
    expect(alice.periodShare).toBe(500)
    expect(bob.periodPaid).toBe(0)
    expect(bob.periodShare).toBe(500)
    expect(alice.removed).toBe(false)

    // As of balances: Alice paid 1000, owes 500, received 300 → net +200;
    // Bob owes 500, paid 300 → net -200. Public balances reflect the
    // remaining flow after suggested settlements are accounted.
    expect(alice.balanceAsOf).toBe(200)
    expect(bob.balanceAsOf).toBe(-200)
    expect(model.suggestedSettlements).toEqual([
      { from: 'bob', to: 'alice', amount: 200 },
    ])
  })

  it('matches groups.balances.list math for identical rows (to = today)', () => {
    const rows = [
      row({
        id: 'e1',
        amount: 12345,
        categoryId: 'food',
        expenseDate: new Date('2026-07-01T00:00:00.000Z'),
        paidByList: [{ ledgerParticipantId: 'alice', shares: 12345 }],
        paidFor: [
          { ledgerParticipantId: 'alice', shares: 1 },
          { ledgerParticipantId: 'bob', shares: 1 },
        ],
      }),
      row({
        id: 'e2',
        amount: 8765,
        categoryId: 'travel',
        expenseDate: new Date('2026-07-02T00:00:00.000Z'),
        splitMode: 'BY_PERCENTAGE',
        paidBySplitMode: 'EVENLY',
        paidByList: [{ ledgerParticipantId: 'bob', shares: 8765 }],
        paidFor: [
          { ledgerParticipantId: 'alice', shares: 2500 },
          { ledgerParticipantId: 'bob', shares: 7500 },
        ],
      }),
      row({
        id: 'r1',
        amount: 4000,
        categoryId: 'settlement',
        expenseDate: new Date('2026-07-03T00:00:00.000Z'),
        paidByList: [{ ledgerParticipantId: 'bob', shares: 4000 }],
        paidFor: [{ ledgerParticipantId: 'alice', shares: 4000 }],
      }),
    ]
    const model = buildExpenseReport({
      ...baseInput,
      to: new Date('2026-07-31T00:00:00.000Z'),
      rows,
    })

    // Re-run the same math the balances router performs.
    const balanceRows = rows.map((r) => ({
      id: r.id,
      amount: r.amount,
      splitMode: r.splitMode,
      paidBySplitMode: r.paidBySplitMode,
      originalAmount: r.originalAmount,
      originalCurrency: r.originalCurrency,
      conversionRate: r.conversionRate,
      conversionSource: r.conversionSource,
      paidByList: r.paidByList.map((s) => ({
        shares: s.shares,
        participant: { id: s.ledgerParticipantId },
      })),
      paidFor: r.paidFor.map((s) => ({
        shares: s.shares,
        participant: { id: s.ledgerParticipantId },
      })),
      items: r.items,
      itemizedRemainder: r.itemizedRemainder,
    }))
    const balances = getBalances(balanceRows)
    const suggested = getSuggestedSettlements(balances)
    const publicBalances = getPublicBalances(suggested)

    expect(model.suggestedSettlements).toEqual(suggested)
    for (const participant of model.participants) {
      expect(participant.balanceAsOf).toBe(
        publicBalances[participant.id]?.total ?? 0,
      )
    }
  })

  it('keeps integer cents for every split mode, multi-payer, and rounding residuals', () => {
    const model = buildExpenseReport({
      ...baseInput,
      rows: [
        row({
          id: 'evenly',
          amount: 100,
          splitMode: 'EVENLY',
          paidFor: [
            { ledgerParticipantId: 'alice', shares: 1 },
            { ledgerParticipantId: 'bob', shares: 1 },
            { ledgerParticipantId: 'carol', shares: 1 },
          ],
        }),
        row({
          id: 'percentage',
          amount: 100,
          splitMode: 'BY_PERCENTAGE',
          paidFor: [
            { ledgerParticipantId: 'alice', shares: 2500 },
            { ledgerParticipantId: 'bob', shares: 7500 },
          ],
        }),
        row({
          id: 'by-amount',
          amount: 100,
          splitMode: 'BY_AMOUNT',
          paidFor: [
            { ledgerParticipantId: 'alice', shares: 33 },
            { ledgerParticipantId: 'bob', shares: 33 },
            { ledgerParticipantId: 'carol', shares: 34 },
          ],
        }),
        row({
          id: 'multi-payer',
          amount: 200,
          splitMode: 'EVENLY',
          paidBySplitMode: 'BY_AMOUNT',
          paidByList: [
            { ledgerParticipantId: 'alice', shares: 150 },
            { ledgerParticipantId: 'bob', shares: 50 },
          ],
          paidFor: [
            { ledgerParticipantId: 'alice', shares: 1 },
            { ledgerParticipantId: 'bob', shares: 1 },
          ],
        }),
        row({
          id: 'itemized',
          amount: 1000,
          splitMode: 'ITEMIZED',
          items: [
            {
              amount: 600,
              splitMode: 'EVENLY',
              paidFor: [
                { ledgerParticipantId: 'alice', shares: 1 },
                { ledgerParticipantId: 'bob', shares: 1 },
              ],
            },
            {
              amount: 400,
              splitMode: 'EVENLY',
              paidFor: [
                { ledgerParticipantId: 'alice', shares: 1 },
                { ledgerParticipantId: 'carol', shares: 1 },
              ],
            },
          ],
          // Detail rows surface the stored per-participant totals (the same
          // literal shares the expense form and CSV export display).
          paidFor: [
            { ledgerParticipantId: 'alice', shares: 500 },
            { ledgerParticipantId: 'bob', shares: 300 },
            { ledgerParticipantId: 'carol', shares: 200 },
          ],
        }),
      ],
    })

    for (const expense of model.expenses) {
      const payerSum = expense.payers.reduce(
        (sum, payer) => sum + payer.amount,
        0,
      )
      const shareSum = expense.shares.reduce(
        (sum, share) => sum + share.amount,
        0,
      )
      expect(payerSum).toBe(expense.amount)
      expect(shareSum).toBe(expense.amount)
      for (const payer of expense.payers)
        expect(Number.isInteger(payer.amount)).toBe(true)
      for (const share of expense.shares)
        expect(Number.isInteger(share.amount)).toBe(true)
    }

    const itemized = model.expenses.find(
      (expense) => expense.id === 'itemized',
    )!
    expect(
      itemized.shares.find((share) => share.participantId === 'alice')!.amount,
    ).toBe(500)
    expect(
      itemized.shares.find((share) => share.participantId === 'bob')!.amount,
    ).toBe(300)
    expect(
      itemized.shares.find((share) => share.participantId === 'carol')!.amount,
    ).toBe(200)
  })

  it('keeps original conversion metadata on cross-currency expenses', () => {
    const model = buildExpenseReport({
      ...baseInput,
      rows: [
        row({
          id: 'converted',
          amount: 9348,
          categoryId: 'travel',
          originalAmount: 10000,
          originalCurrency: 'JPY',
          conversionRate: 0.09348,
          conversionSource: 'EXCHANGE',
          paidByList: [{ ledgerParticipantId: 'alice', shares: 10000 }],
          paidFor: [
            { ledgerParticipantId: 'alice', shares: 5000 },
            { ledgerParticipantId: 'bob', shares: 5000 },
          ],
        }),
      ],
    })

    const converted = model.expenses[0]
    expect(converted.originalAmount).toBe(10000)
    expect(converted.originalCurrency).toBe('JPY')
    expect(converted.conversionRate).toBe(0.09348)
    expect(converted.conversionSource).toBe('EXCHANGE')
    // Payer/share amounts are always in the group currency.
    expect(converted.payers).toEqual([{ participantId: 'alice', amount: 9348 }])
    const shareSum = converted.shares.reduce(
      (sum, share) => sum + share.amount,
      0,
    )
    expect(shareSum).toBe(9348)
  })

  it('handles an empty group with zero totals and participants preserved', () => {
    const model = buildExpenseReport({ ...baseInput, rows: [] })
    expect(model.period.total).toBe(0)
    expect(model.period.expenseCount).toBe(0)
    expect(model.period.categories).toEqual([])
    expect(model.expenses).toEqual([])
    expect(model.suggestedSettlements).toEqual([])
    expect(model.recordedSettlements).toEqual([])
    expect(model.participants).toHaveLength(3)
    for (const participant of model.participants) {
      expect(participant.periodPaid).toBe(0)
      expect(participant.periodShare).toBe(0)
      expect(participant.balanceAsOf).toBe(0)
    }
  })

  it('marks removed participants', () => {
    const model = buildExpenseReport({
      ...baseInput,
      rows: [
        row({
          id: 'e1',
          amount: 1000,
          paidFor: [
            { ledgerParticipantId: 'alice', shares: 1 },
            { ledgerParticipantId: 'carol', shares: 1 },
          ],
        }),
      ],
    })
    const carol = model.participants.find(
      (participant) => participant.id === 'carol',
    )!
    expect(carol.removed).toBe(true)
    expect(carol.periodShare).toBe(500)
  })
})
