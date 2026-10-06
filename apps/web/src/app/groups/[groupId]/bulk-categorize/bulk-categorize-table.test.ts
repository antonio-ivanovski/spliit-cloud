import { describe, expect, it } from 'vitest'

import {
  estimateCategorizeRowHeight,
  sortCategorizeRows,
  type CategorizeRow,
} from './bulk-categorize-table'

const row = (
  id: string,
  categoryId: CategorizeRow['categoryId'],
  expenseDate: string,
): CategorizeRow => ({
  id,
  title: id,
  categoryId,
  expenseDate,
  amount: 100,
  currency: 'USD',
  choices: [],
})

describe('bulk categorization row estimates', () => {
  it('reserves more height for alternatives and wrapped titles at each width', () => {
    const short = row('short', 'groceries', '2026-09-22')
    const withChoices: CategorizeRow = {
      ...short,
      choices: [
        {
          categoryId: 'transportation',
          source: 'local',
          confidence: null,
        },
      ],
    }
    const long = { ...withChoices, title: 'Long expense title '.repeat(12) }
    expect(estimateCategorizeRowHeight(withChoices, 390)).toBeGreaterThan(
      estimateCategorizeRowHeight(short, 390),
    )
    expect(estimateCategorizeRowHeight(long, 390)).toBeGreaterThan(
      estimateCategorizeRowHeight(withChoices, 390),
    )
    expect(estimateCategorizeRowHeight(withChoices, 900)).toBeGreaterThan(
      estimateCategorizeRowHeight(short, 900),
    )
    expect(estimateCategorizeRowHeight(long, 900)).toBeGreaterThan(
      estimateCategorizeRowHeight(withChoices, 900),
    )
    expect(estimateCategorizeRowHeight(long, 390)).toBeGreaterThan(
      estimateCategorizeRowHeight(long, 720),
    )
    expect(estimateCategorizeRowHeight(short, 900)).toBe(72)
    expect(estimateCategorizeRowHeight(withChoices, 900)).toBe(76)
  })
})

describe('bulk categorization table order', () => {
  it('keeps General expenses first, then shows more recent expenses first within each group', () => {
    const rows = [
      row('categorized', 'food-and-drink', '2026-09-22'),
      row('older-general', 'general', '2025-01-01'),
      row('newer-general', 'general', '2026-09-20'),
    ]
    expect(sortCategorizeRows(rows).map((item) => item.id)).toEqual([
      'newer-general',
      'older-general',
      'categorized',
    ])
    expect(rows[0]?.id).toBe('categorized')
  })
})
