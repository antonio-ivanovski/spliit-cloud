import { describe, expect, it } from 'vitest'
import {
  emailTargetKey,
  normalizedProviderErrorMetadataSchema,
  NotificationDeliveryStatus,
  notificationDeliveryStatusSchema,
  NotificationFailureClassification,
  notificationFailureClassificationSchema,
  NotificationSnapshotVersion,
  notificationSnapshotVersionSchema,
  pushTargetKey,
} from './notification-delivery'

describe('notification delivery contracts', () => {
  it('validates delivery statuses', () => {
    for (const status of Object.values(NotificationDeliveryStatus)) {
      expect(notificationDeliveryStatusSchema.parse(status)).toBe(status)
    }
    expect(() => notificationDeliveryStatusSchema.parse('FAILED')).toThrow()
  })

  it('validates failure classifications', () => {
    for (const classification of Object.values(
      NotificationFailureClassification,
    )) {
      expect(
        notificationFailureClassificationSchema.parse(classification),
      ).toBe(classification)
    }
    expect(() =>
      notificationFailureClassificationSchema.parse('UNKNOWN'),
    ).toThrow()
  })

  it('produces canonical target keys', () => {
    expect(emailTargetKey('account-id')).toBe('account:account-id')
    expect(pushTargetKey('subscription-id')).toBe('push:subscription-id')
  })

  it('enforces provider error metadata bounds', () => {
    const metadata = {
      kind: NotificationFailureClassification.TRANSIENT,
      code: 'x'.repeat(100),
      providerStatus: 503,
      message: 'x'.repeat(500),
    }

    expect(normalizedProviderErrorMetadataSchema.parse(metadata)).toEqual(
      metadata,
    )
    expect(() =>
      normalizedProviderErrorMetadataSchema.parse({
        ...metadata,
        code: 'x'.repeat(101),
      }),
    ).toThrow()
    expect(() =>
      normalizedProviderErrorMetadataSchema.parse({
        ...metadata,
        message: 'x'.repeat(501),
      }),
    ).toThrow()
  })

  it('validates snapshot version 1', () => {
    expect(
      notificationSnapshotVersionSchema.parse(NotificationSnapshotVersion.V1),
    ).toBe(1)
    expect(() => notificationSnapshotVersionSchema.parse(2)).toThrow()
  })
})
