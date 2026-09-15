import { TRPCError } from '@trpc/server'
import { z } from 'zod'

import { expenseApiSchema } from '@spliit/domain'

import {
  DestructiveEditUnknownError,
  findDroppedOccurrenceIds,
  findRemovedExpenseDocuments,
} from '../../../../lib/api/expenses/destructive-edit'
import { getExpense } from '../../../../lib/api/expenses/queries'
import {
  ExpenseVersionConflictError,
  updateExpense,
} from '../../../../lib/api/expenses/update-expense'
import {
  assertCanManageOwnedResource,
  expenseOwnerAccountId,
} from '../../../../lib/api/resource-permissions'
import { enqueueBudgetEvaluation } from '../../../../lib/budgets/enqueue'
import { ConversionError } from '../../../../lib/expense-conversion'
import {
  apiProcedure,
  assertScopeForDestructiveEdit,
  loadGroupMutationContext,
  type ConditionalScope,
} from '../../../init'
import { updateExpenseOutputSchema } from '../../../outputs/expenses'

export const updateExpenseConditionalScopes: ConditionalScope[] = [
  {
    scope: 'spliit:expenses:delete',
    when: 'the edit removes stored receipt documents or a THIS_AND_FUTURE reschedule drops occurrences',
  },
]

export const updateGroupExpenseProcedure = apiProcedure(
  'spliit:expenses:manage',
  { conditionalScopes: updateExpenseConditionalScopes },
)
  .input(
    z.object({
      expenseId: z.string().min(1),
      groupId: z.string().min(1),
      expectedVersion: z.number().int().positive(),
      expense: expenseApiSchema,
      scope: z.enum(['OCCURRENCE', 'THIS_AND_FUTURE']).optional(),
    }),
  )
  .output(updateExpenseOutputSchema)
  .mutation(
    async ({
      input: { expenseId, groupId, expectedVersion, expense, scope },
      ctx,
    }) => {
      const { group, member } = await loadGroupMutationContext({
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
      // Deleting needs the delete scope, whatever the verb on the procedure
      // says. An update that omits existing documents deletes their rows and
      // stored objects; a `THIS_AND_FUTURE` edit that tightens the schedule
      // drops the occurrences that no longer fit. Gate on what the edit
      // actually destroys — checked before any side effect — so harmless
      // recurring edits (a title change across the series) stay on manage.
      const removesDocuments =
        findRemovedExpenseDocuments(existingExpense, expense).length > 0
      let dropsOccurrences = false
      try {
        dropsOccurrences =
          scope === 'THIS_AND_FUTURE' &&
          (await findDroppedOccurrenceIds(existingExpense, expense)).length > 0
      } catch (err) {
        if (err instanceof DestructiveEditUnknownError) {
          // Fail closed when the schedule cannot be compared.
          assertScopeForDestructiveEdit(ctx.auth)
        } else {
          throw err
        }
      }
      if (removesDocuments || dropsOccurrences) {
        assertScopeForDestructiveEdit(ctx.auth)
      }
      try {
        const { id, version } = await updateExpense(
          groupId,
          expenseId,
          expense,
          {
            accountId: ctx.auth.user.id,
          },
          { expectedVersion, scope },
        )
        await enqueueBudgetEvaluation(groupId)
        return { expenseId: id, version }
      } catch (err) {
        if (err instanceof ConversionError) {
          throw new TRPCError({
            code:
              err.code === 'PROVIDER_UNAVAILABLE'
                ? 'BAD_GATEWAY'
                : 'BAD_REQUEST',
            message: err.message,
          })
        }
        if (err instanceof ExpenseVersionConflictError) {
          throw new TRPCError({ code: 'CONFLICT', message: err.message })
        }
        throw err
      }
    },
  )
