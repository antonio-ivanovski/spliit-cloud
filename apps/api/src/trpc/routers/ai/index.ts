import { z } from 'zod'
import { extractCategoryFromTitle } from '../../../lib/expense-form-actions'
import { extractExpenseInformationFromImage } from '../../../lib/receipt-actions'
import { baseProcedure, createTRPCRouter } from '../../init'

export const aiRouter = createTRPCRouter({
  extractCategoryFromTitle: baseProcedure
    .input(z.object({ description: z.string() }))
    .mutation(({ input }) => extractCategoryFromTitle(input.description)),
  extractExpenseInformationFromImage: baseProcedure
    .input(
      z.object({
        imageUrl: z.string().url(),
        currency: z.string(),
        currencyCode: z.string().nullish(),
      }),
    )
    .mutation(({ input }) =>
      extractExpenseInformationFromImage(input.imageUrl, {
        currency: input.currency,
        currencyCode: input.currencyCode,
      }),
    ),
})
