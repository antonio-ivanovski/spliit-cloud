import { z } from 'zod'

import { categoryIdSchema } from '@spliit/domain'

import { suggestExpenseCategory } from '../../../../lib/api/expenses/suggest-category'
import {
  hashLinkInviteToken,
  enforceCategoryAiRequestLimit,
  linkInviteTokenInput,
  loadGroupViewer,
  protectedProcedure,
} from '../../../init'

export const suggestCategoryOutputSchema = z.object({
  categoryId: categoryIdSchema.nullable(),
})

export const suggestCategoryProcedure = protectedProcedure
  .input(
    z.object({
      groupId: z.string().min(1),
      title: z.string().trim().min(1),
      locale: z.string().optional(),
      allowAi: z.boolean().optional(),
      linkInviteToken: linkInviteTokenInput.describe(
        'Raw link-invite token from the share URL. Grants read access to pending link-invitees.',
      ),
    }),
  )
  .output(suggestCategoryOutputSchema)
  .mutation(async ({ input, ctx }) => {
    await loadGroupViewer({
      groupId: input.groupId,
      accountId: ctx.auth.user.id,
      accountEmail: ctx.auth.user.email,
      linkTokenHash: await hashLinkInviteToken(input.linkInviteToken),
    })
    return suggestExpenseCategory({
      groupId: input.groupId,
      title: input.title,
      locale: input.locale,
      allowAi: input.allowAi,
      beforeAi: () =>
        enforceCategoryAiRequestLimit(
          ctx.auth.user.id,
          'groups.expenses.suggestCategory',
          ctx.resHeaders,
        ),
    })
  })
