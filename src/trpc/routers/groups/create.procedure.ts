import { createGroup } from '@/lib/api'
import { groupFormSchema } from '@/lib/schemas'
import { baseProcedure } from '@/trpc/init'
import { prisma } from '@/lib/prisma'
import { nanoid } from 'nanoid'
import { z } from 'zod'

export const createGroupProcedure = baseProcedure
  .input(
    z.object({
      groupFormValues: groupFormSchema,
      isAuthenticated: z.boolean().optional().default(false),
    }),
  )
  .mutation(async ({ ctx, input: { groupFormValues, isAuthenticated } }) => {
    const group = await createGroup(groupFormValues)

    // If creating an authenticated group and user is logged in, link user to group
    if (isAuthenticated && ctx.userId) {
      const user = await prisma.user.findUnique({
        where: { id: ctx.userId },
      })

      if (user) {
        await prisma.$transaction([
          prisma.userGroup.create({
            data: {
              userId: ctx.userId,
              groupId: group.id,
            },
          }),
          // Update the first participant (creator) to be linked to the user
          // If there's a participant created in the group, link it to the user
          // Otherwise, create a new participant for the user
          ...(group.participants.length > 0
            ? [
                prisma.participant.update({
                  where: { id: group.participants[0].id },
                  data: { userId: ctx.userId },
                }),
              ]
            : [
                prisma.participant.create({
                  data: {
                    id: nanoid(),
                    name: user.name || user.email?.split('@')[0] || 'User',
                    groupId: group.id,
                    userId: ctx.userId,
                  },
                }),
              ]),
        ])
      }
    }

    return { groupId: group.id }
  })
