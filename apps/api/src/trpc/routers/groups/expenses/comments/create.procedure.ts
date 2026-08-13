import { TRPCError } from '@trpc/server'
import { z } from 'zod'

import { createExpenseComment } from '../../../../../lib/api'
import { getApiBoss } from '../../../../../lib/api/boss'
import {
  CREATE_OPERATIONS,
  createRequestIdSchema,
  runIdempotentCreate,
} from '../../../../../lib/api/idempotency'
import { loadGroupMutationContext, protectedProcedure } from '../../../../init'
import { createExpenseCommentOutputSchema } from '../../../../outputs/expense-comments'

export const createExpenseCommentProcedure = protectedProcedure
  .input(
    z.object({
      groupId: z.string().min(1),
      expenseId: z.string().min(1),
      requestId: createRequestIdSchema,
      body: z.string().trim().min(1).max(500),
    }),
  )
  .output(createExpenseCommentOutputSchema)
  .mutation(async ({ input, ctx }) => {
    const { group } = await loadGroupMutationContext({
      groupId: input.groupId,
      accountId: ctx.auth.user.id,
    })
    if (group.archived) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'This group is archived and comments cannot be added',
      })
    }
    const { value } = await runIdempotentCreate({
      accountId: ctx.auth.user.id,
      operation: CREATE_OPERATIONS.expenseComment,
      requestId: input.requestId,
      input: {
        groupId: input.groupId,
        expenseId: input.expenseId,
        body: input.body,
      },
      prepare: getApiBoss,
      execute: async (tx, notificationBoss) => {
        const result = await createExpenseComment({
          groupId: input.groupId,
          expenseId: input.expenseId,
          authorAccountId: ctx.auth.user.id,
          authorName: ctx.auth.user.name,
          text: input.body,
          notificationBoss,
          tx,
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
      },
    })
    return value
  })
