import { TRPCError } from '@trpc/server'
import { z } from 'zod'

import { categoryIdSchema } from '@spliit/domain'

import {
  BULK_CALIBRATION_CANDIDATE_POOL_SIZE,
  BULK_CALIBRATION_SAMPLE_SIZE,
  BULK_CALIBRATION_SUGGESTED_MAX_ROUNDS,
  TITLE_CHAR_LIMIT,
  buildCategorizationSystemPrompt,
  calibrationResponseSchema,
  callBulkCategorizationModel,
  type CalibrationResponse,
} from '../../../../lib/ai/categorize'
import {
  listBulkCategorizeCandidates,
  type BulkCategorizeCandidateRow,
} from '../../../../lib/api/category-bulk'
import { env } from '../../../../lib/env'
import { bulkAiProcedure, loadGroupContext } from '../../../init'
import { calibrateBulkCategorizeOutputSchema } from '../../../outputs/ai'

const calibrateInputSchema = z.object({
  groupId: z.string().min(1),
  locale: z.string().optional(),
  round: z
    .number()
    .int()
    .positive()
    .describe(
      '1-based batch number. Each round fetches the next slice of candidates.',
    ),
  // Optional overrides so the admin can start the calibration flow
  // from a different "uncategorized" pool in the future (e.g. only
  // last quarter). Today only `general` is supported.
  fromCategoryId: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Filter expenses currently in this category. Defaults to 'general'.",
    ),
  // Admin-supplied corrections from a previous calibration round.
  // The server uses them to thread feedback to the AI in subsequent
  // rounds — but re-validates the ids against the candidates so a
  // stale client cannot inject phantom rows.
  priorSelections: z
    .array(
      z.object({
        expenseId: z.string().min(1),
        categoryId: categoryIdSchema,
      }),
    )
    .max(BULK_CALIBRATION_CANDIDATE_POOL_SIZE)
    .optional()
    .describe(
      'Previous (expenseId, categoryId) picks to condition the AI model on prior answers.',
    ),
})

export const aiBulkCategorizeCalibrateProcedure = bulkAiProcedure
  .input(calibrateInputSchema)
  .output(calibrateBulkCategorizeOutputSchema)
  .mutation(async ({ ctx, input }) => {
    if (!env.PUBLIC_ENABLE_BULK_CATEGORIZE) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'Bulk categorization is disabled',
      })
    }
    const { member, group } = await loadGroupContext({
      groupId: input.groupId,
      accountId: ctx.auth.user.id,
    })
    if (member.role !== 'ADMIN') {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Only admins can use the bulk categorizer',
      })
    }
    if (group.archived) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'This group is archived',
      })
    }

    const candidates: BulkCategorizeCandidateRow[] =
      await listBulkCategorizeCandidates({
        groupId: input.groupId,
        fromCategoryId: input.fromCategoryId,
        limit: BULK_CALIBRATION_CANDIDATE_POOL_SIZE,
      })

    // Nothing to do — return an empty calibration result so the
    // client can short-circuit to "ready" without an OpenAI call.
    if (candidates.length === 0) {
      return {
        candidates: [],
        totalEligible: 0,
        response: {
          needsFeedback: false,
          selections: [],
        } satisfies CalibrationResponse,
        forcedReady: true,
      }
    }

    const totalEligible = candidates.length

    // Re-validate priorSelections against current candidates so a
    // stale client cannot smuggle unknown expenseIds into the
    // prompt. We just drop unknowns and keep what still applies.
    const candidateIds = new Set(candidates.map((c) => c.id))
    const priorFeedback = (input.priorSelections ?? []).filter((p) =>
      candidateIds.has(p.expenseId),
    )

    // Reuse the same group context / past-expense examples as the
    // single-title categorizer so both surfaces share one vocabulary.
    const { getRecentExpenseContext } =
      await import('../../../../lib/ai/context')
    const recentContext = await getRecentExpenseContext(input.groupId)

    const system = buildCategorizationSystemPrompt({
      recentExpenses: recentContext.expenses,
      locale: input.locale,
      groupContext: recentContext.group,
    })

    const userContent = renderCalibrationUserPrompt({
      candidates,
      priorFeedback,
      round: input.round,
    })

    const raw = await callBulkCategorizationModel({
      operation: 'bulk-calibration',
      candidateCount: candidates.length,
      priorFeedbackCount: priorFeedback.length,
      round: input.round,
      prompt: {
        model: env.AI_CATEGORY_MODEL,
        temperature: 0.1,
        instructions: system,
        prompt: userContent,
      },
    })

    let parsed: CalibrationResponse
    try {
      const json = JSON.parse(raw ?? '{}')
      parsed = calibrationResponseSchema.parse(json)
    } catch {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message:
          'The AI returned an unexpected calibration response. Please try again.',
      })
    }

    // Cross-validate the selections against the candidate pool so a
    // misbehaving model (or a hallucination) cannot route the admin
    // onto expenses that don't exist.
    const reviewedIds = new Set(
      priorFeedback.map((selection) => selection.expenseId),
    )
    const selectedIds = new Set<string>()
    const selectedForReview = parsed.selections.filter((selection) => {
      if (
        !candidateIds.has(selection.expenseId) ||
        reviewedIds.has(selection.expenseId) ||
        selectedIds.has(selection.expenseId)
      ) {
        return false
      }
      selectedIds.add(selection.expenseId)
      return true
    })

    if (
      (input.round === 1 && !parsed.needsFeedback) ||
      (parsed.needsFeedback && selectedForReview.length === 0)
    ) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message:
          'The AI did not return a calibration sample. Please try again.',
      })
    }

    return {
      candidates: candidates.map((c) => ({
        id: c.id,
        title: c.title,
        expenseDate: c.expenseDate,
        amount: c.amount,
      })),
      totalEligible,
      response: {
        needsFeedback: parsed.needsFeedback,
        selections: parsed.needsFeedback ? selectedForReview : [],
      } satisfies CalibrationResponse,
      forcedReady: false,
    }
  })

export function renderCalibrationUserPrompt(args: {
  candidates: BulkCategorizeCandidateRow[]
  priorFeedback: Array<{ expenseId: string; categoryId: string }>
  round: number
}): string {
  const list = args.candidates
    .map((c, i) => {
      // Truncate titles to keep the prompt bounded. The UI is the
      // source of truth for the full titles.
      const title =
        c.title.length > TITLE_CHAR_LIMIT
          ? c.title.slice(0, TITLE_CHAR_LIMIT) + '…'
          : c.title
      return `- index=${i + 1} id="${c.id}" title="${title}"`
    })
    .join('\n')

  const feedback = args.priorFeedback
    .map((p) => `- ${p.expenseId} -> ${p.categoryId}`)
    .join('\n')

  return [
    `Bulk-categorize calibration round ${args.round}.`,
    '',
    'You will see a broad pool of currently-uncategorized expenses for this group.',
    'Your job:',
    '- Choose the most informative representative sample (up to ' +
      BULK_CALIBRATION_SAMPLE_SIZE +
      ' entries) for the admin to review. Do not choose rows merely because they appear first.',
    '- This is calibration, not the final preview. Keep the sample small and purposeful: choose only enough diverse examples to make a strong final estimate, usually far fewer than the maximum.',
    '- Even if this pool contains fewer than the maximum sample size, do not return every expense unless each one is needed to cover a distinct pattern. The final preview will classify the full list.',
    '- Be quick: scan the titles rapidly and stop once you have enough representative variety. Do not analyze every entry.',
    '- For each picked entry, return your best-guess category id (so the admin can correct it quickly).',
    '- On the first round, set needsFeedback=true and return a non-empty sample.',
    '- On later rounds, use prior admin feedback as ground truth. Set needsFeedback=true only when a new sample would materially improve categorization.',
    '- Aim to finish within ' +
      BULK_CALIBRATION_SUGGESTED_MAX_ROUNDS +
      ' rounds. On or after round ' +
      BULK_CALIBRATION_SUGGESTED_MAX_ROUNDS +
      ', proceed with what you know: set needsFeedback=false and return an empty selections array. Uncertain expenses can be left uncategorized in the final preview.',
    '- If you are ready to classify the whole list, set needsFeedback=false and return an empty selections array.',
    '',
    'Candidate pool (title -> expense id):',
    list,
    '',
    ...(feedback
      ? [
          'Admin feedback from previous rounds (apply as ground truth):',
          feedback,
          '',
        ]
      : []),
    'Return exactly one JSON object with needsFeedback (boolean) and selections (array of {expenseId, suggestedCategoryId, confidence}). Each confidence must be exactly one lowercase value: "high", "medium", or "low".',
  ].join('\n')
}
