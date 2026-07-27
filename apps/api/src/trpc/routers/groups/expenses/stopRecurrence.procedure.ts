import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { stopRecurrence } from '../../../../lib/api'
import { loadGroupContext, protectedProcedure } from '../../../init'
import { deleteExpenseOutputSchema } from '../../../outputs/expenses'

export const stopRecurrenceProcedure = protectedProcedure
  .input(
    z.object({
      expenseId: z.string().min(1),
      groupId: z.string().min(1),
    }),
  )
  .output(deleteExpenseOutputSchema)
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
    await stopRecurrence(groupId, expenseId, { accountId: ctx.auth.user.id })
    return {}
  })
