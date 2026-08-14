import { TRPCError } from '@trpc/server'
import { z } from 'zod'

import { getExpense } from '../../../../lib/api'
import { expensePermissions } from '../../../../lib/api/resource-permissions'
import { groupReadProcedure, loadGroupViewer } from '../../../init'
import { getExpenseOutputSchema } from '../../../outputs/expenses'

export const getGroupExpenseProcedure = groupReadProcedure
  .input(
    z.object({
      groupId: z.string().min(1),
      expenseId: z.string().min(1),
    }),
  )
  .output(getExpenseOutputSchema)
  .query(async ({ input: { groupId, expenseId }, ctx }) => {
    const { group, member, viewer } = await loadGroupViewer({
      groupId,
      accountId: ctx.auth?.user.id,
      accountEmail: ctx.auth?.user.email,
    })
    const expense = await getExpense(group.id, expenseId)
    if (!expense) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'Expense not found',
      })
    }
    const { createdByAccountId, ...publicExpense } = expense
    return {
      expense: {
        ...publicExpense,
        permissions:
          viewer.kind === 'ACTIVE' && member
            ? expensePermissions({
                role: member.role,
                accountId: ctx.auth?.user.id ?? '',
                createdByAccountId,
                recurringSeries: expense.recurringSeries,
                archived: group.archived,
              })
            : {
                canEdit: false,
                canDelete: false,
                canManageRecurrence: false,
              },
      },
    }
  })
