import { createTRPCRouter } from '../../../init'
import { aiBulkCategorizeCalibrateProcedure } from './calibrate.procedure'
import { aiBulkCategorizeListCandidatesProcedure } from './listCandidates.procedure'
import { aiBulkCategorizePreviewProcedure } from './preview.procedure'

export const aiBulkCategorizeRouter = createTRPCRouter({
  listCandidates: aiBulkCategorizeListCandidatesProcedure,
  calibrate: aiBulkCategorizeCalibrateProcedure,
  preview: aiBulkCategorizePreviewProcedure,
})
