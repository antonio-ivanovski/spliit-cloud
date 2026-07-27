import { type NotificationDelivery, type Prisma } from '@spliit/db'
import {
  normalizedProviderErrorMetadataSchema,
  NotificationDeliveryStatus,
  NotificationFailureClassification,
  type NormalizedProviderErrorMetadata,
} from '@spliit/domain/notification-delivery'

const TERMINAL_STATUSES = new Set<string>([
  NotificationDeliveryStatus.SENT,
  NotificationDeliveryStatus.PERMANENT_FAILURE,
  NotificationDeliveryStatus.RETRY_EXHAUSTED,
])

const MAX_ERROR_CODE_LENGTH = 100
const MAX_ERROR_MESSAGE_LENGTH = 500

export type ClaimResult =
  | {
      outcome: 'acquired'
      leaseToken: string
      delivery: NotificationDelivery
    }
  | { outcome: 'terminal'; status: string }
  | { outcome: 'active_lease'; leaseExpiresAt: Date }
  | { outcome: 'missing' }

export type ProviderErrorMetadata = NormalizedProviderErrorMetadata

export type ProviderErrorClassification = 'transient' | 'permanent'

function freshLeaseToken(): string {
  return crypto.randomUUID()
}

function truncate(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value
}

function stripDangerousWhitespace(value: string): string {
  return value.replace(/[\r\n\t]+/g, ' ').trim()
}

export async function claimDelivery(
  tx: Prisma.TransactionClient,
  deliveryId: string,
  jobId: string,
  leaseDurationMs: number,
): Promise<ClaimResult> {
  const leaseToken = freshLeaseToken()
  const now = new Date()
  const leaseExpiresAt = new Date(now.getTime() + leaseDurationMs)

  const claim = await tx.notificationDelivery.updateMany({
    where: {
      id: deliveryId,
      OR: [
        { status: NotificationDeliveryStatus.PENDING },
        {
          status: NotificationDeliveryStatus.PROCESSING,
          leaseExpiresAt: { lt: now },
        },
      ],
    },
    data: {
      status: NotificationDeliveryStatus.PROCESSING,
      leaseToken,
      leaseJobId: jobId,
      leaseExpiresAt,
      lastAttemptAt: now,
      attemptCount: { increment: 1 },
    },
  })

  if (claim.count > 0) {
    const delivery = await tx.notificationDelivery.findUnique({
      where: { id: deliveryId },
    })
    if (!delivery) return { outcome: 'missing' }
    return { outcome: 'acquired', leaseToken, delivery }
  }

  const existing = await tx.notificationDelivery.findUnique({
    where: { id: deliveryId },
  })
  if (!existing) return { outcome: 'missing' }
  if (TERMINAL_STATUSES.has(existing.status)) {
    return { outcome: 'terminal', status: existing.status }
  }
  return {
    outcome: 'active_lease',
    leaseExpiresAt: existing.leaseExpiresAt ?? now,
  }
}

export async function markSent(
  tx: Prisma.TransactionClient,
  deliveryId: string,
  leaseToken: string,
): Promise<boolean> {
  const now = new Date()
  const result = await tx.notificationDelivery.updateMany({
    where: { id: deliveryId, leaseToken },
    data: {
      status: NotificationDeliveryStatus.SENT,
      sentAt: now,
      terminalAt: now,
      leaseToken: null,
      leaseJobId: null,
      leaseExpiresAt: null,
      lastErrorKind: null,
      lastErrorCode: null,
      lastProviderStatus: null,
      lastErrorMessage: null,
      lastErrorAt: null,
    },
  })
  return result.count > 0
}

export async function markTransientFailure(
  tx: Prisma.TransactionClient,
  deliveryId: string,
  leaseToken: string,
  error: ProviderErrorMetadata,
): Promise<boolean> {
  const result = await tx.notificationDelivery.updateMany({
    where: { id: deliveryId, leaseToken },
    data: {
      status: NotificationDeliveryStatus.PENDING,
      leaseToken: null,
      leaseJobId: null,
      leaseExpiresAt: null,
      lastErrorKind: error.kind,
      lastErrorCode: error.code,
      lastProviderStatus: error.providerStatus ?? null,
      lastErrorMessage: error.message,
      lastErrorAt: new Date(),
    },
  })
  return result.count > 0
}

export async function markPermanentFailure(
  tx: Prisma.TransactionClient,
  deliveryId: string,
  leaseToken: string,
  error: ProviderErrorMetadata,
): Promise<boolean> {
  const now = new Date()
  const result = await tx.notificationDelivery.updateMany({
    where: { id: deliveryId, leaseToken },
    data: {
      status: NotificationDeliveryStatus.PERMANENT_FAILURE,
      terminalAt: now,
      leaseToken: null,
      leaseJobId: null,
      leaseExpiresAt: null,
      lastErrorKind: error.kind,
      lastErrorCode: error.code,
      lastProviderStatus: error.providerStatus ?? null,
      lastErrorMessage: error.message,
      lastErrorAt: now,
    },
  })
  return result.count > 0
}

export async function markRetryExhausted(
  tx: Prisma.TransactionClient,
  deliveryId: string,
  leaseToken: string,
  error: ProviderErrorMetadata,
): Promise<boolean> {
  const now = new Date()
  const result = await tx.notificationDelivery.updateMany({
    where: { id: deliveryId, leaseToken },
    data: {
      status: NotificationDeliveryStatus.RETRY_EXHAUSTED,
      terminalAt: now,
      leaseToken: null,
      leaseJobId: null,
      leaseExpiresAt: null,
      lastErrorKind: error.kind,
      lastErrorCode: error.code,
      lastProviderStatus: error.providerStatus ?? null,
      lastErrorMessage: error.message,
      lastErrorAt: now,
    },
  })
  return result.count > 0
}

function safeErrorCode(value: unknown): string {
  if (typeof value === 'string')
    return truncate(stripDangerousWhitespace(value), MAX_ERROR_CODE_LENGTH)
  if (typeof value === 'number' || typeof value === 'boolean') {
    return truncate(
      stripDangerousWhitespace(String(value)),
      MAX_ERROR_CODE_LENGTH,
    )
  }
  return 'UNKNOWN_ERROR'
}

function safeErrorMessage(value: unknown): string {
  if (typeof value === 'string')
    return truncate(stripDangerousWhitespace(value), MAX_ERROR_MESSAGE_LENGTH)
  if (value instanceof Error) {
    return truncate(
      stripDangerousWhitespace(value.message || value.name),
      MAX_ERROR_MESSAGE_LENGTH,
    )
  }
  if (value === null || value === undefined) return 'Unknown provider error'
  try {
    return truncate(
      stripDangerousWhitespace(JSON.stringify(value)),
      MAX_ERROR_MESSAGE_LENGTH,
    )
  } catch {
    return 'Unserializable provider error'
  }
}

export function normalizeProviderError(
  error: unknown,
  classification: ProviderErrorClassification,
  providerStatus?: number,
): ProviderErrorMetadata {
  const baseKind =
    classification === 'transient'
      ? NotificationFailureClassification.TRANSIENT
      : NotificationFailureClassification.PERMANENT

  let kind: NormalizedProviderErrorMetadata['kind'] = baseKind
  let code = 'UNKNOWN'
  let message: string

  if (error && typeof error === 'object') {
    const errRecord = error as Record<string, unknown>
    const nestedCode = errRecord.code ?? errRecord.errorCode ?? errRecord.name
    if (typeof nestedCode === 'string' || typeof nestedCode === 'number') {
      code = safeErrorCode(nestedCode)
    }
    const nestedMessage = errRecord.message ?? errRecord.error
    message =
      nestedMessage !== undefined
        ? safeErrorMessage(nestedMessage)
        : safeErrorMessage(error)

    if (typeof errRecord.kind === 'string') {
      const allowed: ReadonlyArray<NormalizedProviderErrorMetadata['kind']> = [
        NotificationFailureClassification.TRANSIENT,
        NotificationFailureClassification.PERMANENT,
        NotificationFailureClassification.TARGET_GONE,
        NotificationFailureClassification.ENDPOINT_GONE,
        NotificationFailureClassification.DATA_CONTRACT,
      ]
      if (
        allowed.includes(
          errRecord.kind as NormalizedProviderErrorMetadata['kind'],
        )
      ) {
        kind = errRecord.kind as NormalizedProviderErrorMetadata['kind']
      }
    }
  } else {
    message = safeErrorMessage(error)
  }

  return normalizedProviderErrorMetadataSchema.parse({
    kind,
    code,
    providerStatus,
    message,
  })
}
