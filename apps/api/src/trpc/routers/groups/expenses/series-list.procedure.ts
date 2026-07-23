import { z } from 'zod'
import { getRecurringExpenseSeries } from '../../../../lib/api'
import {
  hashLinkInviteToken,
  linkInviteTokenInput,
  loadGroupViewer,
  protectedProcedure,
} from '../../../init'

export const listRecurringExpenseSeriesProcedure = protectedProcedure
  .input(
    z.object({
      groupId: z.string().min(1),
      cursor: z.string().optional(),
      limit: z.number().int().min(1).max(100).optional(),
      seriesId: z.string().optional(),
      occurrenceCursor: z.number().int().positive().optional(),
      occurrenceLimit: z.number().int().min(1).max(100).optional(),
      linkInviteToken: linkInviteTokenInput,
    }),
  )
  .query(async ({ input, ctx }) => {
    await loadGroupViewer({
      groupId: input.groupId,
      accountId: ctx.auth.user.id,
      accountEmail: ctx.auth.user.email,
      linkTokenHash: await hashLinkInviteToken(input.linkInviteToken),
    })
    return getRecurringExpenseSeries(input.groupId, {
      cursor: input.cursor,
      limit: input.limit,
      seriesId: input.seriesId,
      occurrenceCursor: input.occurrenceCursor,
      occurrenceLimit: input.occurrenceLimit,
    })
  })
