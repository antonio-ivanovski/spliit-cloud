import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { deleteExpense } from '../../../../lib/api'
import { loadGroupContext, protectedProcedure } from '../../../init'

export const deleteGroupExpenseProcedure = protectedProcedure
  .input(
    z.object({
      expenseId: z.string().min(1),
      groupId: z.string().min(1),
    }),
  )
  .mutation(async ({ input: { expenseId, groupId }, ctx }) => {
    const { group } = await loadGroupContext({
      groupId,
      accountId: ctx.auth.user.id,
    })
    if (group.archived) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'This group is archived and expenses cannot be modified',
      })
    }
    await deleteExpense(groupId, expenseId, {
      accountId: ctx.auth.user.id,
    })
    return {}
  })
