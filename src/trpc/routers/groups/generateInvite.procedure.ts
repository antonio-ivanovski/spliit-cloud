import { authedProcedure } from '@/trpc/init'
import { prisma } from '@/lib/prisma'
import { generateInviteToken, createInviteUrl } from '@/lib/invite-links'
import { env } from '@/lib/env'
import { z } from 'zod'

export const generateInvite = authedProcedure
  .input(
    z.object({
      groupId: z.string().min(1),
    }),
  )
  .mutation(async ({ ctx, input }) => {
    // Verify user is a member of the group
    const membership = await prisma.userGroup.findUnique({
      where: {
        userId_groupId: {
          userId: ctx.userId,
          groupId: input.groupId,
        },
      },
    })

    if (!membership) {
      throw new Error('Not a member of this group')
    }

    const token = generateInviteToken(input.groupId)
    const url = createInviteUrl(token, env.NEXT_PUBLIC_BASE_URL)

    return {
      token,
      url,
      expiresIn: '24 hours',
    }
  })
