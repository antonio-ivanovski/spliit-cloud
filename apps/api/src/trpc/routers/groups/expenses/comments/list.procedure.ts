import { TRPCError } from '@trpc/server'
import { z } from 'zod'

import { getExpenseComments } from '../../../../../lib/api'
import {
  hashLinkInviteToken,
  groupReadProcedure,
  linkInviteTokenInput,
  loadGroupViewer,
} from '../../../../init'
import { listExpenseCommentsOutputSchema } from '../../../../outputs/expense-comments'

export const listExpenseCommentsProcedure = groupReadProcedure
  .input(
    z.object({
      groupId: z.string().min(1),
      expenseId: z.string().min(1),
      linkInviteToken: linkInviteTokenInput,
    }),
  )
  .output(listExpenseCommentsOutputSchema)
  .query(async ({ input, ctx }) => {
    const { group, viewer } = await loadGroupViewer({
      groupId: input.groupId,
      accountId: ctx.auth?.user.id,
      accountEmail: ctx.auth?.user.email,
      linkTokenHash: await hashLinkInviteToken(input.linkInviteToken),
      viewerSession: ctx.groupViewerSession,
    })
    const comments = await getExpenseComments(input.groupId, input.expenseId)
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
          name: comment.authorName,
          image: comment.authorImage,
        },
        canDelete:
          !group.archived &&
          viewer.kind === 'ACTIVE' &&
          comment.authorAccountId === ctx.auth?.user.id,
      })),
    }
  })
