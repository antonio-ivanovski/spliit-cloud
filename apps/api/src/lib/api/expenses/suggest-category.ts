import {
  createCategorySearchDocumentsForLocale,
  loadLocaleDictionary,
  meetsCategorySuggestMinQueryLength,
  rankCategories,
  suggestAiCandidates,
  suggestCategoryFromTitleForLocale,
  type AiCategoryDistribution,
  type AiCategorySuggestion,
  type CategoryId,
  type CategorySuggestion,
  type SuggestCategoryOptions,
} from '@spliit/domain'

import { getRecentExpenseContext } from '../../ai/context'
import { suggestCategoryWithSystemOne } from '../../ai/system-one-categorize'
import { isTimeoutError } from '../../ai/timeout'
import { env } from '../../env'
import { suggestCategoryWithAI } from '../../expense-form-actions'
import { logServerInfo } from '../../logging'

export type SuggestExpenseCategoryArgs = {
  groupId: string
  title: string
  locale?: string
  /**
   * Client-side AI preference. Server still requires
   * PUBLIC_ENABLE_CATEGORY_EXTRACT.
   */
  allowAi?: boolean
  /** Invoked immediately before the AI engine runs, after local misses. */
  beforeAi?: () => void
}

export type SuggestExpenseCategoryResult = {
  categoryId: CategoryId | null
  /**
   * AI guess chips ("other suggestions"), strongest first. Empty unless an AI
   * engine ran with usable runners-up.
   */
  candidates: AiCategorySuggestion[]
}

export type CategoryEngine = 'llm' | 'system-one'

type SuggestHit = 'dictionary' | 'history' | 'llm' | 'system-one' | 'none'

type SuggestNoneReason =
  | 'title-too-short'
  | 'local-miss-ai-disabled'
  | 'ai-below-floor'
  | 'ai-timeout'

type SuggestCandidate = { id: string; score: number }

function round3(value: number): number {
  return Math.round(value * 1000) / 1000
}

function logSuggest(details: {
  /** Raw input title — what the user typed. */
  title: string
  locale: string
  groupId: string
  allowAi: boolean
  engine: CategoryEngine
  dictionaryEnabled: boolean
  historyEnabled: boolean
  thresholds: { minScore: number; settlementMinScore: number }
  hit: SuggestHit
  categoryId: CategoryId | null
  score?: number
  confidence?: number
  marginTopTwo?: number
  model?: string
  latencyMs?: number
  /** Why a `none` outcome happened. */
  reason?: SuggestNoneReason
  /**
   * Top dictionary candidates below the gate (score desc). Present on `none`
   * outcomes so the log shows what almost matched — and whether the client had
   * anything to render as "Other suggestions" chips.
   */
  topCandidates?: SuggestCandidate[]
  /**
   * System One option probabilities, desc, zeros dropped. Choice answers always
   * carry the full distribution; this makes every runner-up visible instead of
   * only the winning `categoryId`.
   */
  probabilities?: { id: string; probability: number }[]
  /** Normalized LLM distribution (winner + validated runners-up, sums to 1). */
  distribution?: AiCategoryDistribution[]
  /** Guess chips actually returned to the client for this call. */
  candidates?: CategorySuggestion[]
}) {
  logServerInfo('suggestCategory', details)
}

function localSuggestOptions(): SuggestCategoryOptions {
  return {
    dictionaryEnabled: env.CATEGORY_DICTIONARY_ENABLED,
    historyEnabled: env.CATEGORY_HISTORY_ENABLED,
    thresholds: {
      minScore: env.CATEGORY_LOCAL_MIN_SCORE,
      settlementMinScore: env.CATEGORY_LOCAL_SETTLEMENT_MIN_SCORE,
    },
  }
}

/**
 * Dictionary (brands/aliases), then last-200 title memory, then one AI engine
 * (LLM or System One decision model, exclusively per AI_CATEGORY_ENGINE). Title
 * history replaces the title GIN/trigram path for this flow — cheaper DB and
 * available even without pg_trgm. The AI engine runs only when the local stages
 * miss, the client asked for AI, and the deployment flag is on.
 */
export async function suggestExpenseCategory(
  args: SuggestExpenseCategoryArgs,
): Promise<SuggestExpenseCategoryResult> {
  const locale = args.locale ?? 'en-US'
  const options = localSuggestOptions()
  const input = {
    title: args.title,
    locale,
    groupId: args.groupId,
    allowAi: args.allowAi ?? false,
    engine: env.AI_CATEGORY_ENGINE as CategoryEngine,
    dictionaryEnabled: env.CATEGORY_DICTIONARY_ENABLED,
    historyEnabled: env.CATEGORY_HISTORY_ENABLED,
    thresholds: {
      minScore: env.CATEGORY_LOCAL_MIN_SCORE,
      settlementMinScore: env.CATEGORY_LOCAL_SETTLEMENT_MIN_SCORE,
    },
  }

  // Top dictionary candidates below the gate, computed lazily: only `none`
  // outcomes need them, and hit paths already ranked internally.
  let topCandidates: SuggestCandidate[] | undefined
  const getTopCandidates = (): SuggestCandidate[] => {
    topCandidates ??= rankCategories(
      args.title,
      createCategorySearchDocumentsForLocale(locale),
    )
      .slice(0, 3)
      .map(({ id, score }) => ({ id, score: round3(score) }))
    return topCandidates
  }

  if (!meetsCategorySuggestMinQueryLength(args.title)) {
    logSuggest({
      ...input,
      hit: 'none',
      categoryId: null,
      reason: 'title-too-short',
    })
    return { categoryId: null, candidates: [] }
  }

  await loadLocaleDictionary(locale)

  if (env.CATEGORY_DICTIONARY_ENABLED) {
    const dictionaryHit = suggestCategoryFromTitleForLocale(
      args.title,
      locale,
      [],
      { ...options, historyEnabled: false },
    )
    if (dictionaryHit) {
      logSuggest({
        ...input,
        hit: 'dictionary',
        categoryId: dictionaryHit.id,
        score: round3(dictionaryHit.score),
      })
      return { categoryId: dictionaryHit.id, candidates: [] }
    }
  }

  // Recent expenses feed both the history stage and the AI engine, so fetch
  // once when either may run.
  const needsContext =
    env.CATEGORY_HISTORY_ENABLED ||
    (args.allowAi && env.PUBLIC_ENABLE_CATEGORY_EXTRACT)
  const context = needsContext
    ? await getRecentExpenseContext(args.groupId, env.CATEGORY_MEMORY_LIMIT)
    : undefined

  if (env.CATEGORY_HISTORY_ENABLED && context) {
    const historyHit = suggestCategoryFromTitleForLocale(
      args.title,
      locale,
      context.expenses,
      { ...options, dictionaryEnabled: false },
    )
    if (historyHit) {
      logSuggest({
        ...input,
        hit: 'history',
        categoryId: historyHit.id,
        score: round3(historyHit.score),
      })
      return { categoryId: historyHit.id, candidates: [] }
    }
  }

  if (!args.allowAi || !env.PUBLIC_ENABLE_CATEGORY_EXTRACT) {
    logSuggest({
      ...input,
      hit: 'none',
      categoryId: null,
      reason: 'local-miss-ai-disabled',
      topCandidates: getTopCandidates(),
    })
    return { categoryId: null, candidates: [] }
  }

  args.beforeAi?.()

  const recentExpenses = (context?.expenses ?? []).slice(
    0,
    env.AI_CATEGORY_RECENT_EXPENSES_LIMIT,
  )
  const groupContext = context?.group.name
    ? {
        name: context.group.name,
        currency: context.group.currency,
        currencyCode: context.group.currencyCode,
      }
    : undefined

  const started = Date.now()
  const minConfidence = env.AI_CATEGORY_MIN_CONFIDENCE
  try {
    if (env.AI_CATEGORY_ENGINE === 'system-one') {
      const systemOne = await suggestCategoryWithSystemOne(args.title, {
        apiKey: env.AI_SYSTEM_ONE_API_KEY!,
        model: env.AI_SYSTEM_ONE_MODEL,
        baseUrl: env.AI_SYSTEM_ONE_BASE_URL,
        timeoutSeconds: env.AI_SYSTEM_ONE_TIMEOUT_SECONDS,
        minConfidence,
        recentExpenses,
        locale: args.locale,
        groupContext,
      })
      const distribution: AiCategoryDistribution[] = Object.entries(
        systemOne.probabilities,
      ).map(([id, probability]) => ({ id, probability }))
      const candidates = suggestAiCandidates(
        distribution,
        systemOne.categoryId ? [systemOne.categoryId] : [],
      )
      logSuggest({
        ...input,
        hit: systemOne.categoryId ? 'system-one' : 'none',
        categoryId: systemOne.categoryId,
        confidence: round3(systemOne.confidence),
        marginTopTwo: round3(systemOne.marginTopTwo),
        probabilities: Object.entries(systemOne.probabilities)
          .map(([id, probability]) => ({
            id,
            probability: round3(probability),
          }))
          .filter(({ probability }) => probability > 0)
          .sort((left, right) => right.probability - left.probability),
        candidates,
        model: env.AI_SYSTEM_ONE_MODEL,
        latencyMs: Date.now() - started,
        ...(!systemOne.categoryId && {
          reason: 'ai-below-floor' as const,
          topCandidates: getTopCandidates(),
        }),
      })
      return { categoryId: systemOne.categoryId, candidates }
    }

    const ai = await suggestCategoryWithAI(args.title, {
      recentExpenses,
      locale: args.locale,
      groupContext,
    })
    const floored = ai.confidence < minConfidence ? null : ai.categoryId
    const candidates = suggestAiCandidates(
      ai.distribution,
      floored ? [floored] : [],
    )
    logSuggest({
      ...input,
      hit: floored ? 'llm' : 'none',
      categoryId: floored,
      confidence: round3(ai.confidence),
      distribution: ai.distribution.map(({ id, probability }) => ({
        id,
        probability: round3(probability),
      })),
      candidates,
      model: env.AI_CATEGORY_MODEL,
      latencyMs: Date.now() - started,
      ...(!floored && {
        reason: 'ai-below-floor' as const,
        topCandidates: getTopCandidates(),
      }),
    })
    return { categoryId: floored, candidates }
  } catch (error) {
    // Best-effort suggestion: a slow provider must not fail the form.
    if (isTimeoutError(error)) {
      logSuggest({
        ...input,
        hit: 'none',
        categoryId: null,
        reason: 'ai-timeout',
        latencyMs: Date.now() - started,
        topCandidates: getTopCandidates(),
      })
      return { categoryId: null, candidates: [] }
    }
    throw error
  }
}
