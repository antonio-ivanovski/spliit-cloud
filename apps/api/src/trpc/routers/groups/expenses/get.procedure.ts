import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { getExpense } from '../../../../lib/api'
import {
  hashLinkInviteToken,
  linkInviteTokenInput,
  loadGroupViewer,
  protectedProcedure,
} from '../../../init'

export const getGroupExpenseProcedure = protectedProcedure
  .input(
    z.object({
      groupId: z.string().min(1),
      expenseId: z.string().min(1),
      linkInviteToken: linkInviteTokenInput,
    }),
  )
  .query(async ({ input: { groupId, expenseId, linkInviteToken }, ctx }) => {
    await loadGroupViewer({
      groupId,
      accountId: ctx.auth.user.id,
      accountEmail: ctx.auth.user.email,
      linkTokenHash: await hashLinkInviteToken(linkInviteToken),
    })
    const expense = await getExpense(groupId, expenseId)
    if (!expense) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'Expense not found',
      })
    }
    return { expense }
  })
