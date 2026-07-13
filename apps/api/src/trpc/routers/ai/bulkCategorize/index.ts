import { createTRPCRouter } from '../../../init'
import { aiBulkCategorizeCalibrateProcedure } from './calibrate.procedure'
import { aiBulkCategorizeListCandidatesProcedure } from './listCandidates.procedure'
import { aiBulkCategorizePreviewProcedure } from './preview.procedure'

export const aiBulkCategorizeRouter = createTRPCRouter({
  /**
   * Expenses eligible for bulk recategorization (still on `fromCategoryId`,
   * non-reimbursement).
   */
  listCandidates: aiBulkCategorizeListCandidatesProcedure,
  /**
   * Fetch the next batch of AI category suggestions, optionally conditioned
   * on prior selections.
   */
  calibrate: aiBulkCategorizeCalibrateProcedure,
  /**
   * Compute AI category suggestions for all eligible expenses without
   * applying them.
   */
  preview: aiBulkCategorizePreviewProcedure,
})
