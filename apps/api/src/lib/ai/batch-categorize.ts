import { type CategoryId } from '@spliit/domain'

import { env } from '../env'
import { getRecentExpenseContext, type RecentExpenseContext } from './context'
import {
  DEFAULT_SYSTEM_ONE_API_URL,
  systemOneCategoryOptions,
} from './system-one-categorize'
import { timeoutSecondsToMs } from './timeout'

const QUESTIONS_PER_REQUEST = 5
const MAX_EXAMPLES = 8

export type JevExpense = { id: string; title: string; expenseDate: string }
export type JevExample = { title: string; categoryId: CategoryId }
export type JevNeighbor = JevExample & { expenseDate: string }

function words(title: string, locale: string) {
  return new Set(
    title
      .toLocaleLowerCase(locale)
      .normalize('NFKD')
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim()
      .split(/\s+/)
      .filter(Boolean),
  )
}

export function relevantJevExamples(
  title: string,
  examples: readonly JevExample[],
  locale = 'en-US',
) {
  const query = words(title, locale)
  const key = [...query].join(' ')
  return examples
    .map((example, index) => {
      const candidate = words(example.title, locale)
      const overlap = [...candidate].filter((word) => query.has(word)).length
      const score =
        [...candidate].join(' ') === key
          ? 2
          : overlap / Math.max(1, new Set([...query, ...candidate]).size)
      return { example, index, score }
    })
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, MAX_EXAMPLES)
    .map((row) => row.example)
}

export type BatchCategorySuggestion = {
  categoryId: CategoryId
  confidence: number
  probabilities: Array<{ categoryId: CategoryId; probability: number }>
}

/** One independent Jev Choice per expense ID, with target-specific hints. */
export async function categorizeExpensesWithJev(
  expenses: readonly JevExpense[],
  options: {
    groupId?: string
    groupName?: string
    locale?: string
    examples?: JevExample[]
    rejectedExamples?: Array<{
      title: string
      rejectedCategoryId: CategoryId
    }>
    neighborsById?: Map<string, JevNeighbor[]>
  } = {},
): Promise<Map<string, BatchCategorySuggestion>> {
  if (!env.AI_SYSTEM_ONE_API_KEY) return new Map()
  const eligible = expenses.filter((row) => row.title.trim().length >= 3)
  const categoryOptions = systemOneCategoryOptions()
  const criteria = Object.fromEntries(
    categoryOptions.map(({ id, description }) => [id, description]),
  )
  const allowed = new Set(categoryOptions.map(({ id }) => id))
  const context: RecentExpenseContext | undefined = options.groupId
    ? await getRecentExpenseContext(options.groupId)
    : undefined
  const locale = options.locale ?? 'en-US'
  const examples = [
    ...(options.examples ?? []),
    ...((context?.expenses ?? []) as JevExample[]),
  ]
  const state = {
    groupName: (options.groupName ?? context?.group.name ?? '').slice(0, 100),
    locale,
  }
  const suggestions = new Map<string, BatchCategorySuggestion>()

  async function requestChunk(chunk: JevExpense[]): Promise<void> {
    const questions = Object.fromEntries(
      chunk.map((expense, index) => [
        `expense_${index}`,
        {
          type: 'choice',
          instructions: {
            task: 'Choose the best category for this expense. Confirmed examples are strong guidance. Nearby categorized expenses are supporting context only. Rejections apply only to this title. Choose general if no category fits.',
            expense: {
              title: expense.title.slice(0, 80),
              expenseDate: expense.expenseDate,
            },
            confirmedExamples: relevantJevExamples(
              expense.title,
              examples,
              locale,
            ),
            rejectedCategories: (options.rejectedExamples ?? [])
              .filter(
                (row) =>
                  row.title.trim().toLocaleLowerCase(locale) ===
                  expense.title.trim().toLocaleLowerCase(locale),
              )
              .map((row) => row.rejectedCategoryId),
            nearbyExpenses: options.neighborsById?.get(expense.id) ?? [],
          },
          criteria,
        },
      ]),
    )
    const response = await fetch(
      env.AI_SYSTEM_ONE_BASE_URL || DEFAULT_SYSTEM_ONE_API_URL,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.AI_SYSTEM_ONE_API_KEY}`,
          'Content-Type': 'application/json',
        },
        signal: AbortSignal.timeout(
          timeoutSecondsToMs(env.AI_SYSTEM_ONE_TIMEOUT_SECONDS),
        ),
        body: JSON.stringify({
          model: env.AI_SYSTEM_ONE_MODEL,
          state,
          questions,
        }),
      },
    )
    if (!response.ok) {
      const body = await response.json().catch(() => null)
      const errorType =
        body && typeof body === 'object' && 'detail' in body
          ? (body.detail as { error_type?: unknown })?.error_type
          : undefined
      if (errorType === 'max_tokens_exceeded' && chunk.length > 1) {
        const midpoint = Math.ceil(chunk.length / 2)
        await requestChunk(chunk.slice(0, midpoint))
        await requestChunk(chunk.slice(midpoint))
        return
      }
      throw new Error(
        `Jev categorization failed with status ${response.status}${typeof errorType === 'string' ? ` (${errorType})` : ''}`,
      )
    }
    const payload = (await response.json()) as {
      answers?: Record<
        string,
        {
          type?: string
          choice?: string
          confidence?: number
          probabilities?: Record<string, number>
        }
      >
    }
    for (const [index, expense] of chunk.entries()) {
      const answer = payload.answers?.[`expense_${index}`]
      if (
        answer?.type !== 'choice' ||
        !answer.choice ||
        !allowed.has(answer.choice) ||
        !Number.isFinite(answer.confidence)
      ) {
        continue
      }
      suggestions.set(expense.id, {
        categoryId: answer.choice as CategoryId,
        confidence: answer.confidence!,
        probabilities: Object.entries(answer.probabilities ?? {})
          .filter(
            ([id, probability]) =>
              allowed.has(id) &&
              Number.isFinite(probability) &&
              probability >= 0 &&
              probability <= 1,
          )
          .map(([categoryId, probability]) => ({
            categoryId: categoryId as CategoryId,
            probability,
          }))
          .sort((a, b) => b.probability - a.probability),
      })
    }
  }

  for (
    let offset = 0;
    offset < eligible.length;
    offset += QUESTIONS_PER_REQUEST
  ) {
    await requestChunk(eligible.slice(offset, offset + QUESTIONS_PER_REQUEST))
  }
  return suggestions
}
