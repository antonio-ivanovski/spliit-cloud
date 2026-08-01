import { z } from 'zod'

import { categoryIdSchema } from '@spliit/domain'

import { getRecentExpenseContext } from '../../../lib/ai/context'
import { extractExpenseInformationFromImage } from '../../../lib/receipt-actions'
import { baseProcedure, loadGroupViewer } from '../../init'
import { extractExpenseInformationOutputSchema } from '../../outputs/ai'

export const extractExpenseInformationFromImageProcedure = baseProcedure
  .input(
    z.object({
      imageUrl: z.url(),
      currency: z.string(),
      currencyCode: z.string().nullish(),
      groupId: z.string().min(1),
      locale: z.string().optional(),
      translateToLocale: z.boolean().optional().default(false),
      currentExpense: z
        .object({
          title: z.string().optional(),
          amount: z.number().optional(),
          date: z.string().optional(),
          currencyCode: z.string().optional(),
          categoryId: z.string().optional(),
          items: z
            .array(
              z.object({
                title: z.string(),
                unitPrice: z.number(),
                quantity: z.number(),
              }),
            )
            .optional(),
        })
        .optional()
        .describe(
          'Existing expense fields to refine the extraction (optional context for the AI).',
        ),
    }),
  )
  .output(extractExpenseInformationOutputSchema)
  .mutation(async ({ input, ctx }) => {
    let recentExpenses: Awaited<
      ReturnType<typeof getRecentExpenseContext>
    >['expenses'] = []
    let groupContext:
      | Awaited<ReturnType<typeof getRecentExpenseContext>>['group']
      | undefined

    if (ctx.auth) {
      await loadGroupViewer({
        groupId: input.groupId,
        accountId: ctx.auth.user.id,
        accountEmail: ctx.auth.user.email,
        linkTokenHash: null,
      })
      const context = await getRecentExpenseContext(input.groupId)
      recentExpenses = context.expenses
      groupContext = context.group
    }

    const result = await extractExpenseInformationFromImage(
      input.imageUrl,
      {
        currency: input.currency,
        currencyCode: input.currencyCode,
      },
      {
        recentExpenses,
        groupContext,
        locale: input.locale,
        translateToLocale: input.translateToLocale,
        currentExpense: input.currentExpense,
      },
    )
    const categoryId = categoryIdSchema.safeParse(result.categoryId)
    return {
      ...result,
      categoryId: categoryId.success ? categoryId.data : null,
    }
  })
