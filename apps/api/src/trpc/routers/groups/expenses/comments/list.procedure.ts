import { TRPCError } from '@trpc/server'
import { z } from 'zod'

import { getExpenseComments } from '../../../../../lib/api'
import { redactViewerDisplayName } from '../../../../../lib/group-view'
import {
  groupAccessFields,
  groupReadProcedure,
  groupViewerArgs,
  loadGroupViewer,
} from '../../../../init'
import { listExpenseCommentsOutputSchema } from '../../../../outputs/expense-comments'

export const listExpenseCommentsProcedure = groupReadProcedure
  .input(
    z.object({
      groupId: z.string().min(1),
      expenseId: z.string().min(1),
      ...groupAccessFields,
    }),
  )
  .output(listExpenseCommentsOutputSchema)
  .query(async ({ input, ctx }) => {
    const { group, viewer } = await loadGroupViewer(groupViewerArgs(input, ctx))
    const comments = await getExpenseComments(group.id, input.expenseId)
    if (!comments) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Expense not found' })
    }
    return {
      comments: comments.map((comment) => ({
        id: comment.id,
        body: comment.text,
        createdAt: comment.createdAt,
        author: {
          accountId:
            viewer.kind === 'ACTIVE' ? comment.authorAccountId : 'public',
          name:
            viewer.kind === 'ACTIVE'
              ? comment.authorName
              : redactViewerDisplayName(comment.authorName),
          image: comment.authorImage,
        },
        canDelete:
          !group.archived &&
          viewer.kind === 'ACTIVE' &&
          comment.authorAccountId === ctx.auth?.user.id,
      })),
    }
  })
