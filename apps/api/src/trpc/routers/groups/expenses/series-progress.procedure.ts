import { z } from 'zod'

import { getRecurringSeriesProgress } from '../../../../lib/api/series-progress'
import {
  groupAccessFields,
  groupReadProcedure,
  groupViewerArgs,
  loadGroupViewer,
} from '../../../init'
import { recurringSeriesProgressOutputSchema } from '../../../outputs/expenses'

export const seriesProgressProcedure = groupReadProcedure
  .input(
    z.object({
      groupId: z.string().min(1),
      seriesId: z.string().min(1),
      ...groupAccessFields,
    }),
  )
  .output(recurringSeriesProgressOutputSchema)
  .query(async ({ input, ctx }) => {
    const { group } = await loadGroupViewer(groupViewerArgs(input, ctx))
    return getRecurringSeriesProgress(group.id, input.seriesId)
  })
