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
  suggestCategoryFromTitleForLocale,
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

  it('scores no confident hit for a bare two-letter token', () => {
    // "in" prefix-matches the labels "insurance"/"income" at 0.92 without
    // this; only subsequence noise (below every suggest gate) may remain.
    for (const query of ['in', 'to']) {
      const ranked = rankCategories(query, english)
      expect(ranked.every((hit) => hit.score < 0.7)).toBe(true)
    }
    expect(suggestCategoryFromTitle('Beers in Malt Worm', english)).toBeNull()
    expect(suggestCategoryFromTitle('Lent to Maleka', english)).toBeNull()
  })

  it('still promotes a three-letter token prefix', () => {
    const docs: CategorySearchDocument[] = [
      {
        id: 'dining-out',
        label: 'Dining out',
        grouping: 'Food',
        isParent: false,
        aliases: ['restaurant'],
        samples: [],
        fallbackAliases: [],
      },
    ]
    const hit = rankCategories('res', docs)[0]
    expect(hit?.id).toBe('dining-out')
    expect(hit!.score).toBeGreaterThanOrEqual(0.8)
  })

  it('still matches a two-letter exact alias', () => {
    const docs: CategorySearchDocument[] = [
      {
        id: 'tv-phone-internet',
        label: 'TV',
        grouping: 'Bills',
        isParent: false,
        aliases: ['tv'],
        samples: [],
        fallbackAliases: [],
      },
    ]
    expect(rankCategories('TV', docs)[0]?.id).toBe('tv-phone-internet')
  })
})

describe('suggestCategoryFromTitleForLocale', () => {
  it('uses the locale document cache', () => {
    expect(suggestCategoryFromTitleForLocale('uber', 'en-US')?.id).toBe('taxi')
  })
})

describe('suggestCategoryFromTitle', () => {
  const english = documentsFor('en-US')

  it('auto-applies a confident alias', () => {
    const hit = suggestCategoryFromTitle('uber', english)
    expect(hit).toMatchObject({ id: 'taxi', source: 'dictionary' })
    expect(hit!.score).toBeGreaterThanOrEqual(0.7)
  })

  it('auto-applies a cuisine word as dining-out', () => {
    expect(suggestCategoryFromTitle('pizza', english)?.id).toBe('dining-out')
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

  it('takes the top hit for an ambiguous brand alias', () => {
    expect(suggestCategoryFromTitle('nike', english)).toMatchObject({
      id: 'sports',
      source: 'dictionary',
    })
    expect(suggestCategoryFromTitle('adidas', english)).toMatchObject({
      id: 'sports',
      source: 'dictionary',
    })
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

  it('lets history decide alone when the dictionary stage is disabled', () => {
    const memory: CategoryTitleMemory[] = [
      { title: 'uber', categoryId: 'bus-train' },
    ]
    expect(
      suggestCategoryFromTitle('uber', english, memory, {
        dictionaryEnabled: false,
      }),
    ).toMatchObject({ id: 'bus-train', source: 'history' })
  })

  it('lets the dictionary decide alone when the history stage is disabled', () => {
    const memory: CategoryTitleMemory[] = [
      { title: 'uber', categoryId: 'bus-train' },
      { title: 'uber', categoryId: 'bus-train' },
    ]
    expect(
      suggestCategoryFromTitle('uber', english, memory, {
        historyEnabled: false,
      }),
    ).toMatchObject({ id: 'taxi', source: 'dictionary' })
  })

  it('lets a near-exact dictionary hit veto poisoned exact history', () => {
    // Prod dump: "ICA" filed as income twice, overruling the correct
    // groceries alias on every repeat. A >=0.9 dictionary hit wins back.
    const memory: CategoryTitleMemory[] = [
      { title: 'ICA', categoryId: 'income' },
      { title: 'ICA', categoryId: 'income' },
    ]
    expect(suggestCategoryFromTitle('ICA', english, memory)).toMatchObject({
      id: 'groceries',
      source: 'dictionary',
    })
  })

  it('does not veto history below the 0.9 dictionary bar', () => {
    const docs: CategorySearchDocument[] = [
      {
        id: 'groceries',
        label: 'Veto Marker Word',
        grouping: 'Food',
        isParent: false,
        aliases: [],
        samples: [],
        fallbackAliases: [],
      },
    ]
    const memory: CategoryTitleMemory[] = [
      { title: 'mark', categoryId: 'income' },
      { title: 'mark', categoryId: 'income' },
    ]
    // "mark" prefix-matches at 0.88: history keeps its exact-repeat win.
    expect(suggestCategoryFromTitle('mark', docs, memory)).toMatchObject({
      id: 'income',
      source: 'history',
    })
  })

  it('never lets a settlement dictionary hit veto history', () => {
    const docs: CategorySearchDocument[] = [
      {
        id: 'settlement',
        label: 'Settle Exact Words',
        grouping: 'Settle',
        isParent: false,
        aliases: [],
        samples: [],
        fallbackAliases: [],
      },
    ]
    const memory: CategoryTitleMemory[] = [
      { title: 'Settle Exact Words', categoryId: 'groceries' },
      { title: 'Settle Exact Words', categoryId: 'groceries' },
    ]
    expect(
      suggestCategoryFromTitle('Settle Exact Words', docs, memory),
    ).toMatchObject({ id: 'groceries', source: 'history' })
  })

  it('no longer maps premium alcohol to insurance', () => {
    expect(suggestCategoryFromTitle('Premium lager', english)).toBeNull()
    expect(
      resolveCategorySearchFields('insurance', 'en-US').aliases,
    ).not.toContain('premium')
  })

  it('suggests nothing when both stages are disabled', () => {
    const memory: CategoryTitleMemory[] = [
      { title: 'uber', categoryId: 'bus-train' },
      { title: 'uber', categoryId: 'bus-train' },
    ]
    expect(
      suggestCategoryFromTitle('uber', english, memory, {
        dictionaryEnabled: false,
        historyEnabled: false,
      }),
    ).toBeNull()
  })

  it('honours a raised minimum score', () => {
    const hit = suggestCategoryFromTitle('uber', english)
    expect(hit).not.toBeNull()
    expect(
      suggestCategoryFromTitle('uber', english, [], {
        thresholds: { minScore: 1.1, settlementMinScore: 1.1 },
      }),
    ).toBeNull()
  })

  it('takes the top hit when scores are close instead of rejecting the tie', () => {
    const close: CategorySearchDocument[] = [
      {
        id: 'groceries',
        label: 'Weekly shop',
        grouping: 'Weekly shop',
        isParent: false,
        aliases: [],
        samples: [],
        fallbackAliases: [],
      },
      {
        id: 'dining-out',
        label: 'Weekly shop',
        grouping: 'Weekly shop',
        isParent: false,
        aliases: [],
        samples: [],
        fallbackAliases: [],
      },
    ]
    expect(suggestCategoryFromTitle('weekly shop', close)).toMatchObject({
      id: 'groceries',
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

  it('does not auto-apply weak settlement aliases', () => {
    expect(suggestCategoryFromTitle('payback', english)).toBeNull()
    expect(suggestCategoryFromTitle('settle', english)).toBeNull()
  })

  it('auto-applies near-exact settlement aliases', () => {
    expect(suggestCategoryFromTitle('settlement', english)?.id).toBe(
      'settlement',
    )
  })

  it('does not auto-apply settlement from a single history hit', () => {
    const memory: CategoryTitleMemory[] = [
      { title: 'Paid Alice back', categoryId: 'settlement' },
    ]
    expect(
      suggestCategoryFromTitle('Paid Alice back', english, memory),
    ).toBeNull()
  })

  it('auto-applies settlement from an exact history majority of two', () => {
    const memory: CategoryTitleMemory[] = [
      { title: 'Paid Alice back', categoryId: 'settlement' },
      { title: 'Paid Alice back', categoryId: 'settlement' },
    ]
    expect(
      suggestCategoryFromTitle('Paid Alice back', english, memory),
    ).toMatchObject({ id: 'settlement', source: 'history' })
  })

  it('does not auto-apply settlement from fuzzy history', () => {
    const memory: CategoryTitleMemory[] = [
      { title: 'Paid Alice back Friday', categoryId: 'settlement' },
      { title: 'Paid Alice back Friday', categoryId: 'settlement' },
    ]
    expect(
      suggestCategoryFromTitle('Paid Alice back', english, memory),
    ).toBeNull()
  })

  it('auto-applies a CJK title and a Latin title for zh-CN', async () => {
    await loadLocaleDictionary('zh-CN')
    const chinese = documentsFor('zh-CN')
    expect(suggestCategoryFromTitle('滴滴', chinese)?.id).toBe('taxi')
    expect(suggestCategoryFromTitle('flight', chinese)?.id).toBe('plane')
  })

  it('takes the top hit for airport without treating it as a plane title', () => {
    expect(suggestCategoryFromTitle('airport', english)).toMatchObject({
      id: 'parking',
      source: 'dictionary',
    })
    expect(suggestCategoryFromTitle('airport parking', english)?.id).toBe(
      'parking',
    )
  })

  it('takes the top hit for non-specific aliases above the minimum', async () => {
    await loadLocaleDictionary('it-IT')
    await loadLocaleDictionary('zh-CN')
    expect(suggestCategoryFromTitle('target', english)).toBeNull()
    expect(
      suggestCategoryFromTitle('compagnia', documentsFor('it-IT')),
    ).toBeNull()
    expect(suggestCategoryFromTitle('电', documentsFor('zh-CN'))).toMatchObject(
      {
        id: 'movies',
        source: 'dictionary',
      },
    )
    expect(suggestCategoryFromTitle('电费', documentsFor('zh-CN'))?.id).toBe(
      'electricity',
    )
  })
})

describe('prod dump patterns', () => {
  it('maps dated utility bills and local grocery words for mk-MK', async () => {
    await loadLocaleDictionary('mk-MK')
    const macedonian = documentsFor('mk-MK')
    expect(suggestCategoryFromTitle('EVN 01-02.2024', macedonian)?.id).toBe(
      'electricity',
    )
    expect(suggestCategoryFromTitle('Vodovod 04.2025', macedonian)?.id).toBe(
      'water',
    )
    expect(suggestCategoryFromTitle('Telekom 01.26', macedonian)?.id).toBe(
      'tv-phone-internet',
    )
    expect(suggestCategoryFromTitle('Pazarenje', macedonian)?.id).toBe(
      'groceries',
    )
    expect(suggestCategoryFromTitle('Kirija', macedonian)?.id).toBe('rent')
    expect(suggestCategoryFromTitle('Danok na imot', macedonian)?.id).toBe(
      'taxes',
    )
  })

  it('maps Finnish shop and transfer titles, not the dump mislabels', async () => {
    await loadLocaleDictionary('fi')
    const finnish = documentsFor('fi')
    expect(suggestCategoryFromTitle('Kauppa', finnish)?.id).toBe('groceries')
    expect(suggestCategoryFromTitle('Siirto 11.4', finnish)?.id).toBe('payment')
    expect(suggestCategoryFromTitle('Bensa Austin Shell', finnish)?.id).toBe(
      'gas-fuel',
    )
  })

  it('maps French grocery and fuel words dumped as general', async () => {
    await loadLocaleDictionary('fr-FR')
    const french = documentsFor('fr-FR')
    expect(suggestCategoryFromTitle('Épicerie', french)?.id).toBe('groceries')
    expect(suggestCategoryFromTitle('Essence France', french)?.id).toBe(
      'gas-fuel',
    )
    expect(suggestCategoryFromTitle('Péage aller 1', french)?.id).toBe('tolls')
  })

  it('maps Deutschlandticket to bus/train and mietwagen to car', async () => {
    await loadLocaleDictionary('de-DE')
    const german = documentsFor('de-DE')
    expect(
      suggestCategoryFromTitle('Deutschlandticket – April 2025', german)?.id,
    ).toBe('bus-train')
    expect(suggestCategoryFromTitle('mietwagen', german)?.id).toBe('car')
  })

  it('maps shared operators from the dump to the right child category', () => {
    const english = documentsFor('en-US')
    expect(suggestCategoryFromTitle('Regiojet', english)?.id).toBe('bus-train')
    expect(suggestCategoryFromTitle('HEB', english)?.id).toBe('groceries')
    expect(suggestCategoryFromTitle('Ryanair', english)?.id).toBe('plane')
    expect(suggestCategoryFromTitle('Ouigo', english)?.id).toBe('bus-train')
    expect(suggestCategoryFromTitle('Deutschlandticket', english)?.id).toBe(
      'bus-train',
    )
    expect(suggestCategoryFromTitle('Siirto', english)?.id).toBe('payment')
    expect(suggestCategoryFromTitle('Alipay', english)?.id).toBe('payment')
    expect(suggestCategoryFromTitle('Pingo Doce', english)?.id).toBe(
      'groceries',
    )
    expect(suggestCategoryFromTitle('Conad', english)?.id).toBe('groceries')
    expect(suggestCategoryFromTitle('Decathlon', english)?.id).toBe('sports')
    // Bare "ice cream" ping is now food-and-drink per tightened boundary (cafe/coffee/pizza/ice-cream -> food-and-drink for 2+ word titles; single-word pizza stays dining-out).
    expect(suggestCategoryFromTitle('ice cream', english)?.id).toBe(
      'food-and-drink',
    )
    expect(suggestCategoryFromTitle('Péage', english)?.id).toBe('tolls')
    expect(suggestCategoryFromTitle('bowling', english)?.id).toBe('games')
    expect(suggestCategoryFromTitle('souvenir', english)?.id).toBe('gifts')
    expect(suggestCategoryFromTitle('zipcar', english)?.id).toBe('car')
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
