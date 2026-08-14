import { z } from 'zod'

import { getRecentExpenseContext } from '../../../../lib/ai/context'
import { env } from '../../../../lib/env'
import { groupReadProcedure, loadGroupViewer } from '../../../init'

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
    }),
  )
  .output(categoryMemoryOutputSchema)
  .query(async ({ input: { groupId }, ctx }) => {
    const { canonicalGroupId } = await loadGroupViewer({
      groupId,
      accountId: ctx.auth?.user.id,
      accountEmail: ctx.auth?.user.email,
    })
    const context = await getRecentExpenseContext(
      canonicalGroupId,
      env.CATEGORY_MEMORY_LIMIT,
    )
    return { expenses: context.expenses }
  })
