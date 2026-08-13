import { z } from 'zod'

import { getRecentExpenseContext } from '../../../../lib/ai/context'
import { env } from '../../../../lib/env'
import {
  hashLinkInviteToken,
  linkInviteTokenInput,
  loadGroupViewer,
  protectedProcedure,
} from '../../../init'

export const categoryMemoryOutputSchema = z.object({
  expenses: z.array(
    z.object({
      title: z.string(),
      categoryId: z.string(),
    }),
  ),
})

export const categoryMemoryProcedure = protectedProcedure
  .input(
    z.object({
      groupId: z.string().min(1),
      linkInviteToken: linkInviteTokenInput.describe(
        'Raw link-invite token from the share URL. Grants read access to pending link-invitees.',
      ),
    }),
  )
  .output(categoryMemoryOutputSchema)
  .query(async ({ input: { groupId, linkInviteToken }, ctx }) => {
    await loadGroupViewer({
      groupId,
      accountId: ctx.auth.user.id,
      accountEmail: ctx.auth.user.email,
      linkTokenHash: await hashLinkInviteToken(linkInviteToken),
    })
    const context = await getRecentExpenseContext(
      groupId,
      env.CATEGORY_MEMORY_LIMIT,
    )
    return { expenses: context.expenses }
  })
