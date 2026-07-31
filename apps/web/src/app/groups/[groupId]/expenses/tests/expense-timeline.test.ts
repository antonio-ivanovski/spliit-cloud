import { describe, expect, it } from 'vitest'

import { getGroupedExpensesByDate } from '../expense-timeline'

describe('expense timeline grouping', () => {
  it('keeps future and older expenses in the shared timeline buckets', () => {
    const grouped = getGroupedExpensesByDate(
      [
        { id: 'future', expenseDate: '2099-01-01T00:00:00.000Z' },
        { id: 'older', expenseDate: '2020-01-01T00:00:00.000Z' },
      ],
      'UTC',
    )

    expect(grouped.upcoming.map((expense) => expense.id)).toEqual(['future'])
    expect(grouped.older.map((expense) => expense.id)).toEqual(['older'])
  })
})
