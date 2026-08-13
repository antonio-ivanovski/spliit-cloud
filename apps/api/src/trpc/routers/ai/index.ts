import { createTRPCRouter } from '../../init'
import { extractExpenseInformationFromAudioProcedure } from './audio.procedure'
import { aiBulkCategorizeRouter } from './bulkCategorize'
import { extractExpenseInformationFromImageProcedure } from './receipt.procedure'

export const aiRouter = createTRPCRouter({
  bulkCategorize: aiBulkCategorizeRouter,
  extractExpenseInformationFromImage:
    extractExpenseInformationFromImageProcedure,
  extractExpenseInformationFromAudio:
    extractExpenseInformationFromAudioProcedure,
})
