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

  it('excludes reimbursements and non-positive expenses from spending visuals', () => {
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

    expect(dashboard.lifetimeTotal).toBe(1500)
    expect(dashboard.period?.expenseCount).toBe(1)
    expect(dashboard.categories).toEqual([
      expect.objectContaining({ categoryId: 'groceries', amount: 1500 }),
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
})
