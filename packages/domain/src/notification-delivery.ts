import * as z from 'zod'

export const NotificationDeliveryStatus = {
  PENDING: 'PENDING',
  PROCESSING: 'PROCESSING',
  SENT: 'SENT',
  PERMANENT_FAILURE: 'PERMANENT_FAILURE',
  RETRY_EXHAUSTED: 'RETRY_EXHAUSTED',
} as const

export type NotificationDeliveryStatus =
  (typeof NotificationDeliveryStatus)[keyof typeof NotificationDeliveryStatus]

export const notificationDeliveryStatusValues = [
  NotificationDeliveryStatus.PENDING,
  NotificationDeliveryStatus.PROCESSING,
  NotificationDeliveryStatus.SENT,
  NotificationDeliveryStatus.PERMANENT_FAILURE,
  NotificationDeliveryStatus.RETRY_EXHAUSTED,
] as const

export const notificationDeliveryStatusSchema = z.enum(
  notificationDeliveryStatusValues,
)

export const NotificationFailureClassification = {
  TRANSIENT: 'TRANSIENT',
  PERMANENT: 'PERMANENT',
  TARGET_GONE: 'TARGET_GONE',
  ENDPOINT_GONE: 'ENDPOINT_GONE',
  DATA_CONTRACT: 'DATA_CONTRACT',
} as const

export type NotificationFailureClassification =
  (typeof NotificationFailureClassification)[keyof typeof NotificationFailureClassification]

export const notificationFailureClassificationValues = [
  NotificationFailureClassification.TRANSIENT,
  NotificationFailureClassification.PERMANENT,
  NotificationFailureClassification.TARGET_GONE,
  NotificationFailureClassification.ENDPOINT_GONE,
  NotificationFailureClassification.DATA_CONTRACT,
] as const

export const notificationFailureClassificationSchema = z.enum(
  notificationFailureClassificationValues,
)

export function emailTargetKey(accountId: string): string {
  return `account:${accountId}`
}

export function pushTargetKey(pushSubscriptionId: string): string {
  return `push:${pushSubscriptionId}`
}

export const NotificationSnapshotVersion = {
  V1: 1,
} as const

export type NotificationSnapshotVersion =
  (typeof NotificationSnapshotVersion)[keyof typeof NotificationSnapshotVersion]

export const notificationSnapshotVersionSchema = z.literal(
  NotificationSnapshotVersion.V1,
)

export const normalizedProviderErrorMetadataSchema = z.object({
  kind: notificationFailureClassificationSchema,
  code: z.string().max(100),
  providerStatus: z.number().optional(),
  message: z.string().max(500),
})

export type NormalizedProviderErrorMetadata = z.infer<
  typeof normalizedProviderErrorMetadataSchema
>
