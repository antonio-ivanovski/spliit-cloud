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

/** TypeSafe's System One endpoint (Jev is its flagship System One model). */
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

export type SystemOneCategoryAnswer = {
  choice: CategoryId
  confidence: number
  probabilities: Record<string, number>
}

export class SystemOneRequestError extends Error {
  constructor(
    readonly status: number,
    readonly errorType?: string,
  ) {
    super(
      `SystemOne request failed with status ${status}${errorType ? ` (${errorType})` : ''}`,
    )
  }
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
 * Shared System One request builder and allowlist validator for one or many
 * choices.
 */
export async function requestSystemOneCategories(args: {
  state: Record<string, unknown>
  questions: Record<string, { instructions: string | Record<string, unknown> }>
  apiKey: string
  model?: string
  baseUrl?: string
  timeoutSeconds?: number
}): Promise<Record<string, SystemOneCategoryAnswer | undefined>> {
  const criteria = Object.fromEntries(
    systemOneCategoryOptions().map(({ id, description }) => [id, description]),
  )
  const questions = Object.fromEntries(
    Object.entries(args.questions).map(([key, question]) => [
      key,
      { type: 'choice', instructions: question.instructions, criteria },
    ]),
  )
  const response = await fetch(args.baseUrl ?? DEFAULT_SYSTEM_ONE_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${args.apiKey}`,
      'Content-Type': 'application/json',
    },
    signal: AbortSignal.timeout(timeoutSecondsToMs(args.timeoutSeconds ?? 10)),
    body: JSON.stringify({
      state: args.state,
      model: args.model ?? 'jev-latest',
      questions,
    }),
  })
  if (!response.ok) {
    const body =
      typeof response.json === 'function'
        ? await response.json().catch(() => null)
        : null
    const errorType =
      body && typeof body === 'object' && 'detail' in body
        ? (body.detail as { error_type?: unknown })?.error_type
        : undefined
    throw new SystemOneRequestError(
      response.status,
      typeof errorType === 'string' ? errorType : undefined,
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
  const allowed = new Set(Object.keys(criteria))
  return Object.fromEntries(
    Object.keys(questions).map((key) => {
      const answer = payload.answers?.[key]
      if (
        answer?.type !== 'choice' ||
        !answer.choice ||
        !allowed.has(answer.choice) ||
        !Number.isFinite(answer.confidence) ||
        answer.confidence! < 0 ||
        answer.confidence! > 1
      )
        return [key, undefined]
      const probabilities = Object.fromEntries(
        Object.entries(answer.probabilities ?? {}).filter(
          ([id, probability]) =>
            allowed.has(id) &&
            Number.isFinite(probability) &&
            probability >= 0 &&
            probability <= 1,
        ),
      )
      return [
        key,
        {
          choice: answer.choice as CategoryId,
          confidence: answer.confidence!,
          probabilities,
        } satisfies SystemOneCategoryAnswer,
      ]
    }),
  )
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

  const answers = await requestSystemOneCategories({
    state,
    questions: {
      category: {
        instructions:
          'Which expense category best describes this expense title? Use the group context, app language hint, and recent expenses as supporting context. If no category fits, choose general.',
      },
    },
    apiKey: options.apiKey,
    model: options.model,
    baseUrl: options.baseUrl,
    timeoutSeconds: options.timeoutSeconds,
  })
  const answer = answers.category
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
