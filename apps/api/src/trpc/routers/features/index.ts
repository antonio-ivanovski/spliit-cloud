import { z } from 'zod'

import { env } from '../../../lib/env'
import { baseProcedure, createTRPCRouter } from '../../init'

export const featuresRouter = createTRPCRouter({
  get: baseProcedure
    .output(
      z.object({
        enableExpenseDocuments: z.boolean(),
        enableReceiptExtract: z.boolean(),
        enableVoiceExpense: z.boolean(),
        enableCategoryExtract: z.boolean(),
        enableBulkCategorize: z.boolean(),
        defaultCurrencyCode: z.string(),
        enableGoogleOAuth: z.boolean(),
        enableGitHubOAuth: z.boolean(),
      }),
    )
    .query(() => ({
      enableExpenseDocuments: env.PUBLIC_ENABLE_EXPENSE_DOCUMENTS,
      enableReceiptExtract: env.PUBLIC_ENABLE_RECEIPT_EXTRACT,
      enableVoiceExpense: env.PUBLIC_ENABLE_VOICE_EXPENSE,
      enableCategoryExtract: env.PUBLIC_ENABLE_CATEGORY_EXTRACT,
      enableBulkCategorize: env.PUBLIC_ENABLE_BULK_CATEGORIZE,
      defaultCurrencyCode: env.PUBLIC_DEFAULT_CURRENCY_CODE,
      enableGoogleOAuth: !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
      enableGitHubOAuth: !!(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET),
    })),
})
