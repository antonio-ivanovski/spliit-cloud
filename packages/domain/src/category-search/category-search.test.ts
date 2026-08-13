import { beforeAll, describe, expect, it } from 'vitest'

import { DEFAULT_CATEGORIES } from '../categories'
import {
  aliasCandidatesToPatch,
  createCategorySearchDocument,
  dictionaryLocaleFor,
  expandExpenseQuery,
  knownTokensForCategory,
  loadLocaleDictionary,
  meetsCategorySuggestMinQueryLength,
  mineAliasCandidates,
  parseLocaleDictionary,
  parseSharedDictionary,
  peekLocaleDictionary,
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

  it('accepts the shipped dictionaries', async () => {
    await loadLocaleDictionary('fr-FR')
    expect(resolveCategorySearchFields('taxi', 'en-US').aliases).toContain(
      'uber',
    )
    expect(resolveCategorySearchFields('taxi', 'fr-FR').aliases).toContain(
      'vtc',
    )
  })
})

describe('lazy locale dictionaries', () => {
  it('does not preload non-English dictionaries', () => {
    expect(peekLocaleDictionary('en-US')).toBeDefined()
    expect(peekLocaleDictionary('mk-MK')).toBeUndefined()
  })

  it('loads a locale dictionary on demand', async () => {
    await loadLocaleDictionary('de-DE')
    expect(peekLocaleDictionary('de-DE')).toBeDefined()
    expect(resolveCategorySearchFields('taxi', 'de-DE').aliases).toContain(
      'fahrdienst',
    )
    expect(peekLocaleDictionary('mk-MK')).toBeUndefined()
  })
})

describe('dictionaryLocaleFor', () => {
  it('maps language variants onto a shipped dictionary', () => {
    expect(dictionaryLocaleFor('en-US')).toBe('en-US')
    expect(dictionaryLocaleFor('en')).toBe('en-US')
    expect(dictionaryLocaleFor('en-GZ')).toBe('en-US')
    expect(dictionaryLocaleFor('fr-FR')).toBe('fr-FR')
    expect(dictionaryLocaleFor('fr')).toBe('fr-FR')
    expect(dictionaryLocaleFor('fr-CA')).toBe('fr-FR')
    expect(dictionaryLocaleFor('de-DE')).toBe('de-DE')
    expect(dictionaryLocaleFor('de')).toBe('de-DE')
    expect(dictionaryLocaleFor('es')).toBe('es')
    expect(dictionaryLocaleFor('pt-BR')).toBe('pt-BR')
    expect(dictionaryLocaleFor('zh-CN')).toBe('zh-CN')
    expect(dictionaryLocaleFor('mk-MK')).toBe('mk-MK')
  })
})

describe('resolveCategorySearchFields', () => {
  beforeAll(async () => {
    await loadLocaleDictionary('fr-FR')
  })

  it('uses French aliases for fr and fr-CA', () => {
    expect(resolveCategorySearchFields('taxi', 'fr').aliases).toContain('vtc')
    expect(resolveCategorySearchFields('taxi', 'fr-CA').aliases).toContain(
      'vtc',
    )
  })

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

  it('promotes English aliases for non-Latin locales', async () => {
    await loadLocaleDictionary('zh-CN')
    const fields = resolveCategorySearchFields('plane', 'zh-CN')
    expect(fields.aliases).toContain('机票')
    expect(fields.aliases).toContain('flight')
    expect(fields.aliases).toContain('Plane')
    expect(fields.fallbackAliases).toEqual([])
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

  it('ranks a French locale alias above the English fallback', async () => {
    await loadLocaleDictionary('fr-FR')
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
    expect(suggestCategoryFromTitle('a', english)).toBeNull()
    expect(suggestCategoryFromTitle('ai', english)).toBeNull()
    expect(suggestCategoryFromTitle('di', english)).toBeNull()
    expect(suggestCategoryFromTitle('ub', english)).toBeNull()
  })

  it('does not auto-apply an ambiguous brand alias', () => {
    expect(suggestCategoryFromTitle('nike', english)).toBeNull()
    expect(suggestCategoryFromTitle('adidas', english)).toBeNull()
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

  it('auto-applies a CJK title and a Latin title for zh-CN', async () => {
    await loadLocaleDictionary('zh-CN')
    const chinese = documentsFor('zh-CN')
    expect(suggestCategoryFromTitle('滴滴', chinese)?.id).toBe('taxi')
    expect(suggestCategoryFromTitle('flight', chinese)?.id).toBe('plane')
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
    expect(expandExpenseQuery('a', english).categoryIds).toEqual([])
    expect(expandExpenseQuery('ub', english).categoryIds).toEqual([])
  })
})

describe('meetsCategorySuggestMinQueryLength', () => {
  it('rejects 1–2 letter alphabetic queries', () => {
    expect(meetsCategorySuggestMinQueryLength('a')).toBe(false)
    expect(meetsCategorySuggestMinQueryLength('ai')).toBe(false)
    expect(meetsCategorySuggestMinQueryLength('а')).toBe(false)
  })

  it('accepts 3+ letter queries and CJK titles', () => {
    expect(meetsCategorySuggestMinQueryLength('uber')).toBe(true)
    expect(meetsCategorySuggestMinQueryLength('滴滴')).toBe(true)
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
