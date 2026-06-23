import { groupFormSchema } from '@spliit/domain'
import { z } from 'zod'
import { createGroup } from '../../../lib/api'
import { baseProcedure } from '../../init'

export const createGroupProcedure = baseProcedure
  .input(
    z.object({
      groupFormValues: groupFormSchema,
    }),
  )
  .mutation(async ({ input: { groupFormValues } }) => {
    const group = await createGroup(groupFormValues)
    return { groupId: group.id }
  })
