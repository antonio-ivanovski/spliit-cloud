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
  presentRun,
  retryCategorizationRun,
  rerunCategorizationRun,
  startCategorizationRun,
  updateRunSuggestions,
} from '../../../../lib/api/bulk-categorization-run'
import { loadGroupMutationContext, protectedProcedure } from '../../../init'

const groupInput = z.object({ groupId: z.string().min(1) })
const runInput = groupInput.extend({ runId: z.string().min(1) })
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

export const bulkCategorizeStartProcedure = protectedProcedure
  .input(
    groupInput.extend({
      mode: z.enum(['local', 'jev']),
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
    runInput.extend({
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
    return updateRunSuggestions(input.runId, input.changes)
  })

export const bulkCategorizeApplyProcedure = protectedProcedure
  .input(runInput)
  .mutation(async ({ ctx, input }) => {
    await requireAdmin(input.groupId, ctx.auth.user.id)
    await requireRun(input.groupId, input.runId)
    return applyCategorizationRun(input.runId)
  })

export const bulkCategorizeConfirmProcedure = protectedProcedure
  .input(runInput)
  .mutation(async ({ ctx, input }) => {
    await requireAdmin(input.groupId, ctx.auth.user.id)
    await requireRun(input.groupId, input.runId)
    await confirmCalibrationRound(input.runId)
    return { confirmed: true }
  })

export const bulkCategorizeRerunProcedure = protectedProcedure
  .input(runInput)
  .mutation(async ({ ctx, input }) => {
    await requireAdmin(input.groupId, ctx.auth.user.id)
    await requireRun(input.groupId, input.runId)
    await rerunCategorizationRun(input.runId)
    return { queued: true }
  })

export const bulkCategorizeRetryProcedure = protectedProcedure
  .input(runInput)
  .mutation(async ({ ctx, input }) => {
    await requireAdmin(input.groupId, ctx.auth.user.id)
    await requireRun(input.groupId, input.runId)
    await retryCategorizationRun(input.runId)
    return { queued: true }
  })

export const bulkCategorizeDiscardProcedure = protectedProcedure
  .input(runInput)
  .mutation(async ({ ctx, input }) => {
    await requireAdmin(input.groupId, ctx.auth.user.id)
    await requireRun(input.groupId, input.runId)
    await discardCategorizationRun(input.runId)
    return { discarded: true }
  })
