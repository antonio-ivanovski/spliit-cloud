import { categoryIdSchema } from '@spliit/domain'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import {
  BULK_CALIBRATION_SAMPLE_SIZE,
  BULK_PREVIEW_CHUNK_SIZE,
  BULK_PREVIEW_MAX_TARGETS,
  TITLE_CHAR_LIMIT,
  buildCategorizationSystemPrompt,
  bulkPreviewResponseSchema,
  callBulkCategorizationModel,
  type BulkPreviewResponse,
} from '../../../../lib/ai/categorize'
import {
  listBulkCategorizeCandidates,
  type BulkCategorizeCandidateRow,
} from '../../../../lib/api/category-bulk'
import { env } from '../../../../lib/env'
import { loadGroupContext, protectedProcedure } from '../../../init'

const previewInputSchema = z.object({
  groupId: z.string().min(1),
  locale: z.string().optional(),
  fromCategoryId: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Filter expenses currently in this category. Defaults to 'general'.",
    ),
  // Admin-supplied corrections, same shape & rationale as in
  // calibrate. Threaded into every chunk's preamble so the AI uses
  // them as ground truth.
  priorSelections: z
    .array(
      z.object({
        expenseId: z.string().min(1),
        categoryId: categoryIdSchema,
      }),
    )
    .max(BULK_CALIBRATION_SAMPLE_SIZE * 100)
    .optional()
    .describe(
      'Previous (expenseId, categoryId) picks to condition the AI model on prior answers.',
    ),
})

export const aiBulkCategorizePreviewProcedure = protectedProcedure
  .input(previewInputSchema)
  .mutation(async ({ ctx, input }) => {
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

    const candidates = await listBulkCategorizeCandidates({
      groupId: input.groupId,
      fromCategoryId: input.fromCategoryId,
      limit: BULK_PREVIEW_MAX_TARGETS,
    })

    if (candidates.length === 0) {
      return { suggestions: [], targetIds: [] }
    }

    const targetIds = candidates.map((c) => c.id)
    const candidateIds = new Set(targetIds)
    const priorFeedback = (input.priorSelections ?? []).filter((p) =>
      candidateIds.has(p.expenseId),
    )

    const { getRecentExpenseContext } =
      await import('../../../../lib/ai/context')
    const recentContext = await getRecentExpenseContext(input.groupId)
    const system = buildCategorizationSystemPrompt({
      recentExpenses: recentContext.expenses,
      locale: input.locale,
      groupContext: recentContext.group,
    })

    // Chunk the candidates to keep individual prompts small enough
    // for 3.5-turbo to stay deterministic.
    const chunks = chunkCandidates(candidates, BULK_PREVIEW_CHUNK_SIZE)
    const suggestions: BulkPreviewResponse['suggestions'] = []
    const seenIds = new Set<string>()

    for (const chunk of chunks) {
      const userContent = renderPreviewChunkPrompt({
        chunk,
        priorFeedback,
      })
      const raw = await callBulkCategorizationModel({
        operation: 'bulk-preview',
        candidateCount: chunk.length,
        priorFeedbackCount: priorFeedback.length,
        prompt: {
          model: env.AI_CATEGORY_MODEL,
          temperature: 0.1,
          instructions: system,
          prompt: userContent,
        },
      })
      let parsed: BulkPreviewResponse
      try {
        const obj = JSON.parse(raw ?? '{}')
        // The schema rejects unknown category ids, so a model
        // hallucination produces a parse error instead of an
        // untyped row.
        parsed = bulkPreviewResponseSchema.parse({
          suggestions: Array.isArray(obj.suggestions)
            ? obj.suggestions.filter(
                (
                  s: unknown,
                ): s is {
                  expenseId: string
                  suggestedCategoryId: string
                  confidence: string
                } =>
                  typeof s === 'object' &&
                  s !== null &&
                  typeof (s as { expenseId?: unknown }).expenseId ===
                    'string' &&
                  typeof (s as { suggestedCategoryId?: unknown })
                    .suggestedCategoryId === 'string' &&
                  typeof (s as { confidence?: unknown }).confidence ===
                    'string',
              )
            : [],
        })
      } catch (error) {
        // Skip this chunk; the UI shows the surviving rows and
        // the admin can correct the rest manually.
        continue
      }
      for (const s of parsed.suggestions) {
        if (!candidateIds.has(s.expenseId)) continue
        if (seenIds.has(s.expenseId)) continue
        seenIds.add(s.expenseId)
        suggestions.push(s)
      }
    }

    return { suggestions, targetIds }
  })

function chunkCandidates(
  candidates: BulkCategorizeCandidateRow[],
  chunkSize: number,
): BulkCategorizeCandidateRow[][] {
  const chunks: BulkCategorizeCandidateRow[][] = []
  for (let i = 0; i < candidates.length; i += chunkSize) {
    chunks.push(candidates.slice(i, i + chunkSize))
  }
  return chunks
}

function renderPreviewChunkPrompt(args: {
  chunk: BulkCategorizeCandidateRow[]
  priorFeedback: Array<{ expenseId: string; categoryId: string }>
}): string {
  const list = args.chunk
    .map((c, i) => {
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
    'Bulk-categorize preview chunk.',
    '',
    'For every entry you can categorize with useful confidence, return a single object {expenseId, suggestedCategoryId, confidence} where confidence is exactly one lowercase value: "high", "medium", or "low".',
    'Leave an expense out entirely when you are not confident enough to categorize it. The client will keep missing rows uncategorized.',
    'Return exactly one JSON object with a suggestions array. Always include the suggestions key, even when it is empty.',
    '',
    ...(feedback
      ? [
          'Ground-truth corrections threaded from prior calibration rounds (use these as anchors when in doubt):',
          feedback,
          '',
        ]
      : []),
    'Chunk:',
    list,
  ].join('\n')
}
