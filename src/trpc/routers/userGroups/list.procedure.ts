import { authedProcedure } from '@/trpc/init'
import { prisma } from '@/lib/prisma'

export const listUserGroups = authedProcedure.query(async ({ ctx }) => {
  const userGroups = await prisma.userGroup.findMany({
    where: { userId: ctx.userId },
    include: {
      group: {
        select: {
          id: true,
          name: true,
          currency: true,
          currencyCode: true,
          createdAt: true,
        },
      },
    },
    orderBy: { joinedAt: 'desc' },
  })

  return userGroups.map((ug) => ({
    ...ug.group,
    joinedAt: ug.joinedAt,
  }))
})
