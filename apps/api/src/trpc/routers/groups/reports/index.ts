import { createTRPCRouter } from '../../../init'
import { groupReportsBoundsProcedure } from './bounds.procedure'

export const groupReportsRouter = createTRPCRouter({
  /** Default date bounds for the PDF report dialog. */
  bounds: groupReportsBoundsProcedure,
})
