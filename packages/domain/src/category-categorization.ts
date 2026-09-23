import {
  DEFAULT_CATEGORY_ID,
  SETTLEMENT_CATEGORY_ID,
  categoryIdSchema,
  type CategoryId,
} from './categories'
import {
  categoryConfidenceBand,
  type CategoryConfidenceBand,
} from './category-confidence'
import {
  normalizeSearchText,
  type CategorySearchDocument,
} from './category-search/rank'
import {
  CATEGORY_CANDIDATE_LIMIT,
  DEFAULT_LOCAL_THRESHOLDS,
  suggestCategoryFromTitle,
  suggestCategoryRunnersUp,
  type CategoryTitleMemory,
  type SuggestCategoryOptions,
} from './category-search/suggest'

export type CategorizerEngine = 'local' | 'system-one' | 'llm'
export type CategoryEvidence =
  | { kind: 'heuristic'; value: number; floor: number }
  | { kind: 'model-confidence'; value: number; floor: number }
  | { kind: 'option-probability'; value: number }
  | { kind: 'self-reported-confidence'; value: number; floor: number }

export type CategorizerChoice = {
  categoryId: CategoryId
  source: 'dictionary' | 'history' | 'system-one' | 'llm'
  evidence: CategoryEvidence
}

/** An abstention has no selected category; alternatives remain reviewable. */
export type CategorizerResult = {
  engine: CategorizerEngine
  categoryId: CategoryId | null
  primary: CategorizerChoice | null
  alternatives: CategorizerChoice[]
}

export type CategorizerFeedback = {
  positive?: readonly { title: string; categoryId: CategoryId }[]
  rejected?: readonly { title: string; rejectedCategoryId: CategoryId }[]
}

export function validSuggestedCategory(id: string | null | undefined) {
  if (!id) return null
  const parsed = categoryIdSchema.safeParse(id)
  return parsed.success &&
    parsed.data !== DEFAULT_CATEGORY_ID &&
    parsed.data !== SETTLEMENT_CATEGORY_ID
    ? parsed.data
    : null
}

function validChoice(choice: CategorizerChoice | null) {
  if (!choice || !validSuggestedCategory(choice.categoryId)) return false
  const { value } = choice.evidence
  return Number.isFinite(value) && value >= 0 && value <= 1
}

/** Only the primary verdict can be automatically selected. */
export function interpretCategorizerResult(
  engine: CategorizerEngine,
  primary: CategorizerChoice | null,
  alternatives: readonly CategorizerChoice[] = [],
): CategorizerResult {
  const usablePrimary = validChoice(primary) ? primary : null
  const seen = new Set<string>(usablePrimary ? [usablePrimary.categoryId] : [])
  const usableAlternatives = [...alternatives]
    .sort((left, right) => right.evidence.value - left.evidence.value)
    .filter((choice) => {
      if (!validChoice(choice) || seen.has(choice.categoryId)) return false
      seen.add(choice.categoryId)
      return true
    })
  const accepted =
    usablePrimary &&
    'floor' in usablePrimary.evidence &&
    usablePrimary.evidence.value >= usablePrimary.evidence.floor
  return {
    engine,
    categoryId: accepted ? usablePrimary.categoryId : null,
    primary: usablePrimary,
    alternatives: usableAlternatives,
  }
}

export function categorizerChoiceBand(
  choice: CategorizerChoice,
): CategoryConfidenceBand {
  return 'floor' in choice.evidence
    ? categoryConfidenceBand(choice.evidence.value, choice.evidence.floor)
    : 'none'
}

/** Pure Local adapter shared by the browser, API, and CSV import worker. */
export function categorizeLocally(args: {
  title: string
  documents: readonly CategorySearchDocument[]
  memory?: readonly CategoryTitleMemory[]
  options?: SuggestCategoryOptions
  feedback?: CategorizerFeedback
  alternativeLimit?: number
}): CategorizerResult {
  const { title, documents, options = {}, feedback } = args
  const key = normalizeSearchText(title)
  const rejected = new Set(
    feedback?.rejected
      ?.filter((row) => normalizeSearchText(row.title) === key)
      .map((row) => row.rejectedCategoryId) ?? [],
  )
  const positive = new Set(
    (options.historyEnabled === false ? [] : feedback?.positive)
      ?.filter((row) => normalizeSearchText(row.title) === key)
      .map((row) => row.categoryId)
      .filter((id) => validSuggestedCategory(id) && !rejected.has(id)) ?? [],
  )
  const thresholds = options.thresholds
  const historyFloor = 0.75
  const reviewedId = positive.size === 1 ? [...positive][0] : null
  const memory = [
    ...(options.historyEnabled === false ? [] : (feedback?.positive ?? [])),
    ...(args.memory ?? []),
  ]
  let hit = reviewedId
    ? { id: reviewedId!, score: 1, source: 'history' as const }
    : suggestCategoryFromTitle(title, documents, memory, options)
  if (hit && rejected.has(hit.id) && !reviewedId) {
    hit = suggestCategoryFromTitle(title, documents, memory, {
      ...options,
      dictionaryEnabled:
        hit.source === 'dictionary' ? false : options.dictionaryEnabled,
      historyEnabled: hit.source === 'history' ? false : options.historyEnabled,
    })
  }
  const primary =
    hit && !rejected.has(hit.id) && validSuggestedCategory(hit.id)
      ? {
          categoryId: hit.id,
          source: hit.source,
          evidence: {
            kind: 'heuristic' as const,
            value: hit.score,
            floor:
              hit.source === 'history'
                ? historyFloor
                : (thresholds?.minScore ?? DEFAULT_LOCAL_THRESHOLDS.minScore),
          },
        }
      : null
  const alternatives =
    options.dictionaryEnabled === false || args.alternativeLimit === 0
      ? []
      : suggestCategoryRunnersUp(title, documents, {
          thresholds,
          excludeIds: primary ? [primary.categoryId] : [],
          limit: args.alternativeLimit ?? CATEGORY_CANDIDATE_LIMIT,
        })
          .filter((row) => !rejected.has(row.id))
          .map((row) => ({
            categoryId: row.id,
            source: row.source,
            evidence: {
              kind: 'heuristic' as const,
              value: row.score,
              floor: thresholds?.minScore ?? DEFAULT_LOCAL_THRESHOLDS.minScore,
            },
          }))
  return interpretCategorizerResult('local', primary, alternatives)
}
