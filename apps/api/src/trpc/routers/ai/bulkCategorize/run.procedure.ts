import { TRPCError } from '@trpc/server'
import { z } from 'zod'

import { prisma } from '@spliit/db'
import { SETTLEMENT_CATEGORY_ID, categoryIdSchema } from '@spliit/domain'
import { env as jobsEnv } from '@spliit/jobs'

import {
  applyCategorizationRun,
  confirmCalibrationRound,
  countUncategorizedExpenses,
  discardCategorizationRun,
  getCategorizationReviewPage,
  getCategorizationSaveConflicts,
  presentRun,
  retryCategorizationRun,
  rerunCategorizationRun,
  startCategorizationRun,
  updateRunSuggestions,
} from '../../../../lib/api/bulk-categorization-run'
import { loadGroupMutationContext, protectedProcedure } from '../../../init'

const groupInput = z.object({ groupId: z.string().min(1) })
const runInput = groupInput.extend({ runId: z.string().min(1) })
const revisionInput = runInput.extend({
  revision: z.number().int().nonnegative(),
})
const assignableCategorySchema = categoryIdSchema.refine(
  (id) => id !== SETTLEMENT_CATEGORY_ID,
)

async function requireAdmin(groupId: string, accountId: string) {
  const { member, group } = await loadGroupMutationContext({
    groupId,
    accountId,
  })
  if (member.role !== 'ADMIN' || group.archived) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Only admins can categorize active groups',
    })
  }
}

async function requireRun(groupId: string, runId: string) {
  const run = await prisma.bulkCategorizationRun.findUnique({
    where: { id: runId },
  })
  if (!run || run.groupId !== groupId)
    throw new TRPCError({ code: 'NOT_FOUND' })
  return run
}

export const bulkCategorizeStatusProcedure = protectedProcedure
  .input(groupInput)
  .query(async ({ ctx, input }) => {
    await requireAdmin(input.groupId, ctx.auth.user.id)
    return presentRun(
      await prisma.bulkCategorizationRun.findUnique({
        where: { groupId: input.groupId },
      }),
    )
  })

export const bulkCategorizeCountProcedure = protectedProcedure
  .input(groupInput)
  .query(async ({ ctx, input }) => {
    await requireAdmin(input.groupId, ctx.auth.user.id)
    return countUncategorizedExpenses(input.groupId)
  })

export const bulkCategorizeReviewPageProcedure = protectedProcedure
  .input(
    runInput.extend({
      cursor: z.number().int().nonnegative().optional(),
      limit: z.number().int().min(1).max(100).optional(),
      reviewCycle: z.string().nullable().optional(),
      filter: z.enum(['all', 'general']).default('all'),
    }),
  )
  .query(async ({ ctx, input }) => {
    await requireAdmin(input.groupId, ctx.auth.user.id)
    await requireRun(input.groupId, input.runId)
    return getCategorizationReviewPage(
      input.runId,
      input.cursor,
      input.limit,
      input.filter,
    )
  })

export const bulkCategorizeSaveConflictsProcedure = protectedProcedure
  .input(runInput)
  .query(async ({ ctx, input }) => {
    await requireAdmin(input.groupId, ctx.auth.user.id)
    await requireRun(input.groupId, input.runId)
    return getCategorizationSaveConflicts(input.runId)
  })

export const bulkCategorizeStartProcedure = protectedProcedure
  .input(
    groupInput.extend({
      mode: z.enum(['local', 'system-one']),
      locale: z.string().optional(),
    }),
  )
  .mutation(async ({ ctx, input }) => {
    await requireAdmin(input.groupId, ctx.auth.user.id)
    if (!jobsEnv.JOBS_ENABLED)
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Background jobs are unavailable',
      })
    return startCategorizationRun({
      groupId: input.groupId,
      accountId: ctx.auth.user.id,
      mode: input.mode,
      locale: input.locale ?? 'en-US',
    })
  })

export const bulkCategorizeEditProcedure = protectedProcedure
  .input(
    revisionInput.extend({
      changes: z
        .array(
          z.object({
            expenseId: z.string(),
            categoryId: assignableCategorySchema,
          }),
        )
        .max(2000),
    }),
  )
  .mutation(async ({ ctx, input }) => {
    await requireAdmin(input.groupId, ctx.auth.user.id)
    await requireRun(input.groupId, input.runId)
    return updateRunSuggestions(input.runId, input.revision, input.changes)
  })

export const bulkCategorizeApplyProcedure = protectedProcedure
  .input(
    revisionInput.extend({
      skipExpenseIds: z.array(z.string().min(1)).max(10_000).optional(),
    }),
  )
  .mutation(async ({ ctx, input }) => {
    await requireAdmin(input.groupId, ctx.auth.user.id)
    await requireRun(input.groupId, input.runId)
    return applyCategorizationRun(
      input.runId,
      input.revision,
      ctx.auth.user.id,
      input.skipExpenseIds,
    )
  })

export const bulkCategorizeConfirmProcedure = protectedProcedure
  .input(revisionInput)
  .mutation(async ({ ctx, input }) => {
    await requireAdmin(input.groupId, ctx.auth.user.id)
    await requireRun(input.groupId, input.runId)
    await confirmCalibrationRound(input.runId, input.revision)
    return { confirmed: true }
  })

export const bulkCategorizeRerunProcedure = protectedProcedure
  .input(revisionInput)
  .mutation(async ({ ctx, input }) => {
    await requireAdmin(input.groupId, ctx.auth.user.id)
    await requireRun(input.groupId, input.runId)
    await rerunCategorizationRun(input.runId, input.revision)
    return { queued: true }
  })

export const bulkCategorizeRetryProcedure = protectedProcedure
  .input(revisionInput)
  .mutation(async ({ ctx, input }) => {
    await requireAdmin(input.groupId, ctx.auth.user.id)
    await requireRun(input.groupId, input.runId)
    await retryCategorizationRun(input.runId, input.revision)
    return { queued: true }
  })

export const bulkCategorizeDiscardProcedure = protectedProcedure
  .input(revisionInput)
  .mutation(async ({ ctx, input }) => {
    await requireAdmin(input.groupId, ctx.auth.user.id)
    await requireRun(input.groupId, input.runId)
    await discardCategorizationRun(input.runId, input.revision)
    return { discarded: true }
  })
