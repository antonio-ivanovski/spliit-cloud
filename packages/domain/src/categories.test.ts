import { describe, expect, it } from 'vitest'
import {
  CATEGORY_IDS,
  DEFAULT_CATEGORIES,
  DEFAULT_CATEGORY_ID,
  DEFAULT_GROUPINGS,
  PAYMENT_CATEGORY_ID,
  categoryIdSchema,
  getCategoryById,
} from './categories'

describe('DEFAULT_CATEGORIES', () => {
  it('has unique ids', () => {
    const ids = DEFAULT_CATEGORIES.map((category) => category.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('keeps the legacy default and payment ids', () => {
    expect(getCategoryById(DEFAULT_CATEGORY_ID)?.name).toBe('General')
    expect(getCategoryById(PAYMENT_CATEGORY_ID)?.name).toBe('Payment')
  })

  it('has at least one entry per declared grouping', () => {
    for (const grouping of DEFAULT_GROUPINGS) {
      expect(
        DEFAULT_CATEGORIES.some((category) => category.grouping === grouping),
      ).toBe(true)
    }
  })

  it('derives CATEGORY_IDS from DEFAULT_CATEGORIES', () => {
    expect([...CATEGORY_IDS]).toEqual(
      DEFAULT_CATEGORIES.map((category) => category.id),
    )
  })
})

describe('DEFAULT_GROUPINGS', () => {
  it('preserves the declaration order from DEFAULT_CATEGORIES', () => {
    const seen = new Set<string>()
    const order: string[] = []
    for (const category of DEFAULT_CATEGORIES) {
      if (!seen.has(category.grouping)) {
        seen.add(category.grouping)
        order.push(category.grouping)
      }
    }
    expect([...DEFAULT_GROUPINGS]).toEqual(order)
  })
})

describe('getCategoryById', () => {
  it('returns the matching category', () => {
    expect(getCategoryById('groceries')).toEqual({
      id: 'groceries',
      grouping: 'Food and Drink',
      name: 'Groceries',
    })
  })

  it('returns undefined for unknown ids', () => {
    expect(getCategoryById('not-a-real-id' as never)).toBeUndefined()
  })
})

describe('categoryIdSchema', () => {
  it('accepts a valid id', () => {
    expect(categoryIdSchema.parse('movies')).toBe('movies')
  })

  it('rejects an unknown id', () => {
    expect(() => categoryIdSchema.parse('not-a-real-id')).toThrow()
  })
})
