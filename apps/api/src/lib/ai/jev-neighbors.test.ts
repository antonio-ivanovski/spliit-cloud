import { describe, expect, it } from 'vitest'

import type { CategoryId } from '@spliit/domain'

import { selectDateNeighbors } from './jev-neighbors'

describe('date-neighbor hints', () => {
  it('takes up to three confirmed categories on each side within seven days', () => {
    const target = {
      id: 'target',
      title: 'Hotel',
      expenseDate: '2026-09-15T12:00:00.000Z',
    }
    const rows: Array<{
      id: string
      title: string
      categoryId: CategoryId
      expenseDate: string
    }> = [-9, -6, -5, -4, -3, -2, -1, 1, 2, 3, 4, 8].map((days) => ({
      id: String(days),
      title: `Expense ${days}`,
      categoryId: 'groceries',
      expenseDate: new Date(
        Date.parse(target.expenseDate) + days * 86400000,
      ).toISOString(),
    }))
    rows.push({
      id: 'general',
      title: 'No label',
      categoryId: 'general',
      expenseDate: target.expenseDate,
    })
    expect(selectDateNeighbors(target, rows).map((row) => row.title)).toEqual([
      'Expense -1',
      'Expense -2',
      'Expense -3',
      'Expense 1',
      'Expense 2',
      'Expense 3',
    ])
  })
})
