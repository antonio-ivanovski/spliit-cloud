import { z } from 'zod'

import { getRecentExpenseContext } from '../../../lib/ai/context'
import { extractCategoryFromTitle } from '../../../lib/expense-form-actions'
import { hashLinkToken } from '../../../lib/invitations/link-invitations'
import { baseProcedure, loadGroupViewer } from '../../init'
import { extractCategoryOutputSchema } from '../../outputs/ai'

export const extractCategoryFromTitleProcedure = baseProcedure
  .input(
    z.object({
      description: z.string(),
      groupId: z.string().min(1),
      locale: z.string().optional(),
      linkInviteToken: z
        .string()
        .optional()
        .describe(
          'Raw link-invite token from the share URL. Grants access for pending link-invitees.',
        ),
    }),
  )
  .output(extractCategoryOutputSchema)
  .mutation(async ({ input, ctx }) => {
    const linkTokenHash = input.linkInviteToken
      ? await hashLinkToken(input.linkInviteToken)
      : null
    const accountId = ctx.auth?.user.id ?? ''
    const accountEmail = ctx.auth?.user.email ?? ''

    let recentExpenses: Awaited<
      ReturnType<typeof getRecentExpenseContext>
    >['expenses'] = []
    let groupContext: Awaited<
      ReturnType<typeof getRecentExpenseContext>
    >['group'] = { name: '', currency: '$', currencyCode: null }
    if (ctx.auth || input.linkInviteToken) {
      await loadGroupViewer({
        groupId: input.groupId,
        accountId,
        accountEmail,
        linkTokenHash,
      })
      const context = await getRecentExpenseContext(input.groupId)
      recentExpenses = context.expenses
      groupContext = context.group
    }

    return extractCategoryFromTitle(input.description, {
      recentExpenses,
      groupContext,
      locale: input.locale,
    })
  })
