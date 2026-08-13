import {
  categoryIdSchema,
  isSettlementCategory,
  type CategoryId,
} from '../categories'
import { defaultLocale } from '../i18n'
import { dictionaryLocaleFor, onLocaleDictionaryLoaded } from './dictionaries'
import {
  createCategorySearchDocumentsForLocale,
  damerauLevenshtein,
  normalizeSearchText,
  rankCategories,
  type CategorySearchDocument,
} from './rank'

/**
 * Minimum score to auto-apply a category or expand an expense-list query. Above
 * picker MIN_SCORE (0.32) so subsequence noise never auto-categorizes or floods
 * the list. Covers exact/prefix/alias and edit-distance 1.
 */
export const CATEGORY_CONFIDENT_MIN_SCORE = 0.7

/**
 * Settlement changes accounting, so dictionary auto-apply needs a near-exact
 * hit. Weak aliases like "payback" must not silently exclude spend.
 */
export const SETTLEMENT_CONFIDENT_MIN_SCORE = 0.95

/**
 * Treat scores this close as a tie (auto-apply rejects; list search keeps
 * both).
 */
export const CATEGORY_CONFIDENT_SCORE_MARGIN = 0.04

/** Ignore 1–2 character alphabetic keystrokes while the user is still typing. */
export const CATEGORY_SUGGEST_MIN_QUERY_LENGTH = 3

const CJK_SCRIPT =
  /[\u3000-\u303f\u3040-\u309f\u30a0-\u30ff\u3400-\u9fff\uf900-\ufaff\uff66-\uff9f\uac00-\ud7af]/u

/**
 * Auto-apply / query-expand gate. Alphabetic scripts need 3 characters so `"a"`
 * does not match `airport` → plane. Han/Kana/Hangul titles can be a complete
 * word in one character (`滴滴`).
 */
export function meetsCategorySuggestMinQueryLength(query: string): boolean {
  const needle = normalizeSearchText(query)
  if (!needle) return false
  if (CJK_SCRIPT.test(query) || CJK_SCRIPT.test(needle)) return true
  return needle.replaceAll(' ', '').length >= CATEGORY_SUGGEST_MIN_QUERY_LENGTH
}

export type CategoryTitleMemory = {
  title: string
  categoryId: string
}

export type CategorySuggestionSource = 'dictionary' | 'history'

export type CategorySuggestion = {
  id: CategoryId
  score: number
  source: CategorySuggestionSource
}

export type ExpandedExpenseQuery = {
  categoryIds: CategoryId[]
}

function asCategoryId(value: string): CategoryId | null {
  const parsed = categoryIdSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

function majorityCategory(
  counts: Map<string, number>,
): { categoryId: string; count: number } | null {
  let best: { categoryId: string; count: number } | null = null
  let tied = false
  for (const [categoryId, count] of counts) {
    if (!best || count > best.count) {
      best = { categoryId, count }
      tied = false
    } else if (count === best.count) {
      tied = true
    }
  }
  if (!best || tied) return null
  return best
}

function matchHistory(
  title: string,
  memory: readonly CategoryTitleMemory[],
): { categoryId: string; count: number; kind: 'exact' | 'fuzzy' } | null {
  const needle = normalizeSearchText(title)
  if (!needle) return null

  const exactCounts = new Map<string, number>()
  const fuzzyCounts = new Map<string, number>()

  for (const row of memory) {
    const haystack = normalizeSearchText(row.title)
    if (!haystack) continue
    if (haystack === needle) {
      exactCounts.set(
        row.categoryId,
        (exactCounts.get(row.categoryId) ?? 0) + 1,
      )
      continue
    }
    if (
      meetsCategorySuggestMinQueryLength(title) &&
      damerauLevenshtein(needle, haystack, 1) <= 1
    ) {
      fuzzyCounts.set(
        row.categoryId,
        (fuzzyCounts.get(row.categoryId) ?? 0) + 1,
      )
    }
  }

  const exact = majorityCategory(exactCounts)
  if (exact) return { ...exact, kind: 'exact' }
  const fuzzy = majorityCategory(fuzzyCounts)
  if (fuzzy && fuzzy.count >= 2) return { ...fuzzy, kind: 'fuzzy' }
  return null
}

function dictionarySuggestion(
  title: string,
  documents: readonly CategorySearchDocument[],
): CategorySuggestion | null {
  if (!meetsCategorySuggestMinQueryLength(title)) return null
  const ranked = rankCategories(title, documents)
  const top = ranked[0]
  const minScore = isSettlementCategory(top?.id)
    ? SETTLEMENT_CONFIDENT_MIN_SCORE
    : CATEGORY_CONFIDENT_MIN_SCORE
  if (!top || top.score < minScore) return null
  const runnerUp = ranked[1]
  if (
    runnerUp &&
    top.score - runnerUp.score <= CATEGORY_CONFIDENT_SCORE_MARGIN
  ) {
    return null
  }
  return { id: top.id, score: top.score, source: 'dictionary' }
}

/**
 * Local title → category. Exact group-history majority beats dictionaries when
 * it has seen the title at least twice, or once with no confident conflicting
 * alias. A single outlier cannot override `uber` → taxi.
 */
export function suggestCategoryFromTitle(
  title: string,
  documents: readonly CategorySearchDocument[],
  memory: readonly CategoryTitleMemory[] = [],
): CategorySuggestion | null {
  const dictHit = dictionarySuggestion(title, documents)
  const historyHit = matchHistory(title, memory)
  const historyId = historyHit ? asCategoryId(historyHit.categoryId) : null

  if (historyHit?.kind === 'exact' && historyId) {
    if (historyHit.count >= 2) {
      return { id: historyId, score: 1, source: 'history' }
    }
    if (!isSettlementCategory(historyId)) {
      if (!dictHit || dictHit.id === historyId) {
        return { id: historyId, score: 0.85, source: 'history' }
      }
      return dictHit
    }
  }

  if (dictHit) return dictHit

  if (
    historyHit?.kind === 'fuzzy' &&
    historyId &&
    !isSettlementCategory(historyId)
  ) {
    return { id: historyId, score: 0.75, source: 'history' }
  }

  return null
}

/** High-confidence category IDs to OR into an expense-list text search. */
export function expandExpenseQuery(
  query: string,
  documents: readonly CategorySearchDocument[],
): ExpandedExpenseQuery {
  if (!meetsCategorySuggestMinQueryLength(query)) {
    return { categoryIds: [] }
  }
  const ranked = rankCategories(query, documents).filter((hit) => {
    const minScore = isSettlementCategory(hit.id)
      ? SETTLEMENT_CONFIDENT_MIN_SCORE
      : CATEGORY_CONFIDENT_MIN_SCORE
    return hit.score >= minScore
  })
  const topScore = ranked[0]?.score
  if (topScore === undefined) return { categoryIds: [] }
  const categoryIds = ranked
    .filter((hit) => topScore - hit.score <= CATEGORY_CONFIDENT_SCORE_MARGIN)
    .map((hit) => hit.id)
  return { categoryIds }
}

const documentsByLocale = new Map<string, CategorySearchDocument[]>()

onLocaleDictionaryLoaded(() => {
  documentsByLocale.clear()
})

function documentsForLocale(locale: string): CategorySearchDocument[] {
  const key = dictionaryLocaleFor(locale)
  const cached = documentsByLocale.get(key)
  if (cached) return cached
  const documents = createCategorySearchDocumentsForLocale(key)
  documentsByLocale.set(key, documents)
  return documents
}

export function expandExpenseQueryForLocale(
  query: string,
  locale: string = defaultLocale,
): ExpandedExpenseQuery {
  return expandExpenseQuery(query, documentsForLocale(locale))
}
