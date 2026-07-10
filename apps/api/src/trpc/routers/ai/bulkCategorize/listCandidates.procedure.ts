import { BULK_PREVIEW_MAX_TARGETS } from '@spliit/domain'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { listBulkCategorizeCandidates } from '../../../../lib/api/category-bulk'
import { loadGroupContext, protectedProcedure } from '../../../init'

/**
 * Cheap, no-AI listing of expenses eligible for bulk categorization.
 * Used by the page on mount so the admin sees the candidate count
 * before spending an OpenAI call on calibration.
 */
export const aiBulkCategorizeListCandidatesProcedure = protectedProcedure
  .input(
    z.object({
      groupId: z.string().min(1),
      fromCategoryId: z.string().min(1).optional(),
    }),
  )
  .query(async ({ ctx, input }) => {
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

    return {
      totalEligible: candidates.length,
      candidates: candidates.map((c) => ({
        id: c.id,
        title: c.title,
        expenseDate: c.expenseDate.toISOString(),
        amount: c.amount,
        categoryId: c.categoryId,
      })),
      capped: candidates.length >= BULK_PREVIEW_MAX_TARGETS,
    }
  })
