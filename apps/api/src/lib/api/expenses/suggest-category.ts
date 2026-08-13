import { prisma } from '@spliit/db'
import {
  DEFAULT_CATEGORY_ID,
  createCategorySearchDocumentsForLocale,
  loadLocaleDictionary,
  meetsCategorySuggestMinQueryLength,
  suggestCategoryFromTitle,
  type CategoryId,
} from '@spliit/domain'

import { getRecentExpenseContext } from '../../ai/context'
import { env } from '../../env'
import { suggestCategoryWithAI } from '../../expense-form-actions'
import {
  TITLE_TRIGRAM_CATEGORY_LIMIT,
  findSimilarExpenseTitles,
} from './title-search'

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

/**
 * Fast local title → category, then optional LLM. Dictionaries run first (no
 * DB). Similar past titles use the title GIN index. The LLM runs only when both
 * are weak, the client asked for AI, and the deployment flag is on.
 */
export async function suggestExpenseCategory(
  args: SuggestExpenseCategoryArgs,
): Promise<{ categoryId: CategoryId | null }> {
  if (!meetsCategorySuggestMinQueryLength(args.title)) {
    return { categoryId: null }
  }

  await loadLocaleDictionary(args.locale ?? 'en-US')
  const documents = createCategorySearchDocumentsForLocale(
    args.locale ?? 'en-US',
  )
  const dictionaryHit = suggestCategoryFromTitle(args.title, documents, [])
  if (dictionaryHit) return { categoryId: dictionaryHit.id }

  const group = await prisma.group.findUnique({
    where: { id: args.groupId },
    select: {
      name: true,
      ledger: { select: { id: true, currency: true, currencyCode: true } },
    },
  })
  const ledger = group?.ledger
  const similar = ledger
    ? await findSimilarExpenseTitles({
        ledgerIds: [ledger.id],
        query: args.title,
        limit: TITLE_TRIGRAM_CATEGORY_LIMIT,
        excludeSettlements: true,
        excludeCategoryIds: [DEFAULT_CATEGORY_ID],
      })
    : []
  const historyHit = suggestCategoryFromTitle(
    args.title,
    documents,
    similar.map((row) => ({ title: row.title, categoryId: row.categoryId })),
  )
  if (historyHit) return { categoryId: historyHit.id }

  if (!args.allowAi || !env.PUBLIC_ENABLE_CATEGORY_EXTRACT) {
    return { categoryId: null }
  }

  args.beforeAi?.()

  let recentExpenses = similar.map((row) => ({
    title: row.title,
    categoryId: row.categoryId,
  }))
  if (recentExpenses.length === 0) {
    const context = await getRecentExpenseContext(
      args.groupId,
      env.AI_CATEGORY_RECENT_EXPENSES_LIMIT,
    )
    recentExpenses = context.expenses
  }

  return suggestCategoryWithAI(args.title, {
    recentExpenses,
    locale: args.locale,
    groupContext:
      group && ledger
        ? {
            name: group.name,
            currency: ledger.currency,
            currencyCode: ledger.currencyCode,
          }
        : undefined,
  })
}
