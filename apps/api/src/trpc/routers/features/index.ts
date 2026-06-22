import { env } from '../../../lib/env'
import { baseProcedure, createTRPCRouter } from '../../init'

export const featuresRouter = createTRPCRouter({
  get: baseProcedure.query(() => ({
    enableExpenseDocuments: env.PUBLIC_ENABLE_EXPENSE_DOCUMENTS,
    enableReceiptExtract: env.PUBLIC_ENABLE_RECEIPT_EXTRACT,
    enableCategoryExtract: env.PUBLIC_ENABLE_CATEGORY_EXTRACT,
  })),
})
