import { expenseApiSchema } from '@spliit/domain'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { createExpense } from '../../../../lib/api'
import { loadGroupContext, protectedProcedure } from '../../../init'

export const createGroupExpenseProcedure = protectedProcedure
  .input(
    z.object({
      groupId: z.string().min(1),
      expense: expenseApiSchema,
    }),
  )
  .mutation(async ({ input: { groupId, expense }, ctx }) => {
    const { group } = await loadGroupContext({
      groupId,
      accountId: ctx.auth.user.id,
    })
    if (group.archived) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'This group is archived and no new expenses can be added',
      })
    }
    const account = ctx.auth.user
    const { id: expenseId } = await createExpense(expense, groupId, {
      accountId: account.id,
    })
    return { expenseId }
  })
