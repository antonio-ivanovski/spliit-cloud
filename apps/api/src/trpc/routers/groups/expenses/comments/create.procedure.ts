import { TRPCError } from '@trpc/server'
import { z } from 'zod'

import { createExpenseComment } from '../../../../../lib/api'
import { loadGroupContext, protectedProcedure } from '../../../../init'
import { createExpenseCommentOutputSchema } from '../../../../outputs/expense-comments'

export const createExpenseCommentProcedure = protectedProcedure
  .input(
    z.object({
      groupId: z.string().min(1),
      expenseId: z.string().min(1),
      body: z.string().trim().min(1).max(500),
    }),
  )
  .output(createExpenseCommentOutputSchema)
  .mutation(async ({ input, ctx }) => {
    const { group } = await loadGroupContext({
      groupId: input.groupId,
      accountId: ctx.auth.user.id,
    })
    if (group.archived) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'This group is archived and comments cannot be added',
      })
    }
    const result = await createExpenseComment({
      groupId: input.groupId,
      expenseId: input.expenseId,
      authorAccountId: ctx.auth.user.id,
      authorName: ctx.auth.user.name,
      text: input.body,
    })
    return {
      comment: {
        id: result.comment.id,
        body: result.comment.text,
        createdAt: result.comment.createdAt,
        author: {
          accountId: result.comment.authorAccountId,
          name: result.comment.authorName,
          image: result.comment.authorImage,
        },
        canDelete: true,
      },
    }
  })
