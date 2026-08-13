import { z } from 'zod'

import { getRecurringSeriesProgress } from '../../../../lib/api/series-progress'
import {
  hashLinkInviteToken,
  groupReadProcedure,
  linkInviteTokenInput,
  loadGroupViewer,
} from '../../../init'
import { recurringSeriesProgressOutputSchema } from '../../../outputs/expenses'

export const seriesProgressProcedure = groupReadProcedure
  .input(
    z.object({
      groupId: z.string().min(1),
      seriesId: z.string().min(1),
      linkInviteToken: linkInviteTokenInput,
    }),
  )
  .output(recurringSeriesProgressOutputSchema)
  .query(async ({ input, ctx }) => {
    await loadGroupViewer({
      groupId: input.groupId,
      accountId: ctx.auth?.user.id,
      accountEmail: ctx.auth?.user.email,
      linkTokenHash: await hashLinkInviteToken(input.linkInviteToken),
      viewerSession: ctx.groupViewerSession,
    })
    return getRecurringSeriesProgress(input.groupId, input.seriesId)
  })
