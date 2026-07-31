import { TRPCError } from '@trpc/server'
import { z } from 'zod'

import { expenseApiSchema } from '@spliit/domain'

import { getExpense } from '../../../../lib/api/expenses/queries'
import { updateExpense } from '../../../../lib/api/expenses/update-expense'
import {
  assertCanManageOwnedResource,
  expenseOwnerAccountId,
} from '../../../../lib/api/resource-permissions'
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
    const { group, member } = await loadGroupContext({
      groupId,
      accountId: ctx.auth.user.id,
    })
    if (group.archived) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'This group is archived and expenses cannot be modified',
      })
    }
    const existingExpense = await getExpense(groupId, expenseId)
    if (!existingExpense) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Expense not found' })
    }
    assertCanManageOwnedResource(
      {
        role: member.role,
        accountId: ctx.auth.user.id,
        createdByAccountId: expenseOwnerAccountId(existingExpense),
      },
      'You can only edit expenses you created',
    )
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
