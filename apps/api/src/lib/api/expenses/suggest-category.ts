import {
  createCategorySearchDocumentsForLocale,
  CATEGORY_DICTIONARY_HISTORY_VETO_SCORE,
  categorizeLocally,
  loadLocaleDictionary,
  meetsCategorySuggestMinQueryLength,
  suggestAiCandidates,
  type AiCategoryDistribution,
  type AiCategorySuggestion,
  type CategoryId,
  type SuggestCategoryOptions,
} from '@spliit/domain'

import {
  adaptSystemOneCategory,
  adaptLlmCategory,
} from '../../ai/category-adapters'
import { getRecentExpenseContext } from '../../ai/context'
import { suggestCategoryWithSystemOne } from '../../ai/system-one-categorize'
import { isTimeoutError } from '../../ai/timeout'
import { env } from '../../env'
import { suggestCategoryWithAI } from '../../expense-form-actions'

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

  if (!meetsCategorySuggestMinQueryLength(args.title)) {
    return { categoryId: null, candidates: [] }
  }

  await loadLocaleDictionary(locale)

  const documents = createCategorySearchDocumentsForLocale(locale)
  // A near-exact dictionary hit cannot be displaced by conflicting history;
  // keep this common form path free of a group-context query.
  const early = categorizeLocally({
    title: args.title,
    documents,
    options: { ...options, historyEnabled: false },
    alternativeLimit: 0,
  })
  if (
    early.categoryId &&
    early.primary?.source === 'dictionary' &&
    early.primary.evidence.value >= CATEGORY_DICTIONARY_HISTORY_VETO_SCORE
  ) {
    return { categoryId: early.categoryId, candidates: [] }
  }

  // Recent expenses feed both the history stage and the AI engine, so fetch
  // once when either may run.
  const needsContext =
    env.CATEGORY_HISTORY_ENABLED ||
    (args.allowAi && env.PUBLIC_ENABLE_CATEGORY_EXTRACT)
  const context = needsContext
    ? await getRecentExpenseContext(args.groupId, env.CATEGORY_MEMORY_LIMIT)
    : undefined

  const local = categorizeLocally({
    title: args.title,
    documents,
    memory: context?.expenses ?? [],
    options,
  })
  if (local.categoryId && local.primary) {
    return { categoryId: local.categoryId, candidates: [] }
  }

  if (!args.allowAi || !env.PUBLIC_ENABLE_CATEGORY_EXTRACT) {
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

  const minConfidence = env.AI_CATEGORY_MIN_CONFIDENCE
  try {
    if (env.AI_CATEGORY_ENGINE === 'system-one') {
      const systemOne = await suggestCategoryWithSystemOne(args.title, {
        apiKey: env.AI_SYSTEM_ONE_API_KEY!,
        model: env.AI_SYSTEM_ONE_MODEL,
        baseUrl: env.AI_SYSTEM_ONE_BASE_URL,
        timeoutSeconds: env.AI_SYSTEM_ONE_TIMEOUT_SECONDS,
        // Let the shared interpreter apply the same floor as bulk.
        minConfidence: 0,
        recentExpenses,
        locale: args.locale,
        groupContext,
      })
      const verdict = adaptSystemOneCategory(
        {
          categoryId: (systemOne.categoryId ?? 'general') as CategoryId,
          confidence: systemOne.confidence,
          probabilities: Object.entries(systemOne.probabilities).map(
            ([categoryId, probability]) => ({
              categoryId: categoryId as CategoryId,
              probability,
            }),
          ),
        },
        minConfidence,
      )
      const distribution: AiCategoryDistribution[] = Object.entries(
        systemOne.probabilities,
      ).map(([id, probability]) => ({ id, probability }))
      const candidates = suggestAiCandidates(
        distribution,
        verdict.categoryId ? [verdict.categoryId] : [],
      )
      return { categoryId: verdict.categoryId, candidates }
    }

    const ai = await suggestCategoryWithAI(args.title, {
      recentExpenses,
      locale: args.locale,
      groupContext,
    })
    const verdict = adaptLlmCategory(ai, minConfidence)
    const candidates = suggestAiCandidates(
      ai.distribution,
      verdict.categoryId ? [verdict.categoryId] : [],
    )
    return { categoryId: verdict.categoryId, candidates }
  } catch (error) {
    // Best-effort suggestion: a slow provider must not fail the form.
    if (isTimeoutError(error)) {
      return { categoryId: null, candidates: [] }
    }
    throw error
  }
}
