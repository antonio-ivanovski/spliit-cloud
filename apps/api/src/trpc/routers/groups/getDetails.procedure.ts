import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { getGroup, getGroupExpensesParticipants } from '../../../lib/api'
import { loadGroupContext, protectedProcedure } from '../../init'

export const getGroupDetailsProcedure = protectedProcedure
  .input(z.object({ groupId: z.string().min(1) }))
  .query(async ({ input: { groupId }, ctx }) => {
    await loadGroupContext({ groupId, accountId: ctx.auth.user.id })
    const group = await getGroup(groupId)
    if (!group) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'Group not found.',
      })
    }

    const participantsWithExpenses = await getGroupExpensesParticipants(groupId)
    return { group, participantsWithExpenses }
  })
