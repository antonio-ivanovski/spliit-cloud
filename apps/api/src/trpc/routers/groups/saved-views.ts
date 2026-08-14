import { TRPCError } from '@trpc/server'

import { prisma } from '@spliit/db'

import { randomId } from '../../../lib/api/shared'
import {
  createTRPCRouter,
  loadGroupViewer,
  protectedProcedure,
} from '../../init'
import {
  mergeSavedViewsInputSchema,
  mergeSavedViewsOutputSchema,
  removeSavedViewInputSchema,
  removeSavedViewOutputSchema,
  saveSavedViewInputSchema,
  saveSavedViewOutputSchema,
  touchSavedViewInputSchema,
  touchSavedViewOutputSchema,
} from '../../outputs/saved-views'

function toOutput(row: {
  groupId: string
  viewKey: string
  lastOpenedAt: Date
}) {
  return {
    groupId: row.groupId,
    viewKey: row.viewKey,
    lastOpenedAt: row.lastOpenedAt.toISOString(),
  }
}

async function requirePublicView(
  groupId: string,
  viewKey: string,
  ctx: {
    auth: { user: { id: string; email?: string | null } }
  },
) {
  const access = await loadGroupViewer({
    groupId,
    viewKey,
    accountId: ctx.auth.user.id,
    accountEmail: ctx.auth.user.email,
  })
  if (access.viewer.kind === 'ACTIVE') {
    await prisma.accountSavedView.deleteMany({
      where: { accountId: ctx.auth.user.id, groupId },
    })
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Already a member of this group',
    })
  }
  if (access.viewer.kind !== 'PUBLIC_VIEW') {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Public view-only access is required',
    })
  }
  return access.group
}

async function upsertSavedView(args: {
  accountId: string
  groupId: string
  viewKey: string
  lastOpenedAt: Date
}) {
  const row = await prisma.accountSavedView.upsert({
    where: {
      accountId_groupId: {
        accountId: args.accountId,
        groupId: args.groupId,
      },
    },
    create: {
      id: randomId(),
      accountId: args.accountId,
      groupId: args.groupId,
      viewKey: args.viewKey,
      lastOpenedAt: args.lastOpenedAt,
    },
    update: {
      viewKey: args.viewKey,
      lastOpenedAt: args.lastOpenedAt,
    },
  })
  return toOutput(row)
}

export const groupSavedViewsRouter = createTRPCRouter({
  save: protectedProcedure
    .input(saveSavedViewInputSchema)
    .output(saveSavedViewOutputSchema)
    .mutation(async ({ input, ctx }) => {
      const group = await requirePublicView(input.groupId, input.viewKey, ctx)
      return upsertSavedView({
        accountId: ctx.auth.user.id,
        groupId: group.id,
        viewKey: input.viewKey,
        lastOpenedAt: new Date(),
      })
    }),

  touch: protectedProcedure
    .input(touchSavedViewInputSchema)
    .output(touchSavedViewOutputSchema)
    .mutation(async ({ input, ctx }) => {
      const existing = await prisma.accountSavedView.findUnique({
        where: {
          accountId_groupId: {
            accountId: ctx.auth.user.id,
            groupId: input.groupId,
          },
        },
      })
      if (!existing) return null

      try {
        const group = await requirePublicView(input.groupId, input.viewKey, ctx)
        return upsertSavedView({
          accountId: ctx.auth.user.id,
          groupId: group.id,
          viewKey: input.viewKey,
          lastOpenedAt: new Date(),
        })
      } catch (error) {
        if (error instanceof TRPCError && error.code === 'BAD_REQUEST') {
          return null
        }
        throw error
      }
    }),

  remove: protectedProcedure
    .input(removeSavedViewInputSchema)
    .output(removeSavedViewOutputSchema)
    .mutation(async ({ input, ctx }) => {
      await prisma.accountSavedView.deleteMany({
        where: { accountId: ctx.auth.user.id, groupId: input.groupId },
      })
      return { removed: true as const }
    }),

  merge: protectedProcedure
    .input(mergeSavedViewsInputSchema)
    .output(mergeSavedViewsOutputSchema)
    .mutation(async ({ input, ctx }) => {
      let saved = 0
      let skipped = 0
      const seen = new Set<string>()
      const completedGroupIds: string[] = []
      for (const item of input.items) {
        if (seen.has(item.groupId)) {
          skipped += 1
          completedGroupIds.push(item.groupId)
          continue
        }
        seen.add(item.groupId)
        try {
          const group = await requirePublicView(item.groupId, item.viewKey, ctx)
          const lastOpenedAt = item.lastOpenedAt
            ? new Date(item.lastOpenedAt)
            : new Date()
          await upsertSavedView({
            accountId: ctx.auth.user.id,
            groupId: group.id,
            viewKey: item.viewKey,
            lastOpenedAt: Number.isNaN(lastOpenedAt.getTime())
              ? new Date()
              : lastOpenedAt,
          })
          saved += 1
          completedGroupIds.push(item.groupId)
        } catch (error) {
          skipped += 1
          if (
            error instanceof TRPCError &&
            (error.code === 'BAD_REQUEST' || error.code === 'FORBIDDEN')
          ) {
            completedGroupIds.push(item.groupId)
          }
        }
      }
      return { saved, skipped, completedGroupIds }
    }),
})
