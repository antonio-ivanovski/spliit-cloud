import { expenseApiSchema } from '@spliit/domain'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { updateExpense } from '../../../../lib/api'
import { loadGroupContext, protectedProcedure } from '../../../init'

export const updateGroupExpenseProcedure = protectedProcedure
  .input(
    z.object({
      expenseId: z.string().min(1),
      groupId: z.string().min(1),
      expenseFormValues: expenseApiSchema,
    }),
  )
  .mutation(
    async ({ input: { expenseId, groupId, expenseFormValues }, ctx }) => {
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
      const expense = await updateExpense(
        groupId,
        expenseId,
        expenseFormValues,
        { accountId: ctx.auth.user.id },
      )
      return { expenseId: expense.id }
    },
  )
