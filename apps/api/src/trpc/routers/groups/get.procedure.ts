import { z } from 'zod'
import { getGroup } from '../../../lib/api'
import { loadGroupContext, protectedProcedure } from '../../init'

export const getGroupProcedure = protectedProcedure
  .input(z.object({ groupId: z.string().min(1) }))
  .query(async ({ input: { groupId }, ctx }) => {
    const { member } = await loadGroupContext({
      groupId,
      accountId: ctx.auth.user.id,
    })
    const group = await getGroup(groupId)
    return {
      group,
      currentLedgerParticipantId: member.ledgerParticipant?.id ?? null,
      currentMember: {
        id: member.id,
        role: member.role,
        status: member.status,
      },
    }
  })
