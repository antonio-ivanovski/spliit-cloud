import { TRPCError } from '@trpc/server'
import { z } from 'zod'

import { prisma } from '@spliit/db'

import { getWebBaseUrl } from '../../../lib/auth/urls'
import { generateGroupViewKey } from '../../../lib/group-view'
import {
  createTRPCRouter,
  loadGroupMutationContext,
  protectedProcedure,
} from '../../init'

async function requireRegularGroupAdmin(groupId: string, accountId: string) {
  const context = await loadGroupMutationContext({ groupId, accountId })
  if (context.member.role !== 'ADMIN') {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Admin access required' })
  }
  if (context.group.groupType !== 'GROUP') {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Friend ledgers cannot be shared publicly',
    })
  }
  return context
}

async function requireRegularGroupMember(groupId: string, accountId: string) {
  const context = await loadGroupMutationContext({ groupId, accountId })
  if (context.group.groupType !== 'GROUP') {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Friend ledgers cannot be shared publicly',
    })
  }
  return context
}

function viewUrl(groupId: string, key: string) {
  return `${getWebBaseUrl()}/groups/${groupId}#view=${key}`
}

const groupInput = z.object({ groupId: z.string().min(1) })

export const groupViewRouter = createTRPCRouter({
  get: protectedProcedure.input(groupInput).query(async ({ input, ctx }) => {
    const { group, member } = await requireRegularGroupMember(
      input.groupId,
      ctx.auth.user.id,
    )
    return {
      url: group.publicViewKey
        ? viewUrl(input.groupId, group.publicViewKey)
        : null,
      canManage: member.role === 'ADMIN',
    }
  }),

  enable: protectedProcedure
    .input(groupInput)
    .mutation(async ({ input, ctx }) => {
      await requireRegularGroupAdmin(input.groupId, ctx.auth.user.id)
      const key = generateGroupViewKey()
      const result = await prisma.group.updateMany({
        where: { id: input.groupId, publicViewKey: null },
        data: { publicViewKey: key },
      })
      if (result.count !== 1) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'Public view-only link is already enabled',
        })
      }
      return { url: viewUrl(input.groupId, key) }
    }),

  replace: protectedProcedure
    .input(groupInput.extend({ confirmed: z.literal(true) }))
    .mutation(async ({ input, ctx }) => {
      await requireRegularGroupAdmin(input.groupId, ctx.auth.user.id)
      const key = generateGroupViewKey()
      const result = await prisma.group.updateMany({
        where: { id: input.groupId, publicViewKey: { not: null } },
        data: { publicViewKey: key },
      })
      if (result.count !== 1) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Public view-only link is not enabled',
        })
      }
      return { url: viewUrl(input.groupId, key) }
    }),

  remove: protectedProcedure
    .input(groupInput.extend({ confirmed: z.literal(true) }))
    .mutation(async ({ input, ctx }) => {
      await requireRegularGroupAdmin(input.groupId, ctx.auth.user.id)
      const result = await prisma.group.updateMany({
        where: { id: input.groupId, publicViewKey: { not: null } },
        data: { publicViewKey: null },
      })
      if (result.count !== 1) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Public view-only link is not enabled',
        })
      }
      return { removed: true as const }
    }),
})
