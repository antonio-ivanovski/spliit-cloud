import { TRPCError } from '@trpc/server'
import { z } from 'zod'

import { expenseApiSchema } from '@spliit/domain'

import { createExpense } from '../../../../lib/api/expenses/create-expense'
import { enqueueBudgetEvaluation } from '../../../../lib/budgets/enqueue'
import { ConversionError } from '../../../../lib/expense-conversion'
import { loadGroupContext, protectedProcedure } from '../../../init'
import { createExpenseOutputSchema } from '../../../outputs/expenses'

export const createGroupExpenseProcedure = protectedProcedure
  .input(
    z.object({
      groupId: z.string().min(1),
      expense: expenseApiSchema,
    }),
  )
  .output(createExpenseOutputSchema)
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
    try {
      const created = await createExpense(expense, groupId, {
        accountId: account.id,
      })
      await enqueueBudgetEvaluation(groupId)
      return {
        expenseId: created.id,
        // Surface the series id so the web client can poll progress when
        // the series was created past-dated and the worker still has
        // occurrences to materialize.
        recurringSeriesId: created.recurringSeriesId ?? null,
      }
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
