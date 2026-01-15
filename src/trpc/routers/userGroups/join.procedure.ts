import { authedProcedure } from '@/trpc/init'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import { nanoid } from 'nanoid'

export const joinUserGroup = authedProcedure
  .input(
    z.object({
      groupId: z.string().min(1),
    }),
  )
  .mutation(async ({ ctx, input }) => {
    // Check if group exists
    const group = await prisma.group.findUnique({
      where: { id: input.groupId },
    })

    if (!group) {
      throw new Error('Group not found')
    }

    // Check if user is already a member
    const existingMembership = await prisma.userGroup.findUnique({
      where: {
        userId_groupId: {
          userId: ctx.userId,
          groupId: input.groupId,
        },
      },
    })

    if (existingMembership) {
      throw new Error('Already a member of this group')
    }

    // Get user details
    const user = await prisma.user.findUnique({
      where: { id: ctx.userId },
    })

    if (!user) {
      throw new Error('User not found')
    }

    // Create UserGroup and Participant in a transaction
    await prisma.$transaction([
      prisma.userGroup.create({
        data: {
          userId: ctx.userId,
          groupId: input.groupId,
        },
      }),
      prisma.participant.create({
        data: {
          id: nanoid(),
          name: user.name || user.email?.split('@')[0] || 'User',
          groupId: input.groupId,
          userId: ctx.userId,
        },
      }),
    ])

    return { success: true }
  })
