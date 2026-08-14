import { TRPCError } from '@trpc/server'
import { z } from 'zod'

import { prisma } from '@spliit/db'

import { getWebBaseUrl } from '../../../lib/auth/urls'
import { generateUniqueGroupRouteId } from '../../../lib/group-route'
import {
  createTRPCRouter,
  loadGroupMutationContext,
  protectedProcedure,
} from '../../init'

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

async function requireRegularGroupAdmin(groupId: string, accountId: string) {
  const context = await requireRegularGroupMember(groupId, accountId)
  if (context.member.role !== 'ADMIN') {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Admin access required' })
  }
  return context
}

function viewUrl(publicViewId: string) {
  return `${getWebBaseUrl()}/groups/${publicViewId}`
}

const groupInput = z.object({ groupId: z.string().min(1) })
const viewLinkOutput = z.object({
  url: z.string().nullable(),
  canManage: z.boolean(),
})
const viewLinkUrlOutput = z.object({ url: z.string() })
const viewLinkRemovedOutput = z.object({ removed: z.literal(true) })

export const groupViewRouter = createTRPCRouter({
  get: protectedProcedure
    .input(groupInput)
    .output(viewLinkOutput)
    .query(async ({ input, ctx }) => {
      const { group, member } = await requireRegularGroupMember(
        input.groupId,
        ctx.auth.user.id,
      )
      return {
        url: group.publicViewId ? viewUrl(group.publicViewId) : null,
        canManage: member.role === 'ADMIN',
      }
    }),

  enable: protectedProcedure
    .input(groupInput)
    .output(viewLinkUrlOutput)
    .mutation(async ({ input, ctx }) => {
      await requireRegularGroupAdmin(input.groupId, ctx.auth.user.id)
      const publicViewId = await generateUniqueGroupRouteId()
      const result = await prisma.group.updateMany({
        where: { id: input.groupId, publicViewId: null },
        data: { publicViewId },
      })
      if (result.count !== 1) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'Public view-only link is already enabled',
        })
      }
      return { url: viewUrl(publicViewId) }
    }),

  replace: protectedProcedure
    .input(groupInput.extend({ confirmed: z.literal(true) }))
    .output(viewLinkUrlOutput)
    .mutation(async ({ input, ctx }) => {
      await requireRegularGroupAdmin(input.groupId, ctx.auth.user.id)
      const publicViewId = await generateUniqueGroupRouteId()
      const result = await prisma.group.updateMany({
        where: { id: input.groupId, publicViewId: { not: null } },
        data: { publicViewId },
      })
      if (result.count !== 1) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Public view-only link is not enabled',
        })
      }
      return { url: viewUrl(publicViewId) }
    }),

  remove: protectedProcedure
    .input(groupInput.extend({ confirmed: z.literal(true) }))
    .output(viewLinkRemovedOutput)
    .mutation(async ({ input, ctx }) => {
      await requireRegularGroupAdmin(input.groupId, ctx.auth.user.id)
      const result = await prisma.group.updateMany({
        where: { id: input.groupId, publicViewId: { not: null } },
        data: { publicViewId: null },
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
