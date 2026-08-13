import { describe, expect, it } from 'vitest'

import { DEFAULT_CATEGORIES } from '../categories'
import {
  aliasCandidatesToPatch,
  createCategorySearchDocument,
  dictionaryLocaleFor,
  expandExpenseQuery,
  knownTokensForCategory,
  mineAliasCandidates,
  parseLocaleDictionary,
  parseSharedDictionary,
  rankCategories,
  resolveCategorySearchFields,
  suggestCategoryFromTitle,
  type CategorySearchDocument,
  type CategoryTitleMemory,
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

describe('parse dictionaries', () => {
  it('rejects unknown category ids in the shared dictionary', () => {
    expect(() => parseSharedDictionary({ 'not-a-category': ['x'] })).toThrow()
  })

  it('rejects unknown category ids in a locale dictionary', () => {
    expect(() => parseLocaleDictionary({ nope: { aliases: ['x'] } })).toThrow()
  })

  it('accepts the shipped dictionaries', () => {
    expect(resolveCategorySearchFields('taxi', 'en-US').aliases).toContain(
      'uber',
    )
    expect(resolveCategorySearchFields('taxi', 'fr-FR').aliases).toContain(
      'vtc',
    )
  })
})

describe('dictionaryLocaleFor', () => {
  it('maps English variants onto en-US', () => {
    expect(dictionaryLocaleFor('en-US')).toBe('en-US')
    expect(dictionaryLocaleFor('en-GZ')).toBe('en-US')
    expect(dictionaryLocaleFor('fr-FR')).toBe('fr-FR')
  })
})

describe('resolveCategorySearchFields', () => {
  it('puts shared brands in aliases for every locale', () => {
    expect(resolveCategorySearchFields('taxi', 'de-DE').aliases).toContain(
      'uber',
    )
  })

  it('uses en-US aliases only as low-weight fallback outside English', () => {
    const french = resolveCategorySearchFields('taxi', 'fr-FR')
    expect(french.aliases).toContain('vtc')
    expect(french.aliases).not.toContain('cab')
    expect(french.fallbackAliases).toContain('cab')
    expect(french.samples).not.toContain('uber to airport')
  })

  it('does not attach English fallback aliases for en-US', () => {
    expect(
      resolveCategorySearchFields('taxi', 'en-US').fallbackAliases,
    ).toEqual([])
  })
})

describe('rankCategories', () => {
  const english = documentsFor('en-US')

  it('ranks an alias hit as the best match', () => {
    expect(rankCategories('uber', english)[0]?.id).toBe('taxi')
  })

  it('ranks a sample phrase', () => {
    expect(rankCategories('weekly shop', english)[0]?.id).toBe('groceries')
  })

  it('tolerates a transposition typo in the label', () => {
    expect(rankCategories('grocereis', english)[0]?.id).toBe('groceries')
  })

  it('tolerates a one-character typo', () => {
    expect(rankCategories('rnnt', english)[0]?.id).toBe('rent')
  })

  it('ranks an exact child label above its parent grouping', () => {
    expect(rankCategories('rent', english)[0]?.id).toBe('rent')
  })

  it('prefers a child when parent and child scores tie', () => {
    const tied: CategorySearchDocument[] = [
      {
        id: 'home',
        label: 'Stay',
        grouping: 'Stay',
        isParent: true,
        aliases: [],
        samples: [],
        fallbackAliases: [],
      },
      {
        id: 'hotel',
        label: 'Stay',
        grouping: 'Stay',
        isParent: false,
        aliases: [],
        samples: [],
        fallbackAliases: [],
      },
    ]
    expect(rankCategories('stay', tied)[0]?.id).toBe('hotel')
  })

  it('returns nothing for an empty query', () => {
    expect(rankCategories('   ', english)).toEqual([])
  })

  it('ranks a French locale alias above the English fallback', () => {
    const french = documentsFor('fr-FR')
    expect(rankCategories('vtc', french)[0]?.id).toBe('taxi')
    expect(rankCategories('cab', french)[0]?.id).toBe('taxi')
    const vtc = rankCategories('vtc', french)[0]
    const cab = rankCategories('cab', french)[0]
    expect((vtc?.score ?? 0) > (cab?.score ?? 0)).toBe(true)
  })
})

describe('suggestCategoryFromTitle', () => {
  const english = documentsFor('en-US')

  it('auto-applies a confident alias', () => {
    const hit = suggestCategoryFromTitle('uber', english)
    expect(hit).toMatchObject({ id: 'taxi', source: 'dictionary' })
    expect(hit!.score).toBeGreaterThanOrEqual(0.7)
  })

  it('auto-applies a one-character label typo', () => {
    expect(suggestCategoryFromTitle('grocereis', english)?.id).toBe('groceries')
  })

  it('does not auto-apply a weak subsequence', () => {
    expect(suggestCategoryFromTitle('xyzzy', english)).toBeNull()
  })

  it('does not auto-apply very short keystrokes', () => {
    expect(suggestCategoryFromTitle('di', english)).toBeNull()
    expect(suggestCategoryFromTitle('ub', english)).toBeNull()
  })

  it('lets repeated exact history beat a missing dictionary', () => {
    const memory: CategoryTitleMemory[] = [
      { title: 'Luigi mysterious trattoria', categoryId: 'dining-out' },
      { title: 'Luigi mysterious trattoria', categoryId: 'dining-out' },
    ]
    expect(
      suggestCategoryFromTitle('Luigi mysterious trattoria', english, memory),
    ).toMatchObject({ id: 'dining-out', source: 'history' })
  })

  it('does not let a one-off history outlier override a strong alias', () => {
    const memory: CategoryTitleMemory[] = [
      { title: 'uber', categoryId: 'bus-train' },
    ]
    expect(suggestCategoryFromTitle('uber', english, memory)).toMatchObject({
      id: 'taxi',
      source: 'dictionary',
    })
  })

  it('uses a single exact history hit when dictionaries are weak', () => {
    const memory: CategoryTitleMemory[] = [
      { title: 'Luigi mysterious trattoria', categoryId: 'dining-out' },
    ]
    expect(
      suggestCategoryFromTitle('Luigi mysterious trattoria', english, memory),
    ).toMatchObject({ id: 'dining-out', source: 'history' })
  })
})

describe('expandExpenseQuery', () => {
  const english = documentsFor('en-US')

  it('expands a brand alias to the matching category', () => {
    expect(expandExpenseQuery('uber', english).categoryIds).toEqual(['taxi'])
  })

  it('expands a category-name typo', () => {
    expect(expandExpenseQuery('grocereis', english).categoryIds).toContain(
      'groceries',
    )
  })

  it('does not expand weak subsequence noise', () => {
    expect(expandExpenseQuery('xyzzy', english).categoryIds).toEqual([])
  })

  it('does not expand very short queries', () => {
    expect(expandExpenseQuery('ub', english).categoryIds).toEqual([])
  })
})

describe('knownTokensForCategory', () => {
  it('includes shared and locale tokens', () => {
    const tokens = knownTokensForCategory('taxi', 'en-US')
    expect(tokens.has('uber')).toBe(true)
    expect(tokens.has('cab')).toBe(true)
  })
})

describe('mineAliasCandidates', () => {
  it('emits frequent novel tokens and skips known aliases', () => {
    const rows = [
      ...Array.from({ length: 6 }, () => ({
        categoryId: 'taxi',
        title: 'Harbor shuttle to Helsinki',
      })),
      { categoryId: 'taxi', title: 'uber to the airport' },
      { categoryId: 'general', title: 'mystery token xyzzyxyzzy' },
      { categoryId: 'taxi', title: 'cab downtown' },
    ]
    const groups = mineAliasCandidates(rows, {
      locale: 'en-US',
      minCount: 5,
    })
    expect(groups).toEqual([
      {
        categoryId: 'taxi',
        candidates: [
          { token: 'harbor', count: 6 },
          { token: 'helsinki', count: 6 },
          { token: 'shuttle', count: 6 },
        ],
      },
    ])
    expect(aliasCandidatesToPatch(groups)).toEqual({
      taxi: { aliases: ['harbor', 'helsinki', 'shuttle'] },
    })
  })
})
