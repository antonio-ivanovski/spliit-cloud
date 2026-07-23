import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { deleteExpense } from '../../../../lib/api'
import { loadGroupContext, protectedProcedure } from '../../../init'

export const deleteGroupExpenseProcedure = protectedProcedure
  .input(
    z
      .object({
        expenseId: z.string().min(1),
        groupId: z.string().min(1),
        scope: z.enum(['OCCURRENCE', 'THIS_AND_FUTURE']).optional(),
        stopRecurrence: z.boolean().optional(),
      })
      .superRefine((input, ctx) => {
        if (
          input.stopRecurrence !== undefined &&
          input.scope !== 'THIS_AND_FUTURE'
        ) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['stopRecurrence'],
            message: 'stopRecurrence is only valid with THIS_AND_FUTURE scope',
          })
        }
      }),
  )
  .mutation(
    async ({ input: { expenseId, groupId, scope, stopRecurrence }, ctx }) => {
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
      await deleteExpense(
        groupId,
        expenseId,
        {
          accountId: ctx.auth.user.id,
        },
        { scope, stopRecurrence },
      )
      return {}
    },
  )
