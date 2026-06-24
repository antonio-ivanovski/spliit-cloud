import { prisma } from '@spliit/db'
import { z } from 'zod'
import { getGroups } from '../../../lib/api'
import { protectedProcedure } from '../../init'

/**
 * Returns the groups the current account is an active member of. The legacy
 * `groupIds` input is still accepted so the web client can keep using
 * localStorage for now, but when empty we fall back to the server-backed
 * list derived from `GroupMember`.
 */
export const listGroupsProcedure = protectedProcedure
  .input(
    z.object({
      groupIds: z.array(z.string().min(1)).default([]),
    }),
  )
  .query(async ({ input: { groupIds }, ctx }) => {
    let ids = groupIds
    if (ids.length === 0) {
      const memberships = await prisma.groupMember.findMany({
        where: { accountId: ctx.auth.user.id, status: 'ACTIVE' },
        select: { groupId: true },
      })
      ids = memberships.map((m) => m.groupId)
    } else {
      // Always intersect with memberships to avoid leaking access to
      // unrelated groups via crafted groupIds.
      const memberships = await prisma.groupMember.findMany({
        where: {
          accountId: ctx.auth.user.id,
          status: 'ACTIVE',
          groupId: { in: ids },
        },
        select: { groupId: true },
      })
      ids = memberships.map((m) => m.groupId)
    }
    const groups = await getGroups(ids)
    return { groups }
  })
