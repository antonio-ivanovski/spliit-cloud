import { describe, expect, it } from 'vitest'

import { getGroupedExpensesByDate } from '../expense-timeline'

describe('expense timeline grouping', () => {
  it('keeps future and older expenses in the shared timeline buckets', () => {
    const grouped = getGroupedExpensesByDate(
      [
        {
          id: 'future',
          expenseDate: '2099-01-01T00:00:00.000Z',
          expenseTimeZone: 'UTC',
        },
        {
          id: 'older',
          expenseDate: '2020-01-01T00:00:00.000Z',
          expenseTimeZone: 'UTC',
        },
      ],
      'UTC',
    )

    expect(grouped.upcoming.map((expense) => expense.id)).toEqual(['future'])
    expect(grouped.older.map((expense) => expense.id)).toEqual(['older'])
  })

  it('uses the active locale when deciding whether a Sunday is this week', () => {
    const expenses = [
      { id: 'sunday', expenseDate: '2026-08-02', expenseTimeZone: 'UTC' },
    ]
    const now = new Date('2026-08-06T12:00:00.000Z')

    expect(
      getGroupedExpensesByDate(expenses, 'UTC', 'en-US', now).thisWeek,
    ).toHaveLength(1)
    expect(
      getGroupedExpensesByDate(expenses, 'UTC', 'de-DE', now).previousWeek,
    ).toHaveLength(1)
  })

  it('keeps the locale week start inclusive', () => {
    const now = new Date('2026-08-06T12:00:00.000Z')
    const grouped = getGroupedExpensesByDate(
      [{ id: 'monday', expenseDate: '2026-08-03', expenseTimeZone: 'UTC' }],
      'UTC',
      'de-DE',
      now,
    )

    expect(grouped.thisWeek.map((expense) => expense.id)).toEqual(['monday'])
  })

  it('places the preceding locale week between this week and this month', () => {
    const now = new Date('2026-08-06T12:00:00.000Z')
    const grouped = getGroupedExpensesByDate(
      [
        {
          id: 'previous-week',
          expenseDate: '2026-07-30',
          expenseTimeZone: 'UTC',
        },
      ],
      'UTC',
      'en-US',
      now,
    )

    expect(grouped.previousWeek.map((expense) => expense.id)).toEqual([
      'previous-week',
    ])
    expect(grouped.earlierThisMonth).toHaveLength(0)
  })
})
