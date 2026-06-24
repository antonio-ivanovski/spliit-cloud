import { groupFormSchema } from '@spliit/domain'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { updateGroup } from '../../../lib/api'
import { loadGroupContext, protectedProcedure } from '../../init'

export const updateGroupProcedure = protectedProcedure
  .input(
    z.object({
      groupId: z.string().min(1),
      groupFormValues: groupFormSchema,
    }),
  )
  .mutation(async ({ input: { groupId, groupFormValues }, ctx }) => {
    const { group, member } = await loadGroupContext({
      groupId,
      accountId: ctx.auth.user.id,
    })
    if (member.role !== 'OWNER' && member.role !== 'ADMIN') {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Only owners and admins can change group settings',
      })
    }
    if (group.archived) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'This group is archived and its settings cannot be modified',
      })
    }
    await updateGroup(groupId, groupFormValues, {
      accountId: ctx.auth.user.id,
    })
  })
