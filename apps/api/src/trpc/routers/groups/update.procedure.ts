import { groupFormSchema } from '@spliit/domain'
import { z } from 'zod'
import { updateGroup } from '../../../lib/api'
import { baseProcedure } from '../../init'

export const updateGroupProcedure = baseProcedure
  .input(
    z.object({
      groupId: z.string().min(1),
      groupFormValues: groupFormSchema,
      participantId: z.string().optional(),
    }),
  )
  .mutation(async ({ input: { groupId, groupFormValues, participantId } }) => {
    await updateGroup(groupId, groupFormValues, participantId)
  })
