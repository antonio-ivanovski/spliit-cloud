import { z } from 'zod'

import { getRecurringExpenseSeries } from '../../../../lib/api'
import { groupReadProcedure, loadGroupViewer } from '../../../init'
import { listRecurringExpenseSeriesOutputSchema } from '../../../outputs/expenses'

export const listRecurringExpenseSeriesProcedure = groupReadProcedure
  .input(
    z.object({
      groupId: z.string().min(1),
      cursor: z.string().optional(),
      limit: z.number().int().min(1).max(100).optional(),
      seriesId: z.string().optional(),
      occurrenceCursor: z.number().int().positive().optional(),
      occurrenceLimit: z.number().int().min(1).max(100).optional(),
    }),
  )
  .output(listRecurringExpenseSeriesOutputSchema)
  .query(async ({ input, ctx }) => {
    const { canonicalGroupId } = await loadGroupViewer({
      groupId: input.groupId,
      accountId: ctx.auth?.user.id,
      accountEmail: ctx.auth?.user.email,
    })
    return getRecurringExpenseSeries(canonicalGroupId, {
      cursor: input.cursor,
      limit: input.limit,
      seriesId: input.seriesId,
      occurrenceCursor: input.occurrenceCursor,
      occurrenceLimit: input.occurrenceLimit,
    })
  })
