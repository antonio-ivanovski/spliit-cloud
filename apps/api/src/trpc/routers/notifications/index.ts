import { prisma } from '@spliit/db'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { randomId } from '../../../lib/api/shared'
import {
  isPushConfigured,
  pushVapidPublicKey,
} from '../../../lib/notifications/push'
import { createTRPCRouter, protectedProcedure } from '../../init'

const subscriptionSchema = z.object({
  endpoint: z.string().url().max(4096),
  keys: z.object({
    p256dh: z.string().min(1).max(512),
    auth: z.string().min(1).max(512),
  }),
})

export const notificationsRouter = createTRPCRouter({
  push: createTRPCRouter({
    getConfig: protectedProcedure.query(() => ({
      configured: isPushConfigured,
      vapidPublicKey: pushVapidPublicKey,
    })),

    register: protectedProcedure
      .input(
        subscriptionSchema.extend({
          userAgent: z.string().max(512).nullish(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const accountId = ctx.auth.user.id
        const existing = await prisma.pushSubscription.findUnique({
          where: { endpoint: input.endpoint },
          select: { id: true, accountId: true },
        })
        if (existing && existing.accountId !== accountId) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'This browser subscription belongs to another account',
          })
        }

        const row = await prisma.pushSubscription.upsert({
          where: { endpoint: input.endpoint },
          create: {
            id: randomId(),
            accountId,
            endpoint: input.endpoint,
            p256dh: input.keys.p256dh,
            auth: input.keys.auth,
            userAgent: input.userAgent ?? null,
          },
          update: {
            accountId,
            p256dh: input.keys.p256dh,
            auth: input.keys.auth,
            userAgent: input.userAgent ?? null,
          },
          select: { id: true, endpoint: true, updatedAt: true },
        })
        return { subscription: row }
      }),

    remove: protectedProcedure
      .input(z.object({ endpoint: z.string().url().max(4096) }))
      .mutation(async ({ ctx, input }) => {
        await prisma.pushSubscription.deleteMany({
          where: { endpoint: input.endpoint, accountId: ctx.auth.user.id },
        })
        return { removed: true }
      }),

    status: protectedProcedure
      .input(z.object({ endpoint: z.string().url().max(4096) }))
      .query(async ({ ctx, input }) => {
        const subscription = await prisma.pushSubscription.findUnique({
          where: { endpoint: input.endpoint },
          select: { accountId: true },
        })
        return { subscribed: subscription?.accountId === ctx.auth.user.id }
      }),
  }),
})
