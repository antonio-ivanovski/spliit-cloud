import {
  NotificationCategory,
  NotificationChannel,
} from '@spliit/domain/notifications'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import '../../test/mocks'
import { prismaMock, resetPrisma } from '../../test/state'

vi.mock('./push', () => ({ isPushConfigured: true }))

import { removeEmailPreference } from './preferences'

describe('notification preferences', () => {
  beforeEach(() => {
    resetPrisma()
    prismaMock.accountNotificationPreference.findMany.mockResolvedValue([])
  })

  it('does not disable an implicit comment push default from an old email unsubscribe link', async () => {
    prismaMock.accountNotificationPreference.findUnique.mockResolvedValue(null)
    prismaMock.pushSubscription.count.mockResolvedValue(1)

    const result = await removeEmailPreference(
      'account-1',
      NotificationCategory.EXPENSE_COMMENT,
    )

    expect(
      prismaMock.accountNotificationPreference.upsert,
    ).not.toHaveBeenCalled()
    expect(
      prismaMock.accountNotificationPreference.deleteMany,
    ).not.toHaveBeenCalled()
    expect(
      result.categories.find(
        ({ category }) => category === NotificationCategory.EXPENSE_COMMENT,
      )?.effectiveChannels,
    ).toEqual([NotificationChannel.PUSH])
  })
})
