import { z } from 'zod'
import { getActivities } from '../../../../lib/api'
import { loadGroupViewer, protectedProcedure } from '../../../init'

export const listGroupActivitiesProcedure = protectedProcedure
  .input(
    z.object({
      groupId: z.string(),
      cursor: z.number().optional().default(0),
      limit: z.number().optional().default(5),
    }),
  )
  .query(async ({ input: { groupId, cursor, limit }, ctx }) => {
    await loadGroupViewer({
      groupId,
      accountId: ctx.auth.user.id,
      accountEmail: ctx.auth.user.email,
    })
    const activities = await getActivities(groupId, {
      offset: cursor,
      length: limit + 1,
    })
    return {
      activities: activities.slice(0, limit),
      hasMore: !!activities[limit],
      nextCursor: cursor + limit,
    }
  })
