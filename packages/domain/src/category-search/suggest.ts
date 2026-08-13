import { categoryIdSchema, type CategoryId } from '../categories'
import { defaultLocale } from '../i18n'
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

/** Ignore 1–2 character keystrokes while the user is still typing. */
export const CATEGORY_SUGGEST_MIN_QUERY_LENGTH = 3

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
      needle.length >= CATEGORY_SUGGEST_MIN_QUERY_LENGTH &&
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
  const needle = normalizeSearchText(title)
  if (needle.length < CATEGORY_SUGGEST_MIN_QUERY_LENGTH) return null
  const top = rankCategories(title, documents)[0]
  if (!top || top.score < CATEGORY_CONFIDENT_MIN_SCORE) return null
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
    if (!dictHit || dictHit.id === historyId) {
      return { id: historyId, score: 0.85, source: 'history' }
    }
    return dictHit
  }

  if (dictHit) return dictHit

  if (historyHit?.kind === 'fuzzy' && historyId) {
    return { id: historyId, score: 0.75, source: 'history' }
  }

  return null
}

/** High-confidence category IDs to OR into an expense-list text search. */
export function expandExpenseQuery(
  query: string,
  documents: readonly CategorySearchDocument[],
): ExpandedExpenseQuery {
  const needle = normalizeSearchText(query)
  if (needle.length < CATEGORY_SUGGEST_MIN_QUERY_LENGTH) {
    return { categoryIds: [] }
  }
  const ranked = rankCategories(query, documents).filter(
    (hit) => hit.score >= CATEGORY_CONFIDENT_MIN_SCORE,
  )
  const topScore = ranked[0]?.score
  if (topScore === undefined) return { categoryIds: [] }
  const categoryIds = ranked
    .filter((hit) => topScore - hit.score <= 0.04)
    .map((hit) => hit.id)
  return { categoryIds }
}

export function expandExpenseQueryForLocale(
  query: string,
  locale: string = defaultLocale,
): ExpandedExpenseQuery {
  return expandExpenseQuery(
    query,
    createCategorySearchDocumentsForLocale(locale),
  )
}
