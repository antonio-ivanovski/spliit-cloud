import { prisma } from '@spliit/db'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { randomId } from '../../../lib/api/shared'
import {
  getNotificationPreferences,
  preferenceInputSchema,
  saveNotificationPreferences,
} from '../../../lib/notifications/preferences'
import {
  isPushConfigured,
  pushVapidPublicKey,
} from '../../../lib/notifications/push'
import { createTRPCRouter, protectedProcedure } from '../../init'

const subscriptionSchema = z.object({
  endpoint: z.url().max(4096),
  keys: z.object({
    p256dh: z.string().min(1).max(512),
    auth: z.string().min(1).max(512),
  }),
})

export const notificationsRouter = createTRPCRouter({
  preferences: createTRPCRouter({
    get: protectedProcedure
      .input(z.object({ accountId: z.string().min(1) }))
      .query(({ ctx, input }) => {
        if (input.accountId !== ctx.auth.user.id) {
          throw new TRPCError({ code: 'FORBIDDEN' })
        }
        return getNotificationPreferences(ctx.auth.user.id)
      }),
    save: protectedProcedure
      .input(preferenceInputSchema)
      .mutation(({ ctx, input }) =>
        saveNotificationPreferences(ctx.auth.user.id, input),
      ),
  }),
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
        if (existing?.accountId && existing.accountId !== accountId) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'This browser subscription belongs to another account',
          })
        }

        let row
        try {
          row = existing
            ? await prisma.pushSubscription.update({
                where: { id: existing.id },
                data: {
                  p256dh: input.keys.p256dh,
                  auth: input.keys.auth,
                  userAgent: input.userAgent ?? null,
                },
                select: { id: true, endpoint: true, updatedAt: true },
              })
            : await prisma.pushSubscription.create({
                data: {
                  id: randomId(),
                  accountId,
                  endpoint: input.endpoint,
                  p256dh: input.keys.p256dh,
                  auth: input.keys.auth,
                  userAgent: input.userAgent ?? null,
                },
                select: { id: true, endpoint: true, updatedAt: true },
              })
        } catch (error) {
          const raced = await prisma.pushSubscription.findUnique({
            where: { endpoint: input.endpoint },
            select: { accountId: true },
          })
          if (raced?.accountId !== accountId) {
            throw new TRPCError({
              code: 'CONFLICT',
              message: 'This browser subscription belongs to another account',
              cause: error,
            })
          }
          row = await prisma.pushSubscription.update({
            where: { endpoint: input.endpoint },
            data: {
              p256dh: input.keys.p256dh,
              auth: input.keys.auth,
              userAgent: input.userAgent ?? null,
            },
            select: { id: true, endpoint: true, updatedAt: true },
          })
        }
        return { subscription: row }
      }),

    remove: protectedProcedure
      .input(z.object({ endpoint: z.url().max(4096) }))
      .mutation(async ({ ctx, input }) => {
        await prisma.pushSubscription.deleteMany({
          where: { endpoint: input.endpoint, accountId: ctx.auth.user.id },
        })
        return { removed: true }
      }),

    status: protectedProcedure
      .input(z.object({ endpoint: z.url().max(4096) }))
      .query(async ({ ctx, input }) => {
        const subscription = await prisma.pushSubscription.findUnique({
          where: { endpoint: input.endpoint },
          select: { accountId: true },
        })
        return { subscribed: subscription?.accountId === ctx.auth.user.id }
      }),
  }),
})
