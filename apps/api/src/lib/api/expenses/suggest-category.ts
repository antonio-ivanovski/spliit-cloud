import {
  loadLocaleDictionary,
  meetsCategorySuggestMinQueryLength,
  suggestCategoryFromTitleForLocale,
  type CategoryId,
} from '@spliit/domain'

import { getRecentExpenseContext } from '../../ai/context'
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
  /** Invoked immediately before the provider fallback, after local misses. */
  beforeAi?: () => void
}

type SuggestHit = 'dictionary' | 'history' | 'llm' | 'none'

function logSuggest(details: {
  hit: SuggestHit
  categoryId: CategoryId | null
  score?: number
}) {
  logServerInfo('suggestCategory', details)
}

/**
 * Dictionary (brands/aliases), then last-200 title memory, then optional LLM.
 * Title history replaces the title GIN/trigram path for this flow — cheaper DB
 * and available even without pg_trgm. The LLM runs only when those are weak,
 * the client asked for AI, and the deployment flag is on.
 */
export async function suggestExpenseCategory(
  args: SuggestExpenseCategoryArgs,
): Promise<{ categoryId: CategoryId | null }> {
  if (!meetsCategorySuggestMinQueryLength(args.title)) {
    logSuggest({ hit: 'none', categoryId: null })
    return { categoryId: null }
  }

  const locale = args.locale ?? 'en-US'
  await loadLocaleDictionary(locale)

  const dictionaryHit = suggestCategoryFromTitleForLocale(args.title, locale)
  if (dictionaryHit) {
    logSuggest({
      hit: 'dictionary',
      categoryId: dictionaryHit.id,
      score: dictionaryHit.score,
    })
    return { categoryId: dictionaryHit.id }
  }

  const context = await getRecentExpenseContext(
    args.groupId,
    env.CATEGORY_MEMORY_LIMIT,
  )
  const historyHit = suggestCategoryFromTitleForLocale(
    args.title,
    locale,
    context.expenses,
  )
  if (historyHit) {
    logSuggest({
      hit: 'history',
      categoryId: historyHit.id,
      score: historyHit.score,
    })
    return { categoryId: historyHit.id }
  }

  if (!args.allowAi || !env.PUBLIC_ENABLE_CATEGORY_EXTRACT) {
    logSuggest({ hit: 'none', categoryId: null })
    return { categoryId: null }
  }

  args.beforeAi?.()

  let ai: { categoryId: CategoryId | null }
  try {
    ai = await suggestCategoryWithAI(args.title, {
      recentExpenses: context.expenses.slice(
        0,
        env.AI_CATEGORY_RECENT_EXPENSES_LIMIT,
      ),
      locale: args.locale,
      groupContext: context.group.name
        ? {
            name: context.group.name,
            currency: context.group.currency,
            currencyCode: context.group.currencyCode,
          }
        : undefined,
    })
  } catch (error) {
    // Best-effort suggestion: a slow provider must not fail the form.
    if (isTimeoutError(error)) {
      logSuggest({ hit: 'none', categoryId: null })
      return { categoryId: null }
    }
    throw error
  }
  logSuggest({
    hit: ai.categoryId ? 'llm' : 'none',
    categoryId: ai.categoryId,
  })
  return ai
}
