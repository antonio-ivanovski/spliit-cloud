import { createTRPCRouter } from '../../init'
import { extractExpenseInformationFromAudioProcedure } from './audio.procedure'
import { aiBulkCategorizeRouter } from './bulkCategorize'
import { extractCategoryFromTitleProcedure } from './category.procedure'
import { extractExpenseInformationFromImageProcedure } from './receipt.procedure'

export const aiRouter = createTRPCRouter({
  bulkCategorize: aiBulkCategorizeRouter,
  extractCategoryFromTitle: extractCategoryFromTitleProcedure,
  extractExpenseInformationFromImage:
    extractExpenseInformationFromImageProcedure,
  extractExpenseInformationFromAudio:
    extractExpenseInformationFromAudioProcedure,
})
