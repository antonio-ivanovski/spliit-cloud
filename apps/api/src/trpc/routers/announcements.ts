import { TRPCError } from '@trpc/server'
import { z } from 'zod'

import { prisma } from '@spliit/db'
import {
  announcements,
  getAnnouncement,
  hasAnnouncementChannel,
  latestModalAnnouncement,
} from '@spliit/domain/announcements'

import { createTRPCRouter, protectedProcedure, publicProcedure } from '../init'

export const announcementsRouter = createTRPCRouter({
  list: publicProcedure.query(() =>
    announcements
      .filter((entry) => hasAnnouncementChannel(entry, 'updates'))
      .map((entry) => ({ id: entry.id, date: entry.date })),
  ),
  latestStatus: protectedProcedure.query(async ({ ctx }) => {
    // The modal follows the newest modal-channel entry only. A quiet
    // (updates-only) entry never pops it: an unviewed earlier modal entry
    // keeps popping until viewed.
    const latest = latestModalAnnouncement()
    if (!latest) return { announcementId: null, viewed: true }
    const view = await prisma.announcementView.findUnique({
      where: {
        accountId_announcementId: {
          accountId: ctx.auth.user.id,
          announcementId: latest.id,
        },
      },
      select: { viewedAt: true },
    })
    return { announcementId: latest.id, viewed: view !== null }
  }),
  markViewed: protectedProcedure
    .input(z.object({ announcementId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const announcement = getAnnouncement(input.announcementId)
      if (!announcement || !hasAnnouncementChannel(announcement, 'updates')) {
        throw new TRPCError({ code: 'NOT_FOUND' })
      }
      await prisma.announcementView.upsert({
        where: {
          accountId_announcementId: {
            accountId: ctx.auth.user.id,
            announcementId: input.announcementId,
          },
        },
        create: {
          accountId: ctx.auth.user.id,
          announcementId: input.announcementId,
        },
        update: {},
      })
      return { viewed: true }
    }),
})
