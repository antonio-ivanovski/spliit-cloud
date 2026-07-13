import { createTRPCRouter } from '../../../init'
import { getGroupStatsProcedure } from './get.procedure'

export const groupStatsRouter = createTRPCRouter({
  /**
   * Aggregate spend stats over a time window. `LATEST_ACTIVITY` auto-ranges
   * around recent activity; `CUSTOM` requires `customRange`.
   */
  get: getGroupStatsProcedure,
})
