import { describe, expect, it } from 'vitest'

import {
  CATEGORY_IDS,
  DEFAULT_CATEGORIES,
  DEFAULT_CATEGORY_ID,
  DEFAULT_GROUPINGS,
  PARENT_CATEGORIES,
  PAYMENT_CATEGORY_ID,
  categoryIdSchema,
  categoryMatchesSelection,
  categorySelectionDisplayCount,
  expandCategorySelection,
  getCategoryById,
  getChildCategoryIds,
  isCategoryEffectivelySelected,
  isParentCategory,
  normalizeCategoryId,
  normalizeCategorySelection,
  resolveCategorySelection,
  toggleCategorySelection,
  validateCategories,
  type Category,
  type CategoryId,
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

  it('has a parent for every declared grouping', () => {
    for (const grouping of DEFAULT_GROUPINGS) {
      expect(
        PARENT_CATEGORIES.some((category) => category.grouping === grouping),
      ).toBe(true)
    }
  })

  it('derives CATEGORY_IDS from DEFAULT_CATEGORIES', () => {
    expect([...CATEGORY_IDS]).toEqual(
      DEFAULT_CATEGORIES.map((category) => category.id),
    )
  })

  it('is a valid hierarchy', () => {
    expect(validateCategories(DEFAULT_CATEGORIES)).toEqual({
      valid: true,
      errors: [],
    })
  })

  it('has no fake mirror children that duplicate the parent name among siblings', () => {
    for (const parent of PARENT_CATEGORIES) {
      const children = getChildCategoryIds(parent.id)
      expect(children).not.toContain(parent.id)
    }
  })
})

describe('DEFAULT_GROUPINGS', () => {
  it('follows parent declaration order', () => {
    expect([...DEFAULT_GROUPINGS]).toEqual(
      PARENT_CATEGORIES.map((category) => category.grouping),
    )
  })
})

describe('getCategoryById', () => {
  it('returns the matching category', () => {
    expect(getCategoryById('groceries')).toEqual({
      id: 'groceries',
      grouping: 'Food and Drink',
      name: 'Groceries',
      parentId: 'food-and-drink',
    })
  })

  it('returns undefined for unknown ids', () => {
    expect(getCategoryById('not-a-real-id')).toBeUndefined()
  })
})

describe('categoryIdSchema', () => {
  it('accepts a parent and child id', () => {
    expect(categoryIdSchema.parse('movies')).toBe('movies')
    expect(categoryIdSchema.parse('home')).toBe('home')
    expect(categoryIdSchema.parse('life')).toBe('life')
  })

  it('rejects an unknown id', () => {
    expect(() => categoryIdSchema.parse('not-a-real-id')).toThrow()
  })
})

describe('category hierarchy', () => {
  it('resolves a parent to itself and its children', () => {
    const resolved = resolveCategorySelection('home')
    expect(resolved).toContain('home')
    expect(resolved).toContain('rent')
    expect(resolved).not.toContain('groceries')
  })

  it('resolves a child to itself only', () => {
    expect(resolveCategorySelection('rent')).toEqual(['rent'])
  })

  it('expands overlapping selections without duplicates', () => {
    expect(expandCategorySelection(['home', 'rent'])).toEqual(
      expect.arrayContaining(['home', 'rent', 'electronics']),
    )
    expect(
      expandCategorySelection(['home', 'rent']).filter((id) => id === 'rent'),
    ).toHaveLength(1)
  })

  it('normalizes legacy group: parent ids', () => {
    expect(normalizeCategoryId('group:home')).toBe('home')
    expect(expandCategorySelection(['group:home'])).toContain('rent')
  })

  it('normalizes and deduplicates category selections without expanding them', () => {
    expect(normalizeCategorySelection(['group:home', 'home', 'rent'])).toEqual([
      'home',
      'rent',
    ])
  })

  it('matches a category against a parent selection', () => {
    expect(categoryMatchesSelection('mortgage', ['home'])).toBe(true)
    expect(categoryMatchesSelection('dining-out', ['home'])).toBe(false)
    expect(categoryMatchesSelection('home', ['home'])).toBe(true)
    expect(categoryMatchesSelection('home', ['rent'])).toBe(false)
  })

  it('matches a category added under a parent after the parent was selected', () => {
    const futureChild = {
      id: 'smart-home',
      grouping: 'Home',
      name: 'Smart Home',
      parentId: 'home',
    } as unknown as Category
    const custom: readonly Category[] = [...DEFAULT_CATEGORIES, futureChild]
    expect(resolveCategorySelection('home', custom)).toContain('smart-home')
    expect(
      categoryMatchesSelection('smart-home' as CategoryId, ['home'], custom),
    ).toBe(true)
  })

  it('marks parents as parent categories', () => {
    expect(isParentCategory('home')).toBe(true)
    expect(isParentCategory('rent')).toBe(false)
  })
})

describe('multi-select selection helpers', () => {
  it('treats parent selection as every child checked', () => {
    expect(isCategoryEffectivelySelected('home', ['home'])).toBe(true)
    expect(isCategoryEffectivelySelected('rent', ['home'])).toBe(true)
    expect(isCategoryEffectivelySelected('groceries', ['home'])).toBe(false)
  })

  it('counts parent selection as all children', () => {
    const childCount = getChildCategoryIds('home').length
    expect(categorySelectionDisplayCount(['home'])).toBe(childCount)
    expect(categorySelectionDisplayCount(['rent', 'pets'])).toBe(2)
    expect(categorySelectionDisplayCount(['personal-care-and-wellness'])).toBe(
      1,
    )
  })

  it('toggles a parent on and clears overlapping children', () => {
    expect(toggleCategorySelection(['rent', 'pets'], 'home')).toEqual(['home'])
  })

  it('expands parent when a child is unchecked', () => {
    const next = toggleCategorySelection(['home'], 'rent')
    expect(next).not.toContain('home')
    expect(next).not.toContain('rent')
    expect(next).toContain('pets')
    expect(next).toContain('electronics')
  })

  it('collapses to parent when all children are selected', () => {
    const children = getChildCategoryIds('home')
    const allButLast = children.slice(0, -1)
    const last = children.at(-1)!
    expect(toggleCategorySelection(allButLast, last)).toEqual(['home'])
  })
})
