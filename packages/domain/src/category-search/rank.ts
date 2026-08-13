import {
  DEFAULT_CATEGORIES,
  type Category,
  type CategoryId,
} from '../categories'
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

  const results: RankedCategory[] = []
  for (const document of documents) {
    const score = scoreDocument(needle, document)
    if (score < MIN_SCORE) continue
    results.push({ id: document.id, score, isParent: document.isParent })
  }

  results.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score
    if (left.isParent !== right.isParent) return left.isParent ? 1 : -1
    return 0
  })
  return results
}

function scoreDocument(
  needle: string,
  document: CategorySearchDocument,
): number {
  const phrase = bestFieldScore(needle, document)
  const tokens = needle.split(' ')
  if (tokens.length === 1) return phrase

  let tokenTotal = 0
  for (const token of tokens) {
    const tokenScore = bestFieldScore(token, document)
    if (tokenScore === 0) return phrase
    tokenTotal += tokenScore
  }
  return Math.max(phrase, tokenTotal / tokens.length)
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

function scoreText(needle: string, haystack: string): number {
  if (!needle || !haystack) return 0
  if (haystack === needle) return 1
  if (haystack.startsWith(needle)) return 0.92

  const words = haystack.split(' ')
  if (words.some((word) => word.startsWith(needle))) return 0.88
  if (haystack.includes(needle)) return 0.8

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

  const previous = Array.from({ length: rightLength + 1 }, (_, index) => index)
  const current = Array.from({ length: rightLength + 1 }, () => 0)
  const beforePrevious = Array.from({ length: rightLength + 1 }, () => 0)

  for (let i = 1; i <= leftLength; i += 1) {
    current[0] = i
    let rowMin = current[0]!
    for (let j = 1; j <= rightLength; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1
      const insertion = current[j - 1]! + 1
      const deletion = previous[j]! + 1
      const substitution = previous[j - 1]! + cost
      let value = Math.min(insertion, deletion, substitution)
      if (
        i > 1 &&
        j > 1 &&
        left[i - 1] === right[j - 2] &&
        left[i - 2] === right[j - 1]
      ) {
        value = Math.min(value, beforePrevious[j - 2]! + 1)
      }
      current[j] = value
      rowMin = Math.min(rowMin, value)
    }
    if (rowMin > max) return max + 1
    for (let j = 0; j <= rightLength; j += 1) {
      beforePrevious[j] = previous[j]!
      previous[j] = current[j]!
    }
  }
  return previous[rightLength]!
}
