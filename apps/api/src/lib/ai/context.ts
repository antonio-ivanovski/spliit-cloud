import { prisma } from '@spliit/db'
import { DEFAULT_CATEGORY_ID, SETTLEMENT_CATEGORY_ID } from '@spliit/domain'

import { env } from '../env'

export type RecentExpense = { title: string; categoryId: string }

export type GroupContext = {
  name: string
  /** Display symbol (e.g. "$"). */
  currency: string
  /** ISO-4217 code (e.g. "USD"), or null for custom currencies. */
  currencyCode: string | null
}

export type RecentExpenseContext = {
  group: GroupContext
  expenses: RecentExpense[]
}

/**
 * Fetch the most recent non-settlement, non-default expenses for a group's
 * ledger, plus group metadata useful as AI hints.
 *
 * Expenses left on the default category (`general`) are excluded because they
 * carry no categorization signal and would bias the AI toward the fallback. If
 * every recent expense is "general", `expenses` is `[]` and the prompt builder
 * returns an empty string.
 *
 * Access-agnostic — the caller must have already validated group access.
 * Repetition is intentional: frequency in the prompt acts as an implicit
 * weighting signal for the AI.
 *
 * `limit` defaults to env.AI_CATEGORY_RECENT_EXPENSES_LIMIT (50) for LLM
 * prompts. Local matching should pass env.CATEGORY_MEMORY_LIMIT (default 200).
 * The function does not trigger any side effects (no recurring-expense
 * materialization) so it is safe to call from batch/backfill jobs.
 */
export async function getRecentExpenseContext(
  groupId: string,
  limit: number = env.AI_CATEGORY_RECENT_EXPENSES_LIMIT,
): Promise<RecentExpenseContext> {
  const group = await prisma.group.findUnique({
    where: { id: groupId },
    select: {
      name: true,
      ledger: { select: { id: true, currency: true, currencyCode: true } },
    },
  })
  const ledger = group?.ledger
  if (!group || !ledger) {
    return {
      group: { name: '', currency: '$', currencyCode: null },
      expenses: [],
    }
  }
  const expenses = await prisma.expense.findMany({
    where: {
      ledgerId: ledger.id,
      categoryId: { notIn: [DEFAULT_CATEGORY_ID, SETTLEMENT_CATEGORY_ID] },
    },
    select: { title: true, categoryId: true },
    orderBy: [{ expenseDate: 'desc' }, { createdAt: 'desc' }],
    take: limit,
  })

  return {
    group: {
      name: group.name,
      currency: ledger.currency,
      currencyCode: ledger.currencyCode,
    },
    expenses,
  }
}
