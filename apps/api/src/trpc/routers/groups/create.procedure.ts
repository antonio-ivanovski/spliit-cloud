import { z } from 'zod'

import { groupFormSchema } from '@spliit/domain'

import { createGroup } from '../../../lib/api'
import { protectedProcedure } from '../../init'
import { createGroupOutputSchema } from '../../outputs/groups'

export const createGroupProcedure = protectedProcedure
  .input(
    z.object({
      groupFormValues: groupFormSchema,
    }),
  )
  .output(createGroupOutputSchema)
  .mutation(async ({ input: { groupFormValues }, ctx }) => {
    const account = ctx.auth.user
    const result = await createGroup(groupFormValues, {
      adminAccountId: account.id,
    })
    return { groupId: result.group.id }
  })
