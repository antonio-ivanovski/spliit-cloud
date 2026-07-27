import {
  claimDelivery,
  markPermanentFailure,
  markRetryExhausted,
  markSent,
  markTransientFailure,
  normalizeProviderError,
} from '@spliit/api/lib/notifications/delivery-repository'
import {
  DELIVERY_LEASE_MS,
  PermanentDeliveryError,
  TransientDeliveryError,
  type EmailDeliverySender,
  type PushDeliverySender,
} from '@spliit/api/lib/notifications/delivery-senders'
import { deliverySnapshotV1Schema } from '@spliit/api/lib/notifications/delivery-snapshot'
import { emailDeliverySender } from '@spliit/api/lib/notifications/email-delivery-sender'
import { pushDeliverySender } from '@spliit/api/lib/notifications/push-delivery-sender'
import { prisma } from '@spliit/db'
import {
  NotificationFailureClassification,
  NotificationSnapshotVersion,
} from '@spliit/domain/notification-delivery'
import { NotificationChannel } from '@spliit/domain/notifications'
import type { JobHandlerContext } from '@spliit/jobs'

type SenderKind = 'email' | 'push'

function logEvent(
  level: 'info' | 'warn' | 'error',
  fields: Record<string, unknown>,
) {
  const entry = JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    component: 'notification-delivery',
    ...fields,
  })
  if (level === 'error') console.error(entry)
  else if (level === 'warn') console.warn(entry)
  else console.log(entry)
}

function dataContractError(code: string, message: string) {
  return {
    kind: NotificationFailureClassification.DATA_CONTRACT,
    code,
    message: message.slice(0, 500),
  }
}

async function invokeSender(
  sender: EmailDeliverySender | PushDeliverySender,
  kind: SenderKind,
  args: {
    deliveryId: string
    snapshot: ReturnType<typeof deliverySnapshotV1Schema.parse>
    recipientAccountId: string | null
    pushSubscriptionId: string | null
  },
): Promise<void> {
  if (kind === 'email') {
    if (!args.recipientAccountId) {
      throw new PermanentDeliveryError(
        'Email delivery missing recipientAccountId',
        'DATA_CONTRACT',
      )
    }
    await (sender as EmailDeliverySender).send({
      deliveryId: args.deliveryId,
      snapshot: args.snapshot,
      recipientAccountId: args.recipientAccountId,
    })
    return
  }
  if (!args.pushSubscriptionId) {
    throw new PermanentDeliveryError(
      'Push delivery missing pushSubscriptionId',
      'DATA_CONTRACT',
    )
  }
  await (sender as PushDeliverySender).send({
    deliveryId: args.deliveryId,
    snapshot: args.snapshot,
    pushSubscriptionId: args.pushSubscriptionId,
  })
}

export async function handleNotificationDelivery(
  deliveryId: string,
  context: JobHandlerContext,
): Promise<void> {
  // Phase 1: claim the delivery in a short transaction.
  // The lease is committed before any provider I/O begins.
  const claim = await prisma.$transaction((tx) =>
    claimDelivery(tx, deliveryId, context.jobId, DELIVERY_LEASE_MS),
  )

  if (claim.outcome === 'terminal') {
    logEvent('info', {
      message: 'delivery already terminal; acknowledging duplicate job',
      deliveryId,
      status: claim.status,
    })
    return
  }

  if (claim.outcome === 'active_lease') {
    logEvent('info', {
      message: 'delivery lease active; acknowledging duplicate transport job',
      deliveryId,
      leaseExpiresAt: claim.leaseExpiresAt.toISOString(),
    })
    return
  }

  if (claim.outcome === 'missing') {
    logEvent('warn', {
      message: 'delivery row missing for notification.deliver job',
      deliveryId,
    })
    return
  }

  const { leaseToken, delivery } = claim

  // Validate snapshot version after claim so we own the lease token.
  if (delivery.snapshotVersion !== NotificationSnapshotVersion.V1) {
    logEvent('error', {
      message: 'delivery snapshot version unsupported; permanent failure',
      deliveryId,
      snapshotVersion: delivery.snapshotVersion,
      expectedVersion: NotificationSnapshotVersion.V1,
    })
    await prisma.$transaction((tx) =>
      markPermanentFailure(
        tx,
        deliveryId,
        leaseToken,
        dataContractError(
          'INVALID_SNAPSHOT_VERSION',
          `Unsupported snapshot version ${delivery.snapshotVersion}; expected ${NotificationSnapshotVersion.V1}`,
        ),
      ),
    )
    return
  }

  const parsedSnapshot = deliverySnapshotV1Schema.safeParse(delivery.snapshot)
  if (!parsedSnapshot.success) {
    logEvent('error', {
      message: 'delivery snapshot failed schema parse',
      deliveryId,
      issues: parsedSnapshot.error.issues
        .slice(0, 5)
        .map((issue) => issue.path.join('.') || '<root>'),
    })
    await prisma.$transaction((tx) =>
      markPermanentFailure(
        tx,
        deliveryId,
        leaseToken,
        dataContractError(
          'SNAPSHOT_PARSE_FAILED',
          parsedSnapshot.error.message,
        ),
      ),
    )
    return
  }
  const snapshot = parsedSnapshot.data

  const senderKind: SenderKind | null =
    delivery.channel === NotificationChannel.EMAIL
      ? 'email'
      : delivery.channel === NotificationChannel.PUSH
        ? 'push'
        : null

  if (!senderKind) {
    await prisma.$transaction((tx) =>
      markPermanentFailure(
        tx,
        deliveryId,
        leaseToken,
        dataContractError(
          'UNKNOWN_CHANNEL',
          `Unsupported delivery channel ${delivery.channel}`,
        ),
      ),
    )
    return
  }

  const sender: EmailDeliverySender | PushDeliverySender =
    senderKind === 'email' ? emailDeliverySender : pushDeliverySender

  const isExhausted = context.retryCount >= context.retryLimit

  if (context.signal.aborted) {
    await prisma.$transaction((tx) =>
      markTransientFailure(tx, deliveryId, leaseToken, {
        kind: NotificationFailureClassification.TRANSIENT,
        code: 'CANCELLED',
        message: 'Job aborted before provider call',
      }),
    )
    logEvent('info', {
      message: 'delivery aborted; lease released back to PENDING',
      deliveryId,
      eventKey: delivery.eventKey,
      activityId: delivery.activityId,
      channel: delivery.channel,
    })
    throw new Error('notification.deliver job aborted')
  }

  // Phase 2: invoke the provider outside any database transaction.
  try {
    await invokeSender(sender, senderKind, {
      deliveryId,
      snapshot,
      recipientAccountId: delivery.recipientAccountId,
      pushSubscriptionId: delivery.pushSubscriptionId,
    })
    // Phase 3: finalize success in a short transaction.
    const updated = await prisma.$transaction((tx) =>
      markSent(tx, deliveryId, leaseToken),
    )
    if (!updated) {
      logEvent('warn', {
        message:
          'stale lease token on markSent; delivery transitioned elsewhere',
        deliveryId,
        eventKey: delivery.eventKey,
        activityId: delivery.activityId,
        channel: delivery.channel,
        classification: 'SENT_LOST',
      })
    }
    return
  } catch (error) {
    if (error instanceof PermanentDeliveryError) {
      const normalized = normalizeProviderError(
        error,
        'permanent',
        error.providerStatus,
      )
      await prisma.$transaction((tx) =>
        markPermanentFailure(tx, deliveryId, leaseToken, normalized),
      )
      logEvent('info', {
        message: 'delivery marked as permanent failure',
        deliveryId,
        eventKey: delivery.eventKey,
        activityId: delivery.activityId,
        channel: delivery.channel,
        classification: normalized.kind,
        providerStatus: normalized.providerStatus ?? null,
      })
      return
    }

    const providerStatus =
      error instanceof TransientDeliveryError ? error.providerStatus : undefined
    const normalized = normalizeProviderError(
      error,
      'transient',
      providerStatus,
    )

    if (isExhausted) {
      await prisma.$transaction((tx) =>
        markRetryExhausted(tx, deliveryId, leaseToken, normalized),
      )
      logEvent('warn', {
        message: 'delivery retry exhausted; routing to DLQ',
        deliveryId,
        eventKey: delivery.eventKey,
        activityId: delivery.activityId,
        channel: delivery.channel,
        classification: normalized.kind,
        providerStatus: normalized.providerStatus ?? null,
        attemptCount: delivery.attemptCount,
        retryCount: context.retryCount,
        retryLimit: context.retryLimit,
      })
      throw error
    }

    await prisma.$transaction((tx) =>
      markTransientFailure(tx, deliveryId, leaseToken, normalized),
    )
    logEvent('warn', {
      message: 'delivery transient failure; returning to PENDING',
      deliveryId,
      eventKey: delivery.eventKey,
      activityId: delivery.activityId,
      channel: delivery.channel,
      classification: normalized.kind,
      providerStatus: normalized.providerStatus ?? null,
      attemptCount: delivery.attemptCount,
    })
    throw error
  }
}
