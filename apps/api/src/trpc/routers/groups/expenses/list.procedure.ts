import { z } from 'zod'
import { getGroupExpenses } from '../../../../lib/api'
import {
  hashLinkInviteToken,
  linkInviteTokenInput,
  loadGroupViewer,
  protectedProcedure,
} from '../../../init'

export const listGroupExpensesProcedure = protectedProcedure
  .input(
    z.object({
      groupId: z.string().min(1),
      cursor: z.number().optional(),
      limit: z.number().optional(),
      filter: z.string().optional(),
      linkInviteToken: linkInviteTokenInput,
    }),
  )
  .query(
    async ({
      input: { groupId, cursor = 0, limit = 10, filter, linkInviteToken },
      ctx,
    }) => {
      await loadGroupViewer({
        groupId,
        accountId: ctx.auth.user.id,
        accountEmail: ctx.auth.user.email,
        linkTokenHash: await hashLinkInviteToken(linkInviteToken),
      })
      const expenses = await getGroupExpenses(groupId, {
        offset: cursor,
        length: limit + 1,
        filter,
      })
      return {
        expenses: expenses.slice(0, limit).map((expense) => ({
          ...expense,
          createdAt: new Date(expense.createdAt),
          expenseDate: new Date(expense.expenseDate),
        })),
        hasMore: !!expenses[limit],
        nextCursor: cursor + limit,
      }
    },
  )
