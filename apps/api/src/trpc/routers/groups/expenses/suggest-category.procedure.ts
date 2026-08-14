import { z } from 'zod'

import { categoryIdSchema } from '@spliit/domain'

import { suggestExpenseCategory } from '../../../../lib/api/expenses/suggest-category'
import {
  enforceCategoryAiRequestLimit,
  loadGroupMutationContext,
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
    }),
  )
  .output(suggestCategoryOutputSchema)
  .mutation(async ({ input, ctx }) => {
    await loadGroupMutationContext({
      groupId: input.groupId,
      accountId: ctx.auth.user.id,
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
