import type { StatsExpense } from './dashboard'
import { buildGroupStatsDashboard } from './dashboard'

function expense(
  id: string,
  date: string,
  amount: number,
  categoryId: StatsExpense['categoryId'],
  participantId = 'antonio',
): StatsExpense {
  return {
    id,
    amount,
    categoryId,
    expenseDate: new Date(`${date}T00:00:00.000Z`),
    expenseTimeZone: 'UTC',
    isReimbursement: false,
    splitMode: 'EVENLY',
    paidBySplitMode: 'BY_AMOUNT',
    paidByList: [
      {
        shares: amount,
        participant: { id: participantId, name: participantId },
      },
    ],
    paidFor: [
      { shares: 1, participant: { id: participantId, name: participantId } },
    ],
  }
}

describe('buildGroupStatsDashboard', () => {
  it('uses the latest activity cluster while keeping lifetime spending', () => {
    const dashboard = buildGroupStatsDashboard(
      [
        expense('old', '2024-01-10', 1200, 'groceries'),
        expense('first', '2024-06-01', 2200, 'hotel'),
        expense('latest', '2024-06-08', 1800, 'dining-out'),
      ],
      'LATEST_ACTIVITY',
    )

    expect(dashboard.lifetimeTotal).toBe(5200)
    expect(dashboard.period).toMatchObject({
      total: 4000,
      expenseCount: 2,
      granularity: 'DAY',
    })
    expect(dashboard.period?.from).toEqual(new Date('2024-06-01T00:00:00.000Z'))
    expect(dashboard.categories.map((category) => category.categoryId)).toEqual(
      ['hotel', 'dining-out'],
    )
  })

  it('collapses long empty stretches and derives participant shares', () => {
    const dashboard = buildGroupStatsDashboard(
      [
        expense('first', '2024-06-01', 1000, 'groceries', 'antonio'),
        expense('latest', '2024-06-07', 3000, 'hotel', 'maria'),
      ],
      'WEEK',
    )

    expect(dashboard.timeline.map((item) => item.type)).toEqual([
      'bucket',
      'gap',
      'bucket',
    ])
    expect(dashboard.participants).toEqual([
      expect.objectContaining({
        participantId: 'maria',
        amount: 3000,
        percentage: 0.75,
      }),
      expect.objectContaining({
        participantId: 'antonio',
        amount: 1000,
        percentage: 0.25,
      }),
    ])
  })

  it('excludes reimbursements and nets non-positive expenses in spending visuals', () => {
    const reimbursement = expense('reimbursement', '2024-06-05', 900, 'payment')
    reimbursement.isReimbursement = true
    const refund = expense('refund', '2024-06-06', -200, 'groceries')

    const dashboard = buildGroupStatsDashboard(
      [
        expense('spending', '2024-06-07', 1500, 'groceries'),
        reimbursement,
        refund,
      ],
      'WEEK',
    )

    expect(dashboard.lifetimeTotal).toBe(1300)
    expect(dashboard.period?.expenseCount).toBe(2)
    expect(dashboard.period?.total).toBe(1300)
    expect(dashboard.categories).toEqual([
      expect.objectContaining({
        categoryId: 'groceries',
        amount: 1300,
        percentage: 1300 / 1500,
      }),
    ])
  })

  it('keeps a refund-only period and percentages against gross positive spend', () => {
    const dashboard = buildGroupStatsDashboard(
      [
        expense('groceries', '2024-06-07', 1500, 'groceries'),
        expense('income', '2024-06-07', -200, 'income'),
      ],
      'WEEK',
    )

    expect(dashboard.lifetimeTotal).toBe(1300)
    expect(dashboard.period?.expenseCount).toBe(2)
    expect(dashboard.categories).toEqual([
      expect.objectContaining({
        categoryId: 'groceries',
        amount: 1500,
        percentage: 1,
      }),
      expect.objectContaining({
        categoryId: 'income',
        amount: -200,
        percentage: -200 / 1500,
      }),
    ])
  })

  it('keeps a net-zero bucket when spend and refund offset', () => {
    const dashboard = buildGroupStatsDashboard(
      [
        expense('spend', '2024-06-07', 1500, 'groceries'),
        expense('refund', '2024-06-07', -1500, 'groceries'),
      ],
      'LATEST_ACTIVITY',
    )

    expect(dashboard.period?.total).toBe(0)
    expect(dashboard.period?.expenseCount).toBe(2)
    expect(dashboard.timeline).toEqual([
      expect.objectContaining({
        type: 'bucket',
        total: 0,
        categories: [
          expect.objectContaining({ categoryId: 'groceries', amount: 0 }),
        ],
      }),
    ])
  })

  it('reports a refund-only period instead of empty stats', () => {
    const dashboard = buildGroupStatsDashboard(
      [expense('refund', '2024-06-07', -200, 'groceries')],
      'WEEK',
    )

    expect(dashboard.lifetimeTotal).toBe(-200)
    expect(dashboard.period?.expenseCount).toBe(1)
    expect(dashboard.period?.total).toBe(-200)
    expect(dashboard.categories).toEqual([
      expect.objectContaining({
        categoryId: 'groceries',
        amount: -200,
        percentage: -1,
      }),
    ])
  })

  it('supports a custom period with an appropriate bucket size', () => {
    const dashboard = buildGroupStatsDashboard(
      [
        expense('old', '2024-01-10', 1200, 'groceries'),
        expense('selected', '2024-03-11', 1800, 'hotel'),
      ],
      'CUSTOM',
      {
        from: new Date('2024-01-01T00:00:00.000Z'),
        to: new Date('2024-03-31T00:00:00.000Z'),
      },
    )

    expect(dashboard.period).toMatchObject({
      total: 3000,
      expenseCount: 2,
      granularity: 'WEEK',
    })
    expect(dashboard.period?.from).toEqual(new Date('2024-01-01T00:00:00.000Z'))
    expect(dashboard.period?.to).toEqual(new Date('2024-03-31T00:00:00.000Z'))
  })

  it('groups an expense by its stored wall-calendar date', () => {
    const dashboard = buildGroupStatsDashboard(
      [
        {
          ...expense('late', '2024-06-01', 1800, 'dining-out'),
          expenseDate: new Date('2024-06-01T00:30:00.000Z'),
          expenseTimeZone: 'America/Los_Angeles',
        },
      ],
      'LATEST_ACTIVITY',
    )

    expect(dashboard.period?.from).toEqual(new Date('2024-05-31T00:00:00.000Z'))
    expect(dashboard.period?.to).toEqual(new Date('2024-05-31T00:00:00.000Z'))
    expect(dashboard.timeline[0]).toMatchObject({
      type: 'bucket',
      start: new Date('2024-05-31T00:00:00.000Z'),
      total: 1800,
    })
  })
})
