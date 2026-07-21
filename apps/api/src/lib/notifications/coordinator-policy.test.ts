import {
  NotificationCategory,
  NotificationChannel,
} from '@spliit/domain/notifications'
import { afterEach, describe, expect, it, vi } from 'vitest'
import '../../test/mocks'
import { prismaMock } from '../../test/state'
import { resolveNotificationChannelsForIntents } from './coordinator-policy'
import type { ActivityNotificationIntent } from './types'

function intent(
  overrides: Partial<Omit<ActivityNotificationIntent, 'channels'>> = {},
): Omit<ActivityNotificationIntent, 'channels'> {
  return {
    activity: {
      activityId: 'activity-1',
      type: 'EXPENSE_UPDATED',
      groupId: 'group-1',
      actor: null,
      subject: { type: 'EXPENSE', id: 'expense-1' },
      data: { kind: 'expense', summary: 'Updated' },
      occurredAt: new Date('2026-07-21T12:00:00Z'),
    },
    category: NotificationCategory.EXPENSE_CHANGED,
    recipientAccountId: 'account-1',
    ...overrides,
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('resolveNotificationChannelsForIntents', () => {
  it('keeps an explicit PUSH choice when no push target exists', async () => {
    prismaMock.accountNotificationPreference.findMany.mockResolvedValue([
      {
        accountId: 'account-1',
        category: NotificationCategory.EXPENSE_CHANGED,
        channels: [NotificationChannel.PUSH],
      },
    ] as never)
    prismaMock.pushSubscription.findMany.mockResolvedValue([])
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await expect(
      resolveNotificationChannelsForIntents([intent()]),
    ).resolves.toEqual([[NotificationChannel.PUSH]])
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('no active push target exists'),
    )
  })

  it('uses the system email default when no preference or push target exists', async () => {
    prismaMock.accountNotificationPreference.findMany.mockResolvedValue([])
    prismaMock.pushSubscription.findMany.mockResolvedValue([])

    await expect(
      resolveNotificationChannelsForIntents([intent()]),
    ).resolves.toEqual([[NotificationChannel.PUSH]])
  })

  it('keeps durable email recommendations for bulk and group invitation activity', async () => {
    prismaMock.accountNotificationPreference.findMany.mockResolvedValue([])
    prismaMock.pushSubscription.findMany.mockResolvedValue([
      { accountId: 'account-1' },
    ] as never)

    await expect(
      resolveNotificationChannelsForIntents([
        intent({ category: NotificationCategory.EXPENSE_CHANGED }),
        intent({ category: NotificationCategory.GROUP_INVITE_RECEIVED }),
      ]),
    ).resolves.toEqual([
      [NotificationChannel.PUSH],
      [NotificationChannel.EMAIL, NotificationChannel.PUSH],
    ])
  })
})
