import { describe, expect, it } from 'vitest'

import { DEFAULT_CATEGORIES } from '../categories'
import {
  createCategorySearchDocument,
  suggestCategoryRunnersUp,
  type CategorySearchDocument,
} from './index'

function documentsFor(locale: string): CategorySearchDocument[] {
  return DEFAULT_CATEGORIES.map((category) =>
    createCategorySearchDocument(category, {
      label: category.parentId === null ? category.grouping : category.name,
      grouping: category.grouping,
      locale,
    }),
  )
}

const english = documentsFor('en-US')

function syntheticDoc(
  id: CategorySearchDocument['id'],
  alias: string,
): CategorySearchDocument {
  return {
    id,
    label: id,
    grouping: 'group',
    isParent: false,
    aliases: [alias],
    samples: [],
    fallbackAliases: [],
  }
}

describe('suggestCategoryRunnersUp', () => {
  it('returns below-gate guesses on a total miss', () => {
    // Both aliases score 0.92, under the raised 0.95 gate but above the
    // derived 0.75 floor.
    const runners = suggestCategoryRunnersUp('nike', english, {
      thresholds: { minScore: 0.95, settlementMinScore: 0.99 },
    })
    expect(runners).toEqual([
      { id: 'sports', score: 0.92, source: 'dictionary' },
      { id: 'clothing', score: 0.92, source: 'dictionary' },
    ])
  })

  it('derives the floor from the main threshold', () => {
    // Floor 0.95 - 0.2 = 0.75 keeps dining-out; heat-gas (0.8 via the "eat"
    // substring) no longer ranks since mid-word substring matches need a
    // 4+ character needle — "eat" suggesting heating gas was the same
    // short-token noise class as "in" -> insurance.
    const runners = suggestCategoryRunnersUp('eat', english, {
      thresholds: { minScore: 0.95, settlementMinScore: 0.99 },
    })
    expect(runners.map((runner) => runner.id)).toEqual(['dining-out'])
  })

  it('cuts guesses outside the near-miss window', () => {
    // groceries is suppressed as a child of the kept food-and-drink;
    // dining-out (0.506) is above the 0.5 floor but 0.414 below the top hit.
    const runners = suggestCategoryRunnersUp('food', english)
    expect(runners.map((runner) => runner.id)).toEqual([
      'food-and-drink',
      'pets',
    ])
  })

  it('excludes the applied category and its family, never settlement', () => {
    // groceries is a child of the excluded food-and-drink; settlement ranks
    // in-window (0.644) but is never a guess.
    const runners = suggestCategoryRunnersUp('mart', english, {
      excludeIds: ['food-and-drink'],
    })
    expect(runners.map((runner) => runner.id)).toEqual([
      'pets',
      'tolls',
      'electronics',
    ])
  })

  it('suppresses ancestors of a kept candidate', () => {
    const docs = [
      syntheticDoc('dining-out', 'bbq'),
      syntheticDoc('food-and-drink', 'bbq'),
    ]
    const runners = suggestCategoryRunnersUp('bbq', docs)
    expect(runners.map((runner) => runner.id)).toEqual(['dining-out'])
  })

  it('never suggests general', () => {
    const docs = [syntheticDoc('general', 'zzq'), syntheticDoc('movies', 'zzq')]
    const runners = suggestCategoryRunnersUp('zzq', docs)
    expect(runners.map((runner) => runner.id)).toEqual(['movies'])
  })

  it('never suggests settlement, even above the auto-apply score', () => {
    expect(suggestCategoryRunnersUp('settle up', english)).toEqual([])
  })

  it('returns nothing for short or unmatched titles', () => {
    expect(suggestCategoryRunnersUp('ab', english)).toEqual([])
    expect(suggestCategoryRunnersUp('apple store', english)).toEqual([])
  })

  it('caps the list at the given limit', () => {
    const runners = suggestCategoryRunnersUp('eat', english, { limit: 2 })
    expect(runners.map((runner) => runner.id)).toEqual([
      'dining-out',
      'heat-gas',
    ])
  })
})
