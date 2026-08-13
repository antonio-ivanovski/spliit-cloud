import { TRPCError } from '@trpc/server'
import { z } from 'zod'

import { getExpense } from '../../../../lib/api'
import { expensePermissions } from '../../../../lib/api/resource-permissions'
import {
  hashLinkInviteToken,
  groupReadProcedure,
  linkInviteTokenInput,
  loadGroupViewer,
} from '../../../init'
import { getExpenseOutputSchema } from '../../../outputs/expenses'

export const getGroupExpenseProcedure = groupReadProcedure
  .input(
    z.object({
      groupId: z.string().min(1),
      expenseId: z.string().min(1),
      linkInviteToken: linkInviteTokenInput.describe(
        'Raw link-invite token from the share URL. Grants read access to pending link-invitees.',
      ),
    }),
  )
  .output(getExpenseOutputSchema)
  .query(async ({ input: { groupId, expenseId, linkInviteToken }, ctx }) => {
    const { group, member, viewer } = await loadGroupViewer({
      groupId,
      accountId: ctx.auth?.user.id,
      accountEmail: ctx.auth?.user.email,
      linkTokenHash: await hashLinkInviteToken(linkInviteToken),
      viewerSession: ctx.groupViewerSession,
    })
    const expense = await getExpense(groupId, expenseId)
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
