import { z } from 'zod'
import { getActivities } from '../../../../lib/api'
import {
  hashLinkInviteToken,
  linkInviteTokenInput,
  loadGroupViewer,
  protectedProcedure,
} from '../../../init'

export const listGroupActivitiesProcedure = protectedProcedure
  .input(
    z.object({
      groupId: z.string(),
      cursor: z.number().optional().default(0),
      limit: z.number().optional().default(5),
      linkInviteToken: linkInviteTokenInput,
    }),
  )
  .query(
    async ({ input: { groupId, cursor, limit, linkInviteToken }, ctx }) => {
      await loadGroupViewer({
        groupId,
        accountId: ctx.auth.user.id,
        accountEmail: ctx.auth.user.email,
        linkTokenHash: await hashLinkInviteToken(linkInviteToken),
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
    },
  )
