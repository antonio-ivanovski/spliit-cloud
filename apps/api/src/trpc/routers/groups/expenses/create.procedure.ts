import { expenseFormSchema } from '@spliit/domain'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { createExpense } from '../../../../lib/api'
import { loadGroupContext, protectedProcedure } from '../../../init'

export const createGroupExpenseProcedure = protectedProcedure
  .input(
    z.object({
      groupId: z.string().min(1),
      expenseFormValues: expenseFormSchema,
    }),
  )
  .mutation(async ({ input: { groupId, expenseFormValues }, ctx }) => {
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
    const expense = await createExpense(expenseFormValues, groupId, {
      accountId: account.id,
      displayName: account.name,
    })
    return { expenseId: expense.id }
  })
