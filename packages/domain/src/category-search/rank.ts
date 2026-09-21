import {
  DEFAULT_CATEGORIES,
  type Category,
  type CategoryId,
} from '../categories'
import { calibrateRankedCategories } from './calibration'
import {
  resolveCategorySearchFields,
  tokenizeSearchText,
  type LocaleDictionary,
} from './dictionaries'

const LABEL_WEIGHT = 1
const ALIAS_WEIGHT = 0.92
const SAMPLE_WEIGHT = 0.78
const GROUPING_WEIGHT = 0.55
const SLUG_WEIGHT = 0.5
const FALLBACK_ALIAS_WEIGHT = 0.42

/** Han/Kana/Hangul characters can be a complete word in one character (`滴滴`). */
export const CJK_SCRIPT =
  /[\u3000-\u303f\u3040-\u309f\u30a0-\u30ff\u3400-\u9fff\uf900-\ufaff\uff66-\uff9f\uac00-\ud7af]/u

/** Drop hits weaker than this so subsequence noise stays out of the picker. */
const MIN_SCORE = 0.32

export type NormalizedCategorySearchFields = {
  label: string
  grouping: string
  id: string
  aliases: readonly string[]
  samples: readonly string[]
  fallbackAliases: readonly string[]
}

export type CategorySearchDocument = {
  id: CategoryId
  label: string
  grouping: string
  isParent: boolean
  aliases: readonly string[]
  samples: readonly string[]
  fallbackAliases: readonly string[]
  /** Precomputed by `createCategorySearchDocument`; optional for test literals. */
  normalized?: NormalizedCategorySearchFields
}

export type RankedCategory = {
  id: CategoryId
  score: number
  isParent: boolean
}

export function normalizeSearchText(value: string): string {
  return tokenizeSearchText(value).join(' ')
}

export function createCategorySearchDocument(
  category: Category,
  options: {
    label: string
    grouping: string
    locale: string
    localeDictionary?: LocaleDictionary
  },
): CategorySearchDocument {
  const fields = resolveCategorySearchFields(
    category.id,
    options.locale,
    options.localeDictionary,
  )
  const document = {
    id: category.id,
    label: options.label,
    grouping: options.grouping,
    isParent: category.parentId === null,
    aliases: fields.aliases,
    samples: fields.samples,
    fallbackAliases: fields.fallbackAliases,
  }
  return { ...document, normalized: computeNormalizedFields(document) }
}

/**
 * English in-code names plus locale dictionaries — used when i18n labels are
 * unavailable (API).
 */
export function createCategorySearchDocumentsForLocale(
  locale: string,
): CategorySearchDocument[] {
  return DEFAULT_CATEGORIES.map((category) =>
    createCategorySearchDocument(category, {
      label: category.parentId === null ? category.grouping : category.name,
      grouping: category.grouping,
      locale,
    }),
  )
}

export function rankCategories(
  query: string,
  documents: readonly CategorySearchDocument[],
): RankedCategory[] {
  const needle = normalizeSearchText(query)
  if (!needle) return []

  // Tokenize once per query: `scoreDocument` runs per category (50+ docs), so
  // splitting the needle inside it repeats the same work for every document.
  // Skip dates/amounts so "EVN 01-02.2024" still hits the EVN alias.
  const tokens = needle
    .split(' ')
    .filter((token) => token.length >= 2 && !/^\d+$/.test(token))

  const results: RankedCategory[] = []
  for (const document of documents) {
    const score = scoreDocument(needle, tokens, document)
    if (score < MIN_SCORE) continue
    results.push({ id: document.id, score, isParent: document.isParent })
  }

  const calibrated = calibrateRankedCategories({ needle, ranked: results })
  calibrated.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score
    if (left.isParent !== right.isParent) return left.isParent ? 1 : -1
    return 0
  })
  return calibrated
}

function scoreDocument(
  needle: string,
  tokens: string[],
  document: CategorySearchDocument,
): number {
  const phrase = bestFieldScore(needle, document)
  if (tokens.length === 0) return phrase

  let matchedTotal = 0
  let matchedCount = 0
  let bestToken = 0
  for (const token of tokens) {
    // A single-token query scores the same string twice (phrase and token);
    // reuse the phrase score instead of rescoring every field.
    const tokenScore =
      tokens.length === 1 && token === needle
        ? phrase
        : bestFieldScore(token, document)
    bestToken = Math.max(bestToken, tokenScore)
    if (tokenScore === 0) continue
    matchedCount += 1
    matchedTotal += tokenScore
  }

  let score = phrase
  if (matchedCount === tokens.length) {
    score = Math.max(score, matchedTotal / tokens.length)
  } else if (tokens.length === 1) {
    score = Math.max(score, bestToken)
  }
  // A full alias/label token in a longer title ("Deutschlandticket – April").
  if (bestToken >= ALIAS_WEIGHT) {
    score = Math.max(score, bestToken)
  }
  return score
}

function computeNormalizedFields(
  document: Omit<CategorySearchDocument, 'normalized'>,
): NormalizedCategorySearchFields {
  return {
    label: normalizeSearchText(document.label),
    grouping: normalizeSearchText(document.grouping),
    id: normalizeSearchText(document.id),
    aliases: document.aliases.map(normalizeSearchText),
    samples: document.samples.map(normalizeSearchText),
    fallbackAliases: document.fallbackAliases.map(normalizeSearchText),
  }
}

function normalizedFields(
  document: CategorySearchDocument,
): NormalizedCategorySearchFields {
  return document.normalized ?? computeNormalizedFields(document)
}

function bestFieldScore(
  needle: string,
  document: CategorySearchDocument,
): number {
  const normalized = normalizedFields(document)
  let best = 0
  best = Math.max(best, scoreText(needle, normalized.label) * LABEL_WEIGHT)
  best = Math.max(
    best,
    scoreText(needle, normalized.grouping) * GROUPING_WEIGHT,
  )
  best = Math.max(best, scoreText(needle, normalized.id) * SLUG_WEIGHT)
  for (const alias of normalized.aliases) {
    best = Math.max(best, scoreText(needle, alias) * ALIAS_WEIGHT)
  }
  for (const sample of normalized.samples) {
    best = Math.max(best, scoreText(needle, sample) * SAMPLE_WEIGHT)
  }
  for (const alias of normalized.fallbackAliases) {
    best = Math.max(best, scoreText(needle, alias) * FALLBACK_ALIAS_WEIGHT)
  }
  return best
}

/**
 * Haystack word splits are static per dictionary (a few hundred distinct
 * aliases/samples) but `scoreText` runs millions of times during bulk import
 * categorization. Cache the split so repeated queries don't reallocate.
 */
const haystackWordsCache = new Map<string, string[]>()
/**
 * Bound the split cache: dictionaries are finite, but callers may rank ad-hoc
 * documents.
 */
const MAX_HAYSTACK_WORDS_ENTRIES = 10_000

function haystackWords(haystack: string): string[] {
  const cached = haystackWordsCache.get(haystack)
  if (cached) return cached
  const words = haystack.split(' ')
  if (haystackWordsCache.size >= MAX_HAYSTACK_WORDS_ENTRIES) {
    const oldest = haystackWordsCache.keys().next()
    if (!oldest.done) haystackWordsCache.delete(oldest.value)
  }
  haystackWordsCache.set(haystack, words)
  return words
}

function scoreText(needle: string, haystack: string): number {
  if (!needle || !haystack) return 0
  if (haystack === needle) return 1
  // Prefix/substring matches on 1–2 character needles are noise: the tokens
  // "in" and "to" prefix-match the labels "insurance"/"income" and the alias
  // "toll" at 0.92, so any "... in ..." title misfires at high confidence.
  // Exact matches (TV, EVN) still score above. Han/Kana/Hangul needles are
  // exempt: one CJK character can be a complete word, matching the
  // min-query-length exemption in suggest.ts.
  const words = haystackWords(haystack)
  const cjk = CJK_SCRIPT.test(needle)
  if (cjk || needle.length >= 3) {
    if (haystack.startsWith(needle)) return 0.92
    if (words.some((word) => word.startsWith(needle))) return 0.88
    if (needle.length >= 4 && haystack.includes(needle)) return 0.8
  }

  const fullDistance = damerauLevenshtein(needle, haystack, 2)
  if (fullDistance === 1) return 0.72
  if (fullDistance === 2 && needle.length >= 5) return 0.5

  let bestTypo = 0
  for (const word of words) {
    const distance = damerauLevenshtein(needle, word, 2)
    if (distance === 1 && needle.length >= 3) {
      bestTypo = Math.max(bestTypo, 0.7)
    } else if (distance === 2 && needle.length >= 5) {
      bestTypo = Math.max(bestTypo, 0.48)
    }
  }
  if (bestTypo > 0) return bestTypo

  if (isSubsequence(needle, haystack)) return 0.35
  return 0
}

function isSubsequence(needle: string, haystack: string): boolean {
  // A longer needle can never be a subsequence of a shorter haystack; skip
  // the scan (common for "Merchant 5000"-style titles vs short aliases).
  if (needle.length > haystack.length) return false
  let index = 0
  for (const character of haystack) {
    if (character === needle[index]) index += 1
    if (index === needle.length) return true
  }
  return false
}

/**
 * Damerau-Levenshtein distance with an early exit when the distance would
 * exceed `max`. Returns `max + 1` when the strings are farther apart.
 */
export function damerauLevenshtein(
  left: string,
  right: string,
  max: number,
): number {
  if (left === right) return 0
  const leftLength = left.length
  const rightLength = right.length
  if (Math.abs(leftLength - rightLength) > max) return max + 1

  // Index-filled rows (no per-element callbacks) plus row rotation instead
  // of an O(n) copy per row: same distances, far less overhead. This runs
  // millions of times during bulk import categorization.
  const previous: number[] = []
  const current: number[] = []
  const beforePrevious: number[] = []
  for (let j = 0; j <= rightLength; j += 1) {
    previous[j] = j
    current[j] = 0
    beforePrevious[j] = 0
  }
  let previousRow = previous
  let currentRow = current
  let beforePreviousRow = beforePrevious

  for (let i = 1; i <= leftLength; i += 1) {
    currentRow[0] = i
    let rowMin = currentRow[0]!
    const leftChar = left[i - 1]
    const leftPrevChar = i > 1 ? left[i - 2] : ''
    for (let j = 1; j <= rightLength; j += 1) {
      const cost = leftChar === right[j - 1] ? 0 : 1
      const insertion = currentRow[j - 1]! + 1
      const deletion = previousRow[j]! + 1
      const substitution = previousRow[j - 1]! + cost
      let value = Math.min(insertion, deletion, substitution)
      if (
        i > 1 &&
        j > 1 &&
        leftChar === right[j - 2] &&
        leftPrevChar === right[j - 1]
      ) {
        value = Math.min(value, beforePreviousRow[j - 2]! + 1)
      }
      currentRow[j] = value
      if (value < rowMin) rowMin = value
    }
    if (rowMin > max) return max + 1
    const temp = beforePreviousRow
    beforePreviousRow = previousRow
    previousRow = currentRow
    currentRow = temp
  }
  return previousRow[rightLength]!
}
