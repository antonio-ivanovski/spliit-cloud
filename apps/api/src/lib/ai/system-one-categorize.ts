import {
  DEFAULT_CATEGORIES,
  DEFAULT_CATEGORY_ID,
  SETTLEMENT_CATEGORY_ID,
  formatCategoryForAIPrompt,
  type CategoryId,
} from '@spliit/domain'

import type { GroupContext, RecentExpense } from './context'
import { resolveLanguageName } from './prompt'
import { timeoutSecondsToMs } from './timeout'

/** Default TypeSafe evaluation endpoint (Jev is a System One model). */
export const DEFAULT_SYSTEM_ONE_API_URL = 'https://api.typesafe.ai/v1/systemone'

/** Same abuse bound as the LLM fallback (~10 tokens). */
const TITLE_LIMIT = 40

export type SuggestCategoryWithSystemOneOptions = {
  /** API key for the decision-model endpoint (server-side only). */
  apiKey: string
  /** Decision model name, e.g. `jev-latest`. Any model the endpoint serves. */
  model?: string
  /**
   * Endpoint base URL. Defaults to TypeSafe; point at a self-hosted
   * `/v1/systemone`-compatible server (e.g. Kev) to run another model.
   */
  baseUrl?: string
  /** Per-request timeout in seconds. */
  timeoutSeconds?: number
  /** Recent or similar expense titles + their assigned category IDs. */
  recentExpenses?: RecentExpense[]
  /** User's locale (e.g. 'es', 'ja-JP'); resolved to a language name. */
  locale?: string
  /** Group metadata (name, currency) used as soft context. */
  groupContext?: GroupContext
  /**
   * Minimum accepted confidence (0–1). Verdicts below it map to a null category
   * (no confident fit) while keeping the raw confidence figures for logging and
   * calibration. Defaults to 0 (accept whatever the model picks).
   */
  minConfidence?: number
}

export type SuggestCategoryWithSystemOneResult = {
  categoryId: CategoryId | null
  /** Model confidence for the selected option (0–1). */
  confidence: number
  /** Full probability distribution across the category options. */
  probabilities: Record<string, number>
  /**
   * Gap between the winner's probability and the runner-up's (0–1). A small
   * margin with a middling confidence means genuinely split options — the docs'
   * runner-up inspection pattern. 0 when there is no usable distribution.
   */
  marginTopTwo: number
}

type SystemOneChoiceAnswer = {
  type: 'choice'
  choice: string
  confidence: number
  probabilities: Record<string, number>
}

type SystemOneResponse = {
  model: string
  answers: Record<string, SystemOneChoiceAnswer>
  usage: { input_tokens: number; output_tokens: number }
}

/**
 * Category IDs offered to the decision model. Mirrors the LLM fallback:
 * `settlement` is never a valid suggestion, and `general` acts as the no-match
 * outcome (callers map it to null, i.e. "no confident fit").
 */
export function systemOneCategoryOptions(): {
  id: string
  description: string
}[] {
  return DEFAULT_CATEGORIES.filter(
    (category) => category.id !== SETTLEMENT_CATEGORY_ID,
  ).map((category) => ({
    id: category.id,
    description: formatCategoryForAIPrompt(category),
  }))
}

/**
 * Title → category judgment via a System One decision model. Asks a single flat
 * `Choice` question over every default category, with the expense title,
 * locale, group context, and recent group expenses as structured state.
 *
 * Returns null when the model picks the default `general` category (or anything
 * outside the allowlist), or when confidence falls below `minConfidence`,
 * matching the LLM fallback contract. Throws on transport errors and timeouts —
 * callers decide whether to swallow those (see `suggest-category.ts`, which
 * degrades to no suggestion).
 */
export async function suggestCategoryWithSystemOne(
  description: string,
  options: SuggestCategoryWithSystemOneOptions,
): Promise<SuggestCategoryWithSystemOneResult> {
  const criteria: Record<string, string> = {}
  for (const option of systemOneCategoryOptions()) {
    criteria[option.id] = option.description
  }
  const allowedIds = new Set(Object.keys(criteria))

  const languageName = options.locale
    ? resolveLanguageName(options.locale)
    : undefined

  const state = {
    expenseTitle: description.substring(0, TITLE_LIMIT),
    appLanguage: languageName ?? null,
    group: options.groupContext
      ? {
          name: options.groupContext.name,
          currency:
            options.groupContext.currencyCode ?? options.groupContext.currency,
        }
      : null,
    recentExpenses: (options.recentExpenses ?? []).map((expense) => ({
      title: expense.title,
      categoryId: expense.categoryId,
    })),
  }

  const response = await fetch(options.baseUrl ?? DEFAULT_SYSTEM_ONE_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      'Content-Type': 'application/json',
    },
    signal: AbortSignal.timeout(
      timeoutSecondsToMs(options.timeoutSeconds ?? 10),
    ),
    body: JSON.stringify({
      state,
      model: options.model ?? 'jev-latest',
      questions: {
        category: {
          type: 'choice',
          instructions:
            'Which expense category best describes this expense title? Use the group context, app language hint, and recent expenses as supporting context. If no category fits, choose general.',
          criteria,
        },
      },
    }),
  })

  if (!response.ok) {
    throw new Error(`SystemOne request failed with status ${response.status}`)
  }

  const payload = (await response.json()) as SystemOneResponse
  const answer = payload.answers?.['category']
  const choice = answer?.choice
  const confidence = answer?.confidence ?? 0
  const probabilities = answer?.probabilities ?? {}
  const rankedProbabilities = Object.values(probabilities).sort((a, b) => b - a)
  const marginTopTwo =
    rankedProbabilities.length >= 2
      ? rankedProbabilities[0]! - rankedProbabilities[1]!
      : 0

  const minConfidence = options.minConfidence ?? 0
  if (
    !choice ||
    !allowedIds.has(choice) ||
    choice === DEFAULT_CATEGORY_ID ||
    choice === SETTLEMENT_CATEGORY_ID ||
    confidence < minConfidence
  ) {
    return { categoryId: null, confidence, probabilities, marginTopTwo }
  }
  return {
    categoryId: choice as CategoryId,
    confidence,
    probabilities,
    marginTopTwo,
  }
}
