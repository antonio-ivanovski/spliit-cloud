import { TRPCError } from '@trpc/server'
import { z } from 'zod'

import { expenseApiSchema } from '@spliit/domain'

import { updateExpense } from '../../../../lib/api/expenses/update-expense'
import { enqueueBudgetEvaluation } from '../../../../lib/budgets/enqueue'
import { ConversionError } from '../../../../lib/expense-conversion'
import { loadGroupContext, protectedProcedure } from '../../../init'
import { updateExpenseOutputSchema } from '../../../outputs/expenses'

export const updateGroupExpenseProcedure = protectedProcedure
  .input(
    z.object({
      expenseId: z.string().min(1),
      groupId: z.string().min(1),
      expense: expenseApiSchema,
      scope: z.enum(['OCCURRENCE', 'THIS_AND_FUTURE']).optional(),
    }),
  )
  .output(updateExpenseOutputSchema)
  .mutation(async ({ input: { expenseId, groupId, expense, scope }, ctx }) => {
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
      const { id } = await updateExpense(
        groupId,
        expenseId,
        expense,
        {
          accountId: ctx.auth.user.id,
        },
        { scope },
      )
      await enqueueBudgetEvaluation(groupId)
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
