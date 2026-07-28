import { z } from 'zod'

import { env } from '../../../lib/env'
import { baseProcedure, createTRPCRouter } from '../../init'

export const featuresRouter = createTRPCRouter({
  get: baseProcedure
    .output(
      z.object({
        enableExpenseDocuments: z.boolean(),
        enableReceiptExtract: z.boolean(),
        enableCategoryExtract: z.boolean(),
        enableBulkCategorize: z.boolean(),
      }),
    )
    .query(() => ({
      enableExpenseDocuments: env.PUBLIC_ENABLE_EXPENSE_DOCUMENTS,
      enableReceiptExtract: env.PUBLIC_ENABLE_RECEIPT_EXTRACT,
      enableCategoryExtract: env.PUBLIC_ENABLE_CATEGORY_EXTRACT,
      enableBulkCategorize: env.PUBLIC_ENABLE_BULK_CATEGORIZE,
    })),
})
