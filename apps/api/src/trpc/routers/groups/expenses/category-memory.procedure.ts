import { z } from 'zod'

import { getRecentExpenseContext } from '../../../../lib/ai/context'
import { env } from '../../../../lib/env'
import {
  groupAccessFields,
  groupReadProcedure,
  groupViewerArgs,
  loadGroupViewer,
} from '../../../init'

export const categoryMemoryOutputSchema = z.object({
  expenses: z.array(
    z.object({
      title: z.string(),
      categoryId: z.string(),
    }),
  ),
})

export const categoryMemoryProcedure = groupReadProcedure
  .input(
    z.object({
      groupId: z.string().min(1),
      ...groupAccessFields,
    }),
  )
  .output(categoryMemoryOutputSchema)
  .query(async ({ input, ctx }) => {
    const { group } = await loadGroupViewer(groupViewerArgs(input, ctx))
    const context = await getRecentExpenseContext(
      group.id,
      env.CATEGORY_MEMORY_LIMIT,
    )
    return { expenses: context.expenses }
  })
