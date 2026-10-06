import { z } from 'zod'

import { getActivities } from '../../../../lib/api'
import type { ActivityListItem } from '../../../../lib/api/activities'
import { redactViewerDisplayName } from '../../../../lib/group-view'
import {
  groupAccessFields,
  scopedGroupReadProcedure,
  groupViewerArgs,
  loadGroupViewer,
} from '../../../init'
import { listActivitiesOutputSchema } from '../../../outputs/activities'

/**
 * Read-only viewers have no participant identity, so stored participant
 * snapshots would only leak pseudonymous ids — drop them alongside the live
 * splits (unknown ⇒ visible in the feed).
 */
function stripParticipantSnapshot(
  data: ActivityListItem['data'],
): ActivityListItem['data'] {
  if (
    data?.kind !== 'expense' &&
    data?.kind !== 'import_summary' &&
    data?.kind !== 'recurring_expense_summary' &&
    data?.kind !== 'recurring_expense_stopped'
  ) {
    return data
  }
  if (data.affectedParticipants === undefined) return data
  const { affectedParticipants: _dropped, ...rest } = data
  void _dropped
  return rest
}

export const listGroupActivitiesProcedure = scopedGroupReadProcedure(
  'spliit:groups:read',
)
  .input(
    z.object({
      groupId: z.string(),
      cursor: z.number().int().min(0).optional().default(0),
      limit: z.number().int().min(1).max(100).optional().default(5),
      ...groupAccessFields,
    }),
  )
  .output(listActivitiesOutputSchema)
  .query(async ({ input: { groupId, cursor, limit, ...access }, ctx }) => {
    const { group, viewer } = await loadGroupViewer(
      groupViewerArgs({ groupId, ...access }, ctx),
    )
    const activities = await getActivities(group.id, {
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
                    : stripParticipantSnapshot(activity.data),
              }
        // Read-only viewers have no participant identity, so splits would
        // only leak pseudonymous ids — strip them (unknown ⇒ visible).
        const expense =
          activity.expense && viewer.kind === 'ACTIVE'
            ? activity.expense
            : activity.expense
              ? { ...activity.expense, paidByList: [], paidFor: [] }
              : null
        return { ...publicActivity, expense }
      }),
      hasMore: !!activities[limit],
      nextCursor: cursor + limit,
    }
  })
