import { TRPCError } from '@trpc/server'
import { z } from 'zod'

import { categoryIdSchema } from '@spliit/domain'

import { getRecentExpenseContext } from '../../../lib/ai/context'
import { env } from '../../../lib/env'
import { extractExpenseInformationFromImage } from '../../../lib/receipt-actions'
import {
  enforceAiRequestLimit,
  loadGroupViewer,
  protectedProcedure,
} from '../../init'
import { extractExpenseInformationOutputSchema } from '../../outputs/ai'

export const extractExpenseInformationFromImageProcedure = protectedProcedure
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
    if (!env.PUBLIC_ENABLE_RECEIPT_EXTRACT) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'Receipt extraction is disabled',
      })
    }
    await loadGroupViewer({
      groupId: input.groupId,
      accountId: ctx.auth.user.id,
      accountEmail: ctx.auth.user.email,
      linkTokenHash: null,
    })
    const context = await getRecentExpenseContext(input.groupId)
    enforceAiRequestLimit(
      ctx.auth.user.id,
      'ai.extractExpenseInformationFromImage',
      ctx.resHeaders,
    )

    const result = await extractExpenseInformationFromImage(
      input.imageUrl,
      {
        currency: input.currency,
        currencyCode: input.currencyCode,
      },
      {
        recentExpenses: context.expenses,
        groupContext: context.group,
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
