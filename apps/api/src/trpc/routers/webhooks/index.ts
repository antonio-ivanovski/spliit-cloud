import { TRPCError } from '@trpc/server'
import { z } from 'zod'

import { prisma, type Prisma } from '@spliit/db'
import {
  WebhookApiVersion,
  WebhookDeliveryStatus,
  webhookEnvelopeSchema,
  webhookEventFilterSchema,
} from '@spliit/domain/webhooks'
import {
  JOB_NAMES,
  bossTransactionDb,
  env as jobsEnv,
  insertJobs,
} from '@spliit/jobs'

import { getApiBoss } from '../../../lib/api/boss'
import {
  CREATE_OPERATIONS,
  createRequestIdSchema,
  runIdempotentCreate,
} from '../../../lib/api/idempotency'
import { randomId } from '../../../lib/api/shared'
import {
  displayWebhookSecret,
  validateWebhookUrl,
} from '../../../lib/webhooks/security'
import { createTRPCRouter, protectedProcedure } from '../../init'

const endpointIdInput = z.object({ endpointId: z.string().min(1) })

async function requireEligibleAccount(accountId: string) {
  const account = await prisma.user.findUnique({
    where: { id: accountId },
    select: { isAnonymous: true, emailVerified: true },
  })
  if (!account || account.isAnonymous || !account.emailVerified) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Webhooks require a permanent account with a verified email',
    })
  }
  if (!jobsEnv.JOBS_ENABLED) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'Background jobs must be enabled to use webhooks',
    })
  }
}

async function ownedEndpoint(accountId: string, endpointId: string) {
  const endpoint = await prisma.webhookEndpoint.findFirst({
    where: { id: endpointId, accountId },
  })
  if (!endpoint) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Webhook not found' })
  }
  return endpoint
}

async function validatedUrl(value: string) {
  try {
    return (await validateWebhookUrl(value)).toString()
  } catch (error) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: error instanceof Error ? error.message : 'Invalid webhook URL',
      cause: error,
    })
  }
}

function canceledDeliveryData(reason: string) {
  return {
    status: WebhookDeliveryStatus.CANCELED,
    terminalAt: new Date(),
    lastErrorCode: reason,
    lastErrorMessage: 'Delivery canceled because the endpoint changed',
  }
}

async function cancelPending(
  tx: Prisma.TransactionClient,
  endpointId: string,
  reason: string,
  eventTypes?: string[],
) {
  if (!eventTypes) {
    await tx.webhookDelivery.updateMany({
      where: {
        endpointId,
        status: {
          in: [WebhookDeliveryStatus.PENDING, WebhookDeliveryStatus.PROCESSING],
        },
      },
      data: canceledDeliveryData(reason),
    })
    return
  }
  // Narrow cancellation to the unsubscribed event types so still-wanted
  // deliveries are not lost. The relation filter is resolved in code to keep
  // this compatible with every database client.
  const rows = await tx.webhookDelivery.findMany({
    where: {
      endpointId,
      status: {
        in: [WebhookDeliveryStatus.PENDING, WebhookDeliveryStatus.PROCESSING],
      },
    },
    select: { id: true, event: { select: { type: true } } },
  })
  const ids = rows
    .filter((row) => eventTypes.includes(row.event.type))
    .map((row) => row.id)
  if (ids.length === 0) return
  await tx.webhookDelivery.updateMany({
    where: { id: { in: ids } },
    data: canceledDeliveryData(reason),
  })
}

export const webhooksRouter = createTRPCRouter({
  list: protectedProcedure.query(async ({ ctx }) => {
    const endpoints = await prisma.webhookEndpoint.findMany({
      where: { accountId: ctx.auth.user.id },
      orderBy: { createdAt: 'asc' },
      include: {
        deliveries: {
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: 1,
          select: {
            id: true,
            status: true,
            createdAt: true,
            lastHttpStatus: true,
          },
        },
      },
    })
    return endpoints.map(({ deliveries, ...endpoint }) => ({
      ...endpoint,
      latestDelivery: deliveries[0] ?? null,
    }))
  }),

  create: protectedProcedure
    .input(
      z.object({
        requestId: createRequestIdSchema,
        name: z.string().trim().min(1).max(80),
        url: z.url().max(2048),
        enabled: z.boolean().default(false),
        events: webhookEventFilterSchema,
      }),
    )
    .mutation(async ({ input, ctx }) => {
      await requireEligibleAccount(ctx.auth.user.id)
      const url = await validatedUrl(input.url)
      const { value } = await runIdempotentCreate({
        accountId: ctx.auth.user.id,
        operation: CREATE_OPERATIONS.webhook,
        requestId: input.requestId,
        input: {
          name: input.name,
          url,
          enabled: input.enabled,
          events: input.events,
        },
        execute: async (tx) => {
          const id = randomId()
          const endpoint = await tx.webhookEndpoint.create({
            data: {
              id,
              accountId: ctx.auth.user.id,
              name: input.name,
              url,
              enabled: input.enabled,
              notifyCreated: input.events.created,
              notifyUpdated: input.events.updated,
              notifyDeleted: input.events.deleted,
              involvedOnly: input.events.involvedOnly,
            },
          })
          return { endpointId: id, secretVersion: endpoint.secretVersion }
        },
      })
      return {
        endpointId: value.endpointId,
        secret: displayWebhookSecret(value.endpointId, value.secretVersion),
      }
    }),

  update: protectedProcedure
    .input(
      endpointIdInput.extend({
        name: z.string().trim().min(1).max(80),
        url: z.url().max(2048),
        enabled: z.boolean(),
        events: webhookEventFilterSchema,
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const endpoint = await ownedEndpoint(ctx.auth.user.id, input.endpointId)
      const url = await validatedUrl(input.url)
      if (input.enabled) {
        await requireEligibleAccount(ctx.auth.user.id)
      }
      return prisma.$transaction(async (tx) => {
        if (url !== endpoint.url) {
          await cancelPending(tx, endpoint.id, 'ENDPOINT_URL_CHANGED')
        } else if (!input.enabled && endpoint.enabled) {
          await cancelPending(tx, endpoint.id, 'ENDPOINT_DISABLED')
        } else {
          // Unsubscribing an event type cancels its pending deliveries so a
          // filter change takes effect immediately. Still-subscribed types
          // are left untouched. (Toggling "involved only" needs no cancel:
          // delivery re-checks involvement at send time.)
          const unsubscribed = (
            [
              ['created', endpoint.notifyCreated],
              ['updated', endpoint.notifyUpdated],
              ['deleted', endpoint.notifyDeleted],
            ] as const
          )
            .filter(([, was]) => was)
            .filter(([operation]) => !input.events[operation])
            .flatMap(([operation]) => [
              `expense.${operation}`,
              `expenses.${operation}`,
            ])
          if (unsubscribed.length > 0) {
            await cancelPending(
              tx,
              endpoint.id,
              'ENDPOINT_FILTER_CHANGED',
              unsubscribed,
            )
          }
        }
        return tx.webhookEndpoint.update({
          where: { id: endpoint.id },
          data: {
            name: input.name,
            url,
            enabled: url !== endpoint.url ? false : input.enabled,
            notifyCreated: input.events.created,
            notifyUpdated: input.events.updated,
            notifyDeleted: input.events.deleted,
            involvedOnly: input.events.involvedOnly,
          },
        })
      })
    }),

  rotateSecret: protectedProcedure
    .input(endpointIdInput)
    .mutation(async ({ input, ctx }) => {
      const endpoint = await ownedEndpoint(ctx.auth.user.id, input.endpointId)
      const updated = await prisma.webhookEndpoint.update({
        where: { id: endpoint.id },
        data: { secretVersion: { increment: 1 } },
      })
      return {
        secret: displayWebhookSecret(updated.id, updated.secretVersion),
      }
    }),

  delete: protectedProcedure
    .input(endpointIdInput)
    .mutation(async ({ input, ctx }) => {
      const endpoint = await ownedEndpoint(ctx.auth.user.id, input.endpointId)
      await prisma.webhookEndpoint.delete({ where: { id: endpoint.id } })
    }),

  test: protectedProcedure
    .input(endpointIdInput)
    .mutation(async ({ input, ctx }) => {
      await requireEligibleAccount(ctx.auth.user.id)
      const endpoint = await ownedEndpoint(ctx.auth.user.id, input.endpointId)
      await validatedUrl(endpoint.url)
      const boss = await getApiBoss()
      if (!boss) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'Webhook delivery is unavailable',
        })
      }
      const eventId = randomId()
      const deliveryId = randomId()
      const now = new Date()
      const payload = webhookEnvelopeSchema.parse({
        id: eventId,
        apiVersion: WebhookApiVersion,
        type: 'webhook.test',
        occurredAt: now.toISOString(),
        data: { message: 'Spliit webhook test' },
      })
      await prisma.$transaction(async (tx) => {
        await tx.webhookEvent.create({
          data: {
            id: eventId,
            sourceKey: `webhook-test:${endpoint.id}:${eventId}`,
            type: 'webhook.test',
            occurredAt: now,
            payload: payload as unknown as Prisma.InputJsonValue,
          },
        })
        await tx.webhookDelivery.create({
          data: { id: deliveryId, endpointId: endpoint.id, eventId },
        })
        await insertJobs(boss, JOB_NAMES.WEBHOOK_DELIVER, [{ deliveryId }], {
          db: bossTransactionDb(tx),
        })
      })
      return { deliveryId }
    }),

  deliveries: protectedProcedure
    .input(
      endpointIdInput.extend({
        cursor: z.string().nullish(),
        limit: z.number().int().min(1).max(100).default(25),
      }),
    )
    .query(async ({ input, ctx }) => {
      await ownedEndpoint(ctx.auth.user.id, input.endpointId)
      const rows = await prisma.webhookDelivery.findMany({
        where: { endpointId: input.endpointId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
        take: input.limit + 1,
        include: {
          event: { select: { id: true, type: true, occurredAt: true } },
        },
      })
      const hasMore = rows.length > input.limit
      const deliveries = rows.slice(0, input.limit)
      return {
        deliveries,
        nextCursor: hasMore ? (deliveries.at(-1)?.id ?? null) : null,
      }
    }),

  delivery: protectedProcedure
    .input(z.object({ deliveryId: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      const delivery = await prisma.webhookDelivery.findFirst({
        where: {
          id: input.deliveryId,
          endpoint: { accountId: ctx.auth.user.id },
        },
        include: {
          event: true,
          attempts: { orderBy: { attempt: 'asc' } },
        },
      })
      if (!delivery) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Delivery not found',
        })
      }
      return delivery
    }),

  redeliver: protectedProcedure
    .input(z.object({ deliveryId: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const delivery = await prisma.webhookDelivery.findFirst({
        where: {
          id: input.deliveryId,
          endpoint: { accountId: ctx.auth.user.id },
        },
        include: { endpoint: { select: { enabled: true } } },
      })
      if (!delivery) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Delivery not found',
        })
      }
      // Disabled endpoints stay quiet: re-enable first, then resend — including
      // deliveries canceled while the endpoint was disabled.
      if (!delivery.endpoint.enabled) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'Enable the webhook before resending deliveries',
        })
      }
      const boss = await getApiBoss()
      if (!boss) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'Webhook delivery is unavailable',
        })
      }
      // Guard against racing an in-flight attempt: only settled deliveries may
      // be re-queued, and the flip + enqueue happen atomically.
      await prisma.$transaction(async (tx) => {
        const reset = await tx.webhookDelivery.updateMany({
          where: {
            id: delivery.id,
            status: {
              notIn: [
                WebhookDeliveryStatus.PENDING,
                WebhookDeliveryStatus.PROCESSING,
              ],
            },
          },
          data: {
            status: WebhookDeliveryStatus.PENDING,
            sentAt: null,
            terminalAt: null,
            lastAttemptAt: null,
            lastHttpStatus: null,
            lastErrorCode: null,
            lastErrorMessage: null,
          },
        })
        if (reset.count === 0) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'Delivery is already queued or in flight',
          })
        }
        await insertJobs(
          boss,
          JOB_NAMES.WEBHOOK_DELIVER,
          [{ deliveryId: delivery.id }],
          { db: bossTransactionDb(tx) },
        )
      })
    }),
})
