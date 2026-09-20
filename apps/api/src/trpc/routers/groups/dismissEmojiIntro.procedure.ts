import { TRPCError } from '@trpc/server'
import { z } from 'zod'

import { GroupType } from '@spliit/db'

import { dismissGroupEmojiIntro } from '../../../lib/api'
import { loadGroupMutationContext, apiProcedure } from '../../init'

/**
 * Dismiss the "groups can have an emoji" intro for an existing group. Only
 * ADMINs can decide and the decision is group-wide; writes the `''` declined
 * sentinel. Idempotent: no-op when an emoji was already picked or explicitly
 * declined in the meantime.
 */
export const dismissGroupEmojiIntroProcedure = apiProcedure(
  'spliit:groups:manage',
)
  .input(z.object({ groupId: z.string().min(1) }))
  .output(z.void())
  .mutation(async ({ input: { groupId }, ctx }) => {
    const { group, member } = await loadGroupMutationContext({
      groupId,
      accountId: ctx.auth.user.id,
    })
    if (member.role !== 'ADMIN') {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Only admins can dismiss the group emoji intro',
      })
    }
    if (group.archived) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'This group is archived and its settings cannot be modified',
      })
    }
    if (group.groupType === GroupType.FRIEND) return
    await dismissGroupEmojiIntro(groupId)
  })
