import { z } from 'zod'

import { getRecurringSeriesProgress } from '../../../../lib/api/series-progress'
import { groupReadProcedure, loadGroupViewer } from '../../../init'
import { recurringSeriesProgressOutputSchema } from '../../../outputs/expenses'

export const seriesProgressProcedure = groupReadProcedure
  .input(
    z.object({
      groupId: z.string().min(1),
      seriesId: z.string().min(1),
    }),
  )
  .output(recurringSeriesProgressOutputSchema)
  .query(async ({ input, ctx }) => {
    const { canonicalGroupId } = await loadGroupViewer({
      groupId: input.groupId,
      accountId: ctx.auth?.user.id,
      accountEmail: ctx.auth?.user.email,
    })
    return getRecurringSeriesProgress(canonicalGroupId, input.seriesId)
  })
