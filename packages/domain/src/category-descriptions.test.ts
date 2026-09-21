import { describe, expect, it } from 'vitest'

import { DEFAULT_CATEGORIES } from './categories'
import {
  CATEGORY_AI_DESCRIPTIONS,
  describeCategoryForAI,
} from './category-descriptions'

describe('CATEGORY_AI_DESCRIPTIONS', () => {
  it('covers every category with non-empty guidance', () => {
    expect(Object.keys(CATEGORY_AI_DESCRIPTIONS).sort()).toEqual(
      DEFAULT_CATEGORIES.map(({ id }) => id).sort(),
    )
    for (const [id, { what, notFor }] of Object.entries(
      CATEGORY_AI_DESCRIPTIONS,
    )) {
      expect(what.trim().length, `${id}.what`).toBeGreaterThan(0)
      expect(notFor.trim().length, `${id}.notFor`).toBeGreaterThan(0)
    }
  })

  it('separates the confusable food/drink cluster', () => {
    const liquor = CATEGORY_AI_DESCRIPTIONS['liquor']!
    expect(liquor.notFor).toContain('dining-out')
    expect(liquor.notFor).toContain('groceries')
    const diningOut = CATEGORY_AI_DESCRIPTIONS['dining-out']!
    expect(diningOut.notFor).toContain('groceries')
    expect(diningOut.notFor).toContain('liquor')
  })

  it('derives parent hints from the taxonomy, except for general', () => {
    const liquor = DEFAULT_CATEGORIES.find(({ id }) => id === 'liquor')!
    expect(describeCategoryForAI(liquor)).toContain('choose "food-and-drink"')

    const general = DEFAULT_CATEGORIES.find(({ id }) => id === 'general')!
    expect(describeCategoryForAI(general)).not.toContain(
      'choose "uncategorized"',
    )

    const childless = DEFAULT_CATEGORIES.find(({ id }) => id === 'income')!
    expect(describeCategoryForAI(childless)).not.toContain(
      'prefer a more specific child',
    )
  })
})
