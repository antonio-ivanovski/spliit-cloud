import {
  categoryIdSchema,
  DEFAULT_CATEGORIES,
  DEFAULT_CATEGORY_ID,
  isSettlementCategory,
  type CategoryId,
} from '../categories'
import { defaultLocale } from '../i18n'
import { dictionaryLocaleFor, onLocaleDictionaryLoaded } from './dictionaries'
import {
  CJK_SCRIPT,
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

/** Near-tie window for expense-list query expansion (keeps both candidates). */
export const CATEGORY_CONFIDENT_SCORE_MARGIN = 0.04

/**
 * Guess-chip floor, derived from the auto-apply gate: runners-up below
 * `minScore - CATEGORY_CANDIDATE_FLOOR_DELTA` are subsequence noise, not
 * suggestions.
 */
export const CATEGORY_CANDIDATE_FLOOR_DELTA = 0.2

/**
 * Near-miss band under the top dictionary hit. A guess further than this below
 * the best hit is a different guess, not an alternative to it.
 */
export const CATEGORY_CANDIDATE_WINDOW = 0.15

/**
 * Tight band for the single "other suggestions" chip next to an applied
 * dictionary hit — the near-tie cases where the runner-up almost won.
 */
export const CATEGORY_CANDIDATE_NEAR_TIE_WINDOW = 0.04

/** Maximum guess chips shown under the expense title. */
export const CATEGORY_CANDIDATE_LIMIT = 3

/**
 * Tunable gates for the title → category suggest flow. The exported constants
 * above stay the defaults (and keep driving expense-list query expansion);
 * deployments override the suggest flow through env vars, surfaced to the web
 * client via `features.get` so both layers stay consistent.
 */
export type CategoryLocalThresholds = {
  minScore: number
  settlementMinScore: number
}

export const DEFAULT_LOCAL_THRESHOLDS: CategoryLocalThresholds = {
  minScore: CATEGORY_CONFIDENT_MIN_SCORE,
  settlementMinScore: SETTLEMENT_CONFIDENT_MIN_SCORE,
}

/**
 * Per-call switches for the suggest flow. Both stages default to enabled so
 * existing callers (CSV import resolution, locale helpers) keep their behavior;
 * the single-expense flow passes the deployment flags instead.
 */
export type SuggestCategoryOptions = {
  dictionaryEnabled?: boolean
  historyEnabled?: boolean
  thresholds?: CategoryLocalThresholds
}

function resolveThresholds(
  thresholds?: CategoryLocalThresholds,
): CategoryLocalThresholds {
  return { ...DEFAULT_LOCAL_THRESHOLDS, ...thresholds }
}

/** Ignore 1–2 character alphabetic keystrokes while the user is still typing. */
export const CATEGORY_SUGGEST_MIN_QUERY_LENGTH = 3

/**
 * Live debounced typing needs more signal than a blur — avoids eager 3–4 char
 * hits.
 */
export const CATEGORY_SUGGEST_LIVE_MIN_QUERY_LENGTH = 5

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

/**
 * Stricter gate for live debounced typing — 5 chars (CJK still exempt). Blur
 * uses the 3-char gate so short titles like `uber` still categorize on exit.
 */
export function meetsCategorySuggestLiveMinQueryLength(query: string): boolean {
  const needle = normalizeSearchText(query)
  if (!needle) return false
  if (CJK_SCRIPT.test(query) || CJK_SCRIPT.test(needle)) return true
  return (
    needle.replaceAll(' ', '').length >= CATEGORY_SUGGEST_LIVE_MIN_QUERY_LENGTH
  )
}

export type CategoryTitleMemory = {
  title: string
  categoryId: string
}

export type CategorySuggestionSource = 'dictionary' | 'history' | 'ai'

/** Sources produced locally without any AI engine. */
export type LocalCategorySuggestionSource = Exclude<
  CategorySuggestionSource,
  'ai'
>

export type CategorySuggestion = {
  id: CategoryId
  score: number
  source: CategorySuggestionSource
}

/** Suggestion from the local dictionary/history stages (never 'ai'). */
export type LocalCategorySuggestion = {
  id: CategoryId
  score: number
  source: LocalCategorySuggestionSource
}

/** AI guess chip: normalized engine probability as the score. */
export type AiCategorySuggestion = {
  id: CategoryId
  score: number
  source: 'ai'
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
  thresholds: CategoryLocalThresholds,
): LocalCategorySuggestion | null {
  if (!meetsCategorySuggestMinQueryLength(title)) return null
  const ranked = rankCategories(title, documents)
  const top = ranked[0]
  const minScore = isSettlementCategory(top?.id)
    ? thresholds.settlementMinScore
    : thresholds.minScore
  if (!top || top.score < minScore) return null
  return { id: top.id, score: top.score, source: 'dictionary' }
}

/**
 * Local title → category. Exact group-history majority beats dictionaries when
 * it has seen the title at least twice, or once with no confident conflicting
 * alias. A single outlier cannot override `uber` → taxi.
 *
 * Either stage can be switched off via `options` (the other stage then decides
 * alone); `thresholds` tunes the dictionary gates without affecting
 * expense-list query expansion, which stays on the module constants.
 */
export function suggestCategoryFromTitle(
  title: string,
  documents: readonly CategorySearchDocument[],
  memory: readonly CategoryTitleMemory[] = [],
  options: SuggestCategoryOptions = {},
): LocalCategorySuggestion | null {
  const thresholds = resolveThresholds(options.thresholds)
  const dictHit =
    options.dictionaryEnabled === false
      ? null
      : dictionarySuggestion(title, documents, thresholds)
  const historyHit =
    options.historyEnabled === false ? null : matchHistory(title, memory)
  const historyId = historyHit ? asCategoryId(historyHit.categoryId) : null

  if (historyHit?.kind === 'exact' && historyId) {
    // A near-exact dictionary hit vetoes history: a past mislabel repeated
    // twice (e.g. "ICA" filed as income) would otherwise overrule a correct
    // brand/alias match forever. Settlement never vetoes — a wrong settlement
    // corrupts balances, so history keeps its say there.
    if (dictHit && dictHit.score >= 0.9 && dictHit.id !== historyId) {
      if (!isSettlementCategory(dictHit.id)) return dictHit
    }
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

export type SuggestCategoryRunnersUpOptions = {
  thresholds?: CategoryLocalThresholds
  /** Applied category — neither it nor its family is a guess. */
  excludeIds?: readonly CategoryId[]
  limit?: number
}

const categoryParentById = new Map(
  DEFAULT_CATEGORIES.map((category) => [category.id, category.parentId]),
)

function isCategoryRelated(left: CategoryId, right: CategoryId): boolean {
  if (left === right) return true
  let ancestor = categoryParentById.get(left) ?? null
  while (ancestor !== null) {
    if (ancestor === right) return true
    ancestor = categoryParentById.get(ancestor) ?? null
  }
  ancestor = categoryParentById.get(right) ?? null
  while (ancestor !== null) {
    if (ancestor === left) return true
    ancestor = categoryParentById.get(ancestor) ?? null
  }
  return false
}

/**
 * Below-gate dictionary guesses for the "other suggestions" chips. Reuses the
 * same ranking as the auto-apply stage: runners-up within
 * CATEGORY_CANDIDATE_WINDOW of the top hit and above `minScore -
 * CATEGORY_CANDIDATE_FLOOR_DELTA`. Settlement and general are never guesses (a
 * one-tap path must not silently exclude spend, and general is already the
 * default), and a kept candidate suppresses its ancestors/descendants so "Food"
 * never sits next to "Restaurants".
 */
export function suggestCategoryRunnersUp(
  title: string,
  documents: readonly CategorySearchDocument[],
  options: SuggestCategoryRunnersUpOptions = {},
): LocalCategorySuggestion[] {
  if (!meetsCategorySuggestMinQueryLength(title)) return []
  const thresholds = resolveThresholds(options.thresholds)
  const ranked = rankCategories(title, documents)
  const topScore = ranked[0]?.score
  if (topScore === undefined) return []
  const floor = thresholds.minScore - CATEGORY_CANDIDATE_FLOOR_DELTA
  const excluded = options.excludeIds ?? []
  const limit = options.limit ?? CATEGORY_CANDIDATE_LIMIT
  const runnersUp: LocalCategorySuggestion[] = []
  for (const hit of ranked) {
    if (runnersUp.length >= limit) break
    // Ranked descending, so both gates below are terminal.
    if (hit.score < floor) break
    if (topScore - hit.score > CATEGORY_CANDIDATE_WINDOW) break
    if (hit.id === DEFAULT_CATEGORY_ID || isSettlementCategory(hit.id)) {
      continue
    }
    if (excluded.some((id) => isCategoryRelated(id, hit.id))) continue
    if (runnersUp.some((kept) => isCategoryRelated(kept.id, hit.id))) continue
    runnersUp.push({ id: hit.id, score: hit.score, source: 'dictionary' })
  }
  return runnersUp
}

/** Minimum normalized probability for an AI guess to become a chip. */
export const AI_CANDIDATE_MIN_PROBABILITY = 0.15
/** Maximum AI guess chips. */
export const AI_CANDIDATE_LIMIT = 3
/**
 * Minimum raw LLM confidence to enter normalization. Independent LLM
 * confidences are rescaled to sum to 1, so crumbs must be dropped first or they
 * inflate into fake splits.
 */
export const AI_CANDIDATE_RAW_MIN_CONFIDENCE = 0.2

export type AiCategoryDistribution = { id: string; probability: number }

/**
 * AI guesses for the "other suggestions" chips, from a normalized (sums to ~1)
 * engine distribution — System One probabilities directly, LLM confidences
 * after {@link normalizeAiConfidences}. Keeps entries above
 * AI_CANDIDATE_MIN_PROBABILITY, strongest first, capped at AI_CANDIDATE_LIMIT.
 * The applied winner passes via `excludeIds` (hit path); on a miss path pass no
 * exclusions so the top pick itself becomes a chip. General and settlement are
 * never guesses.
 */
export function suggestAiCandidates(
  distribution: readonly AiCategoryDistribution[],
  excludeIds: readonly string[] = [],
): AiCategorySuggestion[] {
  const excluded = new Set(excludeIds)
  return distribution
    .map(({ id, probability }) => ({ id: asCategoryId(id), probability }))
    .filter(
      (entry): entry is { id: CategoryId; probability: number } =>
        entry.id !== null &&
        Number.isFinite(entry.probability) &&
        entry.probability >= AI_CANDIDATE_MIN_PROBABILITY &&
        !excluded.has(entry.id) &&
        entry.id !== DEFAULT_CATEGORY_ID &&
        !isSettlementCategory(entry.id),
    )
    .sort((left, right) => right.probability - left.probability)
    .slice(0, AI_CANDIDATE_LIMIT)
    .map(({ id, probability }) => ({
      id,
      score: probability,
      source: 'ai' as const,
    }))
}

/**
 * Rescales independent LLM confidences (each 0–1, need not sum to anything)
 * into a Jev-style distribution summing to 1. Entries below
 * AI_CANDIDATE_RAW_MIN_CONFIDENCE are dropped first; an empty or all-zero input
 * yields no distribution.
 */
export function normalizeAiConfidences(
  entries: readonly { id: string; confidence: number }[],
): AiCategoryDistribution[] {
  const kept = entries.filter(
    ({ confidence }) =>
      Number.isFinite(confidence) &&
      confidence >= AI_CANDIDATE_RAW_MIN_CONFIDENCE,
  )
  const total = kept.reduce((sum, { confidence }) => sum + confidence, 0)
  if (total <= 0) return []
  return kept.map(({ id, confidence }) => ({
    id,
    probability: confidence / total,
  }))
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

/** Dictionary + history suggest using the shipped locale document cache. */
export function suggestCategoryFromTitleForLocale(
  title: string,
  locale: string = defaultLocale,
  memory: readonly CategoryTitleMemory[] = [],
  options: SuggestCategoryOptions = {},
): LocalCategorySuggestion | null {
  return suggestCategoryFromTitle(
    title,
    documentsForLocale(locale),
    memory,
    options,
  )
}
