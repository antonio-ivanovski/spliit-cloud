import { z } from 'zod'

import { getActivities } from '../../../../lib/api'
import { redactViewerDisplayName } from '../../../../lib/group-view'
import {
  hashLinkInviteToken,
  groupReadProcedure,
  linkInviteTokenInput,
  loadGroupViewer,
} from '../../../init'
import { listActivitiesOutputSchema } from '../../../outputs/activities'

export const listGroupActivitiesProcedure = groupReadProcedure
  .input(
    z.object({
      groupId: z.string(),
      cursor: z.number().optional().default(0),
      limit: z.number().optional().default(5),
      linkInviteToken: linkInviteTokenInput.describe(
        'Raw link-invite token from the share URL. Grants read access to pending link-invitees.',
      ),
    }),
  )
  .output(listActivitiesOutputSchema)
  .query(
    async ({ input: { groupId, cursor, limit, linkInviteToken }, ctx }) => {
      const { viewer } = await loadGroupViewer({
        groupId,
        accountId: ctx.auth?.user.id,
        accountEmail: ctx.auth?.user.email,
        linkTokenHash: await hashLinkInviteToken(linkInviteToken),
        viewerSession: ctx.groupViewerSession,
      })
      const activities = await getActivities(groupId, {
        offset: cursor,
        length: limit + 1,
      })
      return {
        activities: activities.slice(0, limit).map((activity) => {
          const publicActivity =
            viewer.kind === 'ACTIVE'
              ? activity
              : {
                  ...activity,
                  ledgerId: 'public',
                  actorId: null,
                  actorName: activity.actorName
                    ? redactViewerDisplayName(activity.actorName)
                    : null,
                  subjectId:
                    activity.subjectType === 'EXPENSE'
                      ? activity.subjectId
                      : null,
                  data:
                    activity.data?.kind === 'invitation'
                      ? {
                          ...activity.data,
                          summary: undefined,
                          displayLabel: 'Invitation',
                          changes: activity.data.changes?.map((change) =>
                            change.field === 'destination'
                              ? { ...change, before: null, after: null }
                              : change,
                          ),
                        }
                      : activity.data,
                }
          return { ...publicActivity, expense: activity.expense ?? null }
        }),
        hasMore: !!activities[limit],
        nextCursor: cursor + limit,
      }
    },
  )
