import { prisma } from '@spliit/db'
import {
  WebhookDeliveryStatus,
  deriveViewer,
  webhookEnvelopeSchema,
} from '@spliit/domain/webhooks'
import type { JobHandlerContext } from '@spliit/jobs'

import { randomId } from '../api/shared'
import { getWebhookRelayConfig } from '../env'
import {
  buildRelayEnvelope,
  canonicalizeRelayDestination,
  isTransientDnsError,
  resolveWebhookTarget,
  sendWebhookRelayRequest,
  sendWebhookRequest,
  standardWebhookHeaders,
} from './security'

type Failure = {
  code: string
  message: string
  httpStatus?: number
  transient: boolean
}

export function classifyWebhookResponse(status: number): Failure | null {
  if (status >= 200 && status < 300) return null
  const transient =
    status === 408 ||
    status === 409 ||
    status === 425 ||
    status === 429 ||
    status >= 500
  return {
    code: `HTTP_${status}`,
    message: `Webhook endpoint responded with HTTP ${status}`,
    httpStatus: status,
    transient,
  }
}

async function recordFailure(args: {
  deliveryId: string
  endpointId: string
  attempt: number
  attemptId: string
  startedAt: Date
  failure: Failure
  exhausted: boolean
}) {
  const finishedAt = new Date()
  const terminal = !args.failure.transient || args.exhausted
  await prisma.webhookDeliveryAttempt.update({
    where: { id: args.attemptId },
    data: {
      finishedAt,
      outcome: terminal ? 'FAILED' : 'RETRYING',
      httpStatus: args.failure.httpStatus,
      durationMs: finishedAt.getTime() - args.startedAt.getTime(),
      errorCode: args.failure.code,
      errorMessage: args.failure.message.slice(0, 500),
    },
  })
  // Guard against resurrecting deliveries canceled mid-flight (disable /
  // URL change / membership end). Only the claim owner (PROCESSING) may
  // transition back to PENDING or to a terminal failure state.
  const flipped = await prisma.webhookDelivery.updateMany({
    where: { id: args.deliveryId, status: WebhookDeliveryStatus.PROCESSING },
    data: {
      status: terminal
        ? args.failure.transient
          ? WebhookDeliveryStatus.RETRY_EXHAUSTED
          : WebhookDeliveryStatus.PERMANENT_FAILURE
        : WebhookDeliveryStatus.PENDING,
      lastAttemptAt: finishedAt,
      lastHttpStatus: args.failure.httpStatus,
      lastErrorCode: args.failure.code,
      lastErrorMessage: args.failure.message.slice(0, 500),
      terminalAt: terminal ? finishedAt : null,
    },
  })
  // A delivery canceled mid-flight stays CANCELED and must not count toward
  // endpoint health either.
  if (flipped.count > 0) {
    await prisma.webhookEndpoint.update({
      where: { id: args.endpointId },
      data: { lastFailureAt: finishedAt },
    })
  }
}

/**
 * Personalizes the shared stored event payload for one recipient. Attaches the
 * endpoint owner's viewer block (paid / owes / net / involved, derived with
 * zero extra queries) and, for involved-only endpoints, prunes batch entries
 * the owner has no stake in. Returns null when an involved-only endpoint has
 * nothing to receive — the planner normally skips those, so null here is a
 * defensive guard. Unknown payload shapes and non-expense events (webhook.test)
 * pass through unchanged, and the stored event row is never mutated: only the
 * per-delivery wire body differs.
 */
export function personalizePayloadForDelivery(
  payload: unknown,
  recipient: { accountId: string; involvedOnly: boolean },
): Record<string, unknown> | null {
  const record =
    typeof payload === 'object' && payload !== null
      ? (payload as Record<string, unknown>)
      : null
  if (!record) return record
  const parsed = webhookEnvelopeSchema.safeParse(payload)
  if (!parsed.success) return record
  const data = parsed.data.data
  if ('expense' in data) {
    const viewer = deriveViewer(data.expense, recipient.accountId)
    if (recipient.involvedOnly && !viewer.involved) return null
    return { ...record, data: { ...data, viewer } }
  }
  if ('expenses' in data) {
    const expenses = data.expenses.map((row) => ({
      ...row,
      viewer: deriveViewer(row.expense, recipient.accountId),
    }))
    const kept = recipient.involvedOnly
      ? expenses.filter((row) => row.viewer.involved)
      : expenses
    if (kept.length === 0) return null
    return { ...record, data: { ...data, expenses: kept } }
  }
  return record
}

export async function handleWebhookDelivery(
  deliveryId: string,
  context: JobHandlerContext<'webhook.deliver'>,
): Promise<void> {
  const delivery = await prisma.webhookDelivery.findUnique({
    where: { id: deliveryId },
    include: { endpoint: { include: { account: true } }, event: true },
  })
  if (!delivery) return
  if (
    delivery.status === WebhookDeliveryStatus.SENT ||
    delivery.status === WebhookDeliveryStatus.PERMANENT_FAILURE ||
    delivery.status === WebhookDeliveryStatus.RETRY_EXHAUSTED ||
    delivery.status === WebhookDeliveryStatus.CANCELED
  ) {
    return
  }
  if (
    (!delivery.endpoint.enabled && delivery.event.type !== 'webhook.test') ||
    delivery.endpoint.account.isAnonymous ||
    !delivery.endpoint.account.emailVerified
  ) {
    await prisma.webhookDelivery.update({
      where: { id: delivery.id },
      data: {
        status: WebhookDeliveryStatus.CANCELED,
        terminalAt: new Date(),
        lastErrorCode: 'ENDPOINT_DISABLED',
        lastErrorMessage: 'Webhook endpoint is disabled or ineligible',
      },
    })
    return
  }
  if (delivery.event.groupId && !delivery.event.allowAfterDelete) {
    const membership = await prisma.groupMember.findUnique({
      where: {
        groupId_accountId: {
          groupId: delivery.event.groupId,
          accountId: delivery.endpoint.accountId,
        },
      },
      select: { status: true },
    })
    if (membership?.status !== 'ACTIVE') {
      await prisma.webhookDelivery.update({
        where: { id: delivery.id },
        data: {
          status: WebhookDeliveryStatus.CANCELED,
          terminalAt: new Date(),
          lastErrorCode: 'MEMBERSHIP_ENDED',
          lastErrorMessage: 'Account is no longer an active group member',
        },
      })
      return
    }
  }

  // Per-recipient personalization of the shared stored payload: owner viewer
  // block plus involved-only batch pruning. Pruned to nothing (defensive —
  // the planner skips these) cancels without claiming or sending.
  const personalized = personalizePayloadForDelivery(delivery.event.payload, {
    accountId: delivery.endpoint.accountId,
    involvedOnly: delivery.endpoint.involvedOnly,
  })
  if (!personalized) {
    await prisma.webhookDelivery.update({
      where: { id: delivery.id },
      data: {
        status: WebhookDeliveryStatus.CANCELED,
        terminalAt: new Date(),
        lastErrorCode: 'NOT_INVOLVED',
        lastErrorMessage:
          'Endpoint owner is not involved in this expense event',
      },
    })
    return
  }

  const claimed = await prisma.webhookDelivery.updateMany({
    where: {
      id: delivery.id,
      status: WebhookDeliveryStatus.PENDING,
    },
    data: {
      status: WebhookDeliveryStatus.PROCESSING,
      attemptCount: { increment: 1 },
      lastAttemptAt: new Date(),
    },
  })
  if (claimed.count === 0) return

  const attempt = delivery.attemptCount + 1
  const startedAt = new Date()
  const attemptId = randomId()
  await prisma.webhookDeliveryAttempt.create({
    data: {
      id: attemptId,
      deliveryId: delivery.id,
      attempt,
      startedAt,
    },
  })

  let target: Awaited<ReturnType<typeof resolveWebhookTarget>>
  try {
    target = await resolveWebhookTarget(delivery.endpoint.url)
  } catch (error) {
    const transient = isTransientDnsError(error)
    await recordFailure({
      deliveryId: delivery.id,
      endpointId: delivery.endpoint.id,
      attempt,
      attemptId,
      startedAt,
      exhausted: transient ? context.retryCount >= context.retryLimit : true,
      failure: {
        code: transient ? 'DNS_TRANSIENT' : 'INVALID_ENDPOINT',
        message: error instanceof Error ? error.message : String(error),
        transient,
      },
    })
    if (transient && context.retryCount < context.retryLimit) {
      throw error instanceof Error ? error : new Error(String(error))
    }
    return
  }

  const body = JSON.stringify(personalized)
  const headers = standardWebhookHeaders({
    endpointId: delivery.endpoint.id,
    secretVersion: delivery.endpoint.secretVersion,
    eventId: delivery.event.id,
    body,
  })
  // Relay mode sends the unchanged body through the configured Cloudflare
  // Worker so destinations never see the server IP. There is intentionally no
  // fallback to direct delivery: falling back could both leak the server IP
  // and deliver the event twice.
  const relay = getWebhookRelayConfig()
  const send = relay
    ? () => {
        const envelope = buildRelayEnvelope({
          destination: canonicalizeRelayDestination(delivery.endpoint.url),
          body,
          requestId: attemptId,
          secret: relay.secret,
        })
        return sendWebhookRelayRequest({
          relayUrl: relay.url,
          headers: { ...headers, ...envelope.headers },
          body,
        })
      }
    : () => sendWebhookRequest({ target, headers, body })
  try {
    const status = await send()
    const failure = classifyWebhookResponse(status)
    if (failure) {
      const exhausted = context.retryCount >= context.retryLimit
      await recordFailure({
        deliveryId: delivery.id,
        endpointId: delivery.endpoint.id,
        attempt,
        attemptId,
        startedAt,
        failure,
        exhausted,
      })
      if (failure.transient && !exhausted) {
        throw new Error(failure.message)
      }
      return
    }

    const finishedAt = new Date()
    await prisma.webhookDeliveryAttempt.update({
      where: { id: attemptId },
      data: {
        finishedAt,
        outcome: 'SENT',
        httpStatus: status,
        durationMs: finishedAt.getTime() - startedAt.getTime(),
      },
    })
    // Do not overwrite an explicit CANCELED set mid-flight.
    const flipped = await prisma.webhookDelivery.updateMany({
      where: { id: delivery.id, status: WebhookDeliveryStatus.PROCESSING },
      data: {
        status: WebhookDeliveryStatus.SENT,
        lastHttpStatus: status,
        lastErrorCode: null,
        lastErrorMessage: null,
        sentAt: finishedAt,
        terminalAt: finishedAt,
      },
    })
    if (flipped.count > 0) {
      await prisma.webhookEndpoint.update({
        where: { id: delivery.endpoint.id },
        data: { lastSuccessAt: finishedAt },
      })
    }
  } catch (error) {
    const current = await prisma.webhookDelivery.findUnique({
      where: { id: delivery.id },
      select: { status: true },
    })
    // Explicit cancellation wins over a late network failure — never revive
    // CANCELED (or already-terminal) deliveries back to PENDING.
    if (current?.status !== WebhookDeliveryStatus.PROCESSING) {
      if (current?.status === WebhookDeliveryStatus.PENDING) throw error
      return
    }
    const exhausted = context.retryCount >= context.retryLimit
    await recordFailure({
      deliveryId: delivery.id,
      endpointId: delivery.endpoint.id,
      attempt,
      attemptId,
      startedAt,
      exhausted,
      failure: {
        code:
          error instanceof Error && /timed out/i.test(error.message)
            ? 'TIMEOUT'
            : 'NETWORK_ERROR',
        message: error instanceof Error ? error.message : String(error),
        transient: true,
      },
    })
    if (!exhausted) throw error
  }
}
