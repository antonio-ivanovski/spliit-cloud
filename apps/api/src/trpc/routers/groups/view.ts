import { TRPCError } from '@trpc/server'
import { z } from 'zod'

import { prisma } from '@spliit/db'

import {
  buildGroupActivityData,
  logActivity,
} from '../../../lib/api/activities'
import { getWebBaseUrl } from '../../../lib/auth/urls'
import { generateGroupViewKey } from '../../../lib/group-view'
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

function viewUrl(groupId: string, viewKey: string) {
  return `${getWebBaseUrl()}/groups/${groupId}?viewKey=${encodeURIComponent(viewKey)}`
}

function publicViewLinkActivity(
  accountId: string,
  groupId: string,
  change: {
    summary: string
    before: string | null
    after: string | null
  },
) {
  return {
    type: 'GROUP_UPDATED' as const,
    actor: { type: 'ACCOUNT' as const, id: accountId },
    subject: { type: 'GROUP' as const, id: groupId },
    data: buildGroupActivityData({
      summary: change.summary,
      changedFields: ['publicViewLink'],
      changes: [
        {
          field: 'publicViewLink',
          before: change.before,
          after: change.after,
        },
      ],
    }),
  }
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
        url: group.publicViewKey
          ? viewUrl(input.groupId, group.publicViewKey)
          : null,
        canManage: member.role === 'ADMIN',
      }
    }),

  enable: protectedProcedure
    .input(groupInput)
    .output(viewLinkUrlOutput)
    .mutation(async ({ input, ctx }) => {
      const { group } = await requireRegularGroupAdmin(
        input.groupId,
        ctx.auth.user.id,
      )
      const publicViewKey = generateGroupViewKey()
      await prisma.$transaction(async (tx) => {
        const result = await tx.group.updateMany({
          where: { id: input.groupId, publicViewKey: null },
          data: { publicViewKey },
        })
        if (result.count !== 1) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'Public view-only link is already enabled',
          })
        }
        await logActivity(
          input.groupId,
          publicViewLinkActivity(ctx.auth.user.id, input.groupId, {
            summary: 'publicViewLink:enabled',
            before: 'Disabled',
            after: 'Enabled',
          }),
          tx,
          group.ledger.id,
        )
      })
      return { url: viewUrl(input.groupId, publicViewKey) }
    }),

  replace: protectedProcedure
    .input(groupInput.extend({ confirmed: z.literal(true) }))
    .output(viewLinkUrlOutput)
    .mutation(async ({ input, ctx }) => {
      const { group } = await requireRegularGroupAdmin(
        input.groupId,
        ctx.auth.user.id,
      )
      const publicViewKey = generateGroupViewKey()
      await prisma.$transaction(async (tx) => {
        const result = await tx.group.updateMany({
          where: { id: input.groupId, publicViewKey: { not: null } },
          data: { publicViewKey },
        })
        if (result.count !== 1) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Public view-only link is not enabled',
          })
        }
        await logActivity(
          input.groupId,
          publicViewLinkActivity(ctx.auth.user.id, input.groupId, {
            summary: 'publicViewLink:replaced',
            before: 'Enabled',
            after: 'Replaced',
          }),
          tx,
          group.ledger.id,
        )
      })
      return { url: viewUrl(input.groupId, publicViewKey) }
    }),

  remove: protectedProcedure
    .input(groupInput.extend({ confirmed: z.literal(true) }))
    .output(viewLinkRemovedOutput)
    .mutation(async ({ input, ctx }) => {
      const { group } = await requireRegularGroupAdmin(
        input.groupId,
        ctx.auth.user.id,
      )
      await prisma.$transaction(async (tx) => {
        const result = await tx.group.updateMany({
          where: { id: input.groupId, publicViewKey: { not: null } },
          data: { publicViewKey: null },
        })
        if (result.count !== 1) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Public view-only link is not enabled',
          })
        }
        await logActivity(
          input.groupId,
          publicViewLinkActivity(ctx.auth.user.id, input.groupId, {
            summary: 'publicViewLink:removed',
            before: 'Enabled',
            after: 'Disabled',
          }),
          tx,
          group.ledger.id,
        )
      })
      return { removed: true as const }
    }),
})
