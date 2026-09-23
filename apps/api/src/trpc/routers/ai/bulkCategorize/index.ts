import { createTRPCRouter } from '../../../init'
import {
  bulkCategorizeApplyProcedure,
  bulkCategorizeConfirmProcedure,
  bulkCategorizeCountProcedure,
  bulkCategorizeDiscardProcedure,
  bulkCategorizeEditProcedure,
  bulkCategorizeRetryProcedure,
  bulkCategorizeReviewPageProcedure,
  bulkCategorizeRerunProcedure,
  bulkCategorizeStartProcedure,
  bulkCategorizeStatusProcedure,
} from './run.procedure'

export const aiBulkCategorizeRouter = createTRPCRouter({
  status: bulkCategorizeStatusProcedure,
  count: bulkCategorizeCountProcedure,
  reviewPage: bulkCategorizeReviewPageProcedure,
  start: bulkCategorizeStartProcedure,
  edit: bulkCategorizeEditProcedure,
  confirm: bulkCategorizeConfirmProcedure,
  rerun: bulkCategorizeRerunProcedure,
  save: bulkCategorizeApplyProcedure,
  retry: bulkCategorizeRetryProcedure,
  discard: bulkCategorizeDiscardProcedure,
})
