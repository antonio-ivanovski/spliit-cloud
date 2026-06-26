import { groupFormSchema } from '@spliit/domain'
import { z } from 'zod'
import { createGroup } from '../../../lib/api'
import { protectedProcedure } from '../../init'

export const createGroupProcedure = protectedProcedure
  .input(
    z.object({
      groupFormValues: groupFormSchema,
    }),
  )
  .mutation(async ({ input: { groupFormValues }, ctx }) => {
    const account = ctx.auth.user
    const result = await createGroup(groupFormValues, {
      adminAccountId: account.id,
    })
    return { groupId: result.group.id }
  })
