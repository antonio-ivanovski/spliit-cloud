import { z } from 'zod'

import { getGroupExpenses } from '../../../../lib/api'
import {
  hashLinkInviteToken,
  linkInviteTokenInput,
  loadGroupViewer,
  protectedProcedure,
} from '../../../init'
import { listExpensesOutputSchema } from '../../../outputs/expenses'

const matchModeSchema = z
  .enum(['any', 'all', 'exact'])
  .optional()
  .catch(undefined)

const listExpensesInputSchema = z.object({
  groupId: z.string().min(1),
  cursor: z.number().optional(),
  limit: z.number().optional(),
  filter: z.string().optional(),
  hideReimbursements: z.boolean().optional(),
  categories: z.array(z.string()).optional(),
  paidBy: z.array(z.string()).optional(),
  paidByMatch: matchModeSchema,
  paidFor: z.array(z.string()).optional(),
  paidForMatch: matchModeSchema,
  dateFrom: z.date().optional(),
  dateTo: z.date().optional(),
  minAmount: z.number().optional(),
  maxAmount: z.number().optional(),
  currencies: z.array(z.string()).optional(),
  sortBy: z
    .enum(['expenseDate', 'createdAt', 'amount'])
    .optional()
    .catch(undefined),
  sortDir: z.enum(['asc', 'desc']).optional().catch(undefined),
  linkInviteToken: linkInviteTokenInput.describe(
    'Raw link-invite token from the share URL. Grants read access to pending link-invitees.',
  ),
})

export const listGroupExpensesProcedure = protectedProcedure
  .input(listExpensesInputSchema)
  .output(listExpensesOutputSchema)
  .query(
    async ({
      input: {
        groupId,
        cursor = 0,
        limit = 10,
        filter,
        hideReimbursements,
        categories,
        paidBy,
        paidByMatch,
        paidFor,
        paidForMatch,
        dateFrom,
        dateTo,
        minAmount,
        maxAmount,
        currencies,
        sortBy,
        sortDir,
        linkInviteToken,
      },
      ctx,
    }) => {
      await loadGroupViewer({
        groupId,
        accountId: ctx.auth.user.id,
        accountEmail: ctx.auth.user.email,
        linkTokenHash: await hashLinkInviteToken(linkInviteToken),
      })
      const expenses = await getGroupExpenses(groupId, {
        offset: cursor,
        length: limit + 1,
        filter,
        hideReimbursements,
        categories,
        paidBy,
        paidByMatch,
        paidFor,
        paidForMatch,
        dateFrom,
        dateTo,
        minAmount,
        maxAmount,
        currencies,
        sortBy,
        sortDir,
      })
      return {
        expenses: expenses.slice(0, limit).map((expense) => ({
          ...expense,
          createdAt: new Date(expense.createdAt),
          expenseDate: new Date(expense.expenseDate),
        })),
        hasMore: !!expenses[limit],
        nextCursor: cursor + limit,
      }
    },
  )
