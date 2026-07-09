import { expenseApiSchema } from '@spliit/domain'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { updateExpense } from '../../../../lib/api'
import { ConversionError } from '../../../../lib/expense-conversion'
import { loadGroupContext, protectedProcedure } from '../../../init'

export const updateGroupExpenseProcedure = protectedProcedure
  .input(
    z.object({
      expenseId: z.string().min(1),
      groupId: z.string().min(1),
      expense: expenseApiSchema,
    }),
  )
  .mutation(async ({ input: { expenseId, groupId, expense }, ctx }) => {
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
    try {
      const { id } = await updateExpense(groupId, expenseId, expense, {
        accountId: ctx.auth.user.id,
      })
      return { expenseId: id }
    } catch (err) {
      if (err instanceof ConversionError) {
        throw new TRPCError({
          code:
            err.code === 'PROVIDER_UNAVAILABLE' ? 'BAD_GATEWAY' : 'BAD_REQUEST',
          message: err.message,
        })
      }
      throw err
    }
  })
