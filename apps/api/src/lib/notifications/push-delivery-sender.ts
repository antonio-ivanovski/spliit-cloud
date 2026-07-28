import { prisma } from '@spliit/db'

import {
  PermanentDeliveryError,
  TransientDeliveryError,
  type PushDeliverySender,
} from './delivery-senders'
import type { DeliverySnapshotV1 } from './delivery-snapshot'
import { sendPushNotification } from './push'

const TRANSIENT_NETWORK_CODES = new Set([
  'ETIMEDOUT',
  'ECONNRESET',
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EPIPE',
  'ENETUNREACH',
  'EHOSTUNREACH',
])

function errorRecord(err: unknown): {
  statusCode?: number
  code?: string
  message: string
} {
  if (!err || typeof err !== 'object') {
    return { message: 'Unknown push error' }
  }
  const record = err as Record<string, unknown>
  const statusCode =
    typeof record.statusCode === 'number' ? record.statusCode : undefined
  const code = typeof record.code === 'string' ? record.code : undefined
  const rawMessage =
    typeof record.message === 'string' && record.message.length > 0
      ? record.message
      : 'Push send failed'
  return {
    statusCode,
    code,
    message: rawMessage.replace(/\s+/g, ' ').trim().slice(0, 200),
  }
}

function isPermanentStatus(statusCode: number | undefined): boolean {
  return statusCode === 404 || statusCode === 410
}

function isTransientStatus(statusCode: number | undefined): boolean {
  if (statusCode == null) return false
  if (statusCode === 429) return true
  if (statusCode >= 500 && statusCode < 600) return true
  if (statusCode >= 400 && statusCode < 500) return true
  return false
}

export class PushDeliverySenderImpl implements PushDeliverySender {
  async send(args: {
    deliveryId: string
    snapshot: DeliverySnapshotV1
    pushSubscriptionId: string
  }): Promise<void> {
    if (!args.snapshot.push) {
      throw new PermanentDeliveryError(
        'Snapshot missing push presentation fields',
        'DATA_CONTRACT',
      )
    }

    const subscription = await prisma.pushSubscription.findUnique({
      where: { id: args.pushSubscriptionId },
      select: { id: true, endpoint: true, p256dh: true, auth: true },
    })
    if (!subscription) {
      throw new PermanentDeliveryError(
        'Push subscription not found',
        'TARGET_GONE',
      )
    }

    const push = args.snapshot.push
    const payload = {
      version: 1 as const,
      kind: 'activity' as const,
      activityId: args.deliveryId,
      title: push.title,
      body: push.body,
      url: push.url,
      ...(push.tag ? { tag: push.tag } : {}),
    }

    try {
      await sendPushNotification(subscription, payload)
      return
    } catch (error) {
      const { statusCode, code, message } = errorRecord(error)
      if (isPermanentStatus(statusCode)) {
        await prisma.pushSubscription
          .delete({ where: { id: args.pushSubscriptionId } })
          .catch(() => undefined)
        throw new PermanentDeliveryError(
          `Push endpoint gone: ${message}`,
          code ?? `HTTP_${statusCode ?? 'UNKNOWN'}`,
          statusCode,
        )
      }
      if (code && TRANSIENT_NETWORK_CODES.has(code)) {
        throw new TransientDeliveryError(
          `Push transport error: ${message}`,
          code,
        )
      }
      if (isTransientStatus(statusCode)) {
        throw new TransientDeliveryError(
          `Push provider error: ${message}`,
          code ?? `HTTP_${statusCode}`,
          statusCode,
        )
      }
      throw new TransientDeliveryError(
        `Push send failed: ${message}`,
        code ?? 'UNKNOWN',
        statusCode,
      )
    }
  }
}

export const pushDeliverySender: PushDeliverySender =
  new PushDeliverySenderImpl()
