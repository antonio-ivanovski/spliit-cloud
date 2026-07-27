import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import {
  deleteExpenseComment,
  findExpenseComment,
} from '../../../../../lib/api'
import { loadGroupContext, protectedProcedure } from '../../../../init'
import { deleteExpenseCommentOutputSchema } from '../../../../outputs/expense-comments'

export const deleteExpenseCommentProcedure = protectedProcedure
  .input(
    z.object({
      groupId: z.string().min(1),
      expenseId: z.string().min(1),
      commentId: z.string().min(1),
    }),
  )
  .output(deleteExpenseCommentOutputSchema)
  .mutation(async ({ input, ctx }) => {
    const { group } = await loadGroupContext({
      groupId: input.groupId,
      accountId: ctx.auth.user.id,
    })
    if (group.archived) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'This group is archived and comments cannot be deleted',
      })
    }
    const comment = await findExpenseComment(input)
    if (!comment) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Comment not found' })
    }
    if (comment.authorAccountId !== ctx.auth.user.id) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Only the author can delete this comment',
      })
    }
    await deleteExpenseComment(comment.id)
    return {}
  })
