import {
  NotificationCategory,
  NotificationChannel,
} from '@spliit/domain/notifications'
import { describe, expect, it } from 'vitest'
import '../../../test/mocks'
import { prismaMock } from '../../../test/state'
import { notificationsRouter } from './index'

function makeCaller(accountId = 'acct-1') {
  return notificationsRouter.createCaller({
    auth: {
      session: { id: 'sess-1' },
      user: {
        id: accountId,
        email: `${accountId}@example.com`,
        emailVerified: true,
        name: 'Alice',
      },
    },
  } as never)
}

const subscription = {
  endpoint: 'https://push.example.test/subscription-1',
  keys: { p256dh: 'public-key', auth: 'auth-secret' },
  userAgent: 'test-browser',
}

describe('notifications.push', () => {
  it('returns configuration without exposing the private VAPID key', async () => {
    const result = await makeCaller().push.getConfig()

    expect(result).toHaveProperty('configured')
    expect(result).toHaveProperty('vapidPublicKey')
    expect(result).not.toHaveProperty('privateKey')
  })

  it('registers a subscription for the authenticated account', async () => {
    prismaMock.pushSubscription.findUnique.mockResolvedValue(null)
    prismaMock.pushSubscription.create.mockResolvedValue({
      id: 'push-1',
      endpoint: subscription.endpoint,
      updatedAt: new Date(),
    } as never)

    await makeCaller('acct-1').push.register(subscription)

    expect(prismaMock.pushSubscription.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          accountId: 'acct-1',
          p256dh: subscription.keys.p256dh,
          auth: subscription.keys.auth,
        }),
      }),
    )
  })

  it('rejects a subscription already owned by another account', async () => {
    prismaMock.pushSubscription.findUnique.mockResolvedValue({
      id: 'push-1',
      accountId: 'acct-other',
    } as never)

    await expect(
      makeCaller('acct-1').push.register(subscription),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
    })
    expect(prismaMock.pushSubscription.create).not.toHaveBeenCalled()
  })

  it('removes only the authenticated account subscription', async () => {
    await makeCaller('acct-1').push.remove({ endpoint: subscription.endpoint })

    expect(prismaMock.pushSubscription.deleteMany).toHaveBeenCalledWith({
      where: { endpoint: subscription.endpoint, accountId: 'acct-1' },
    })
  })
})

describe('notifications.preferences', () => {
  it('returns inherited defaults and push-target availability', async () => {
    prismaMock.accountNotificationPreference.findMany.mockResolvedValue([])
    prismaMock.pushSubscription.count.mockResolvedValue(0)
    const result = await makeCaller().preferences.get({ accountId: 'acct-1' })
    expect(result.systemDefault).toBe('EMAIL_BY_DEFAULT')
    expect(result.hasExplicitPreferences).toBe(false)
    expect(result).not.toHaveProperty('global')
    expect(result.categories).toHaveLength(8)
    expect(result.categories[0].channels).toBeNull()
    expect(result.categories[0].recommendedChannels).toEqual([
      NotificationChannel.EMAIL,
      NotificationChannel.PUSH,
    ])
    expect(result.categories[0].inheritedChannels).toEqual([
      NotificationChannel.EMAIL,
    ])
  })

  it('rejects a cache scope for another account', async () => {
    await expect(
      makeCaller('acct-1').preferences.get({ accountId: 'acct-other' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('saves only supplied overrides and null removes one', async () => {
    prismaMock.accountNotificationPreference.findMany.mockResolvedValue([])
    prismaMock.pushSubscription.count.mockResolvedValue(0)
    await makeCaller().preferences.save({
      preferences: [
        {
          category: NotificationCategory.EXPENSE_CHANGED,
          channels: [NotificationChannel.EMAIL],
        },
      ],
    })
    expect(
      prismaMock.accountNotificationPreference.upsert,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          accountId_category: {
            accountId: 'acct-1',
            category: NotificationCategory.EXPENSE_CHANGED,
          },
        },
      }),
    )
  })

  it('accepts a distinct recurring-expense preference category', async () => {
    prismaMock.accountNotificationPreference.findMany.mockResolvedValue([])
    prismaMock.pushSubscription.count.mockResolvedValue(0)
    await makeCaller().preferences.save({
      preferences: [
        {
          category: NotificationCategory.RECURRING_EXPENSE_CREATED,
          channels: [NotificationChannel.PUSH],
        },
      ],
    })
    expect(
      prismaMock.accountNotificationPreference.upsert,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          accountId_category: {
            accountId: 'acct-1',
            category: NotificationCategory.RECURRING_EXPENSE_CREATED,
          },
        },
      }),
    )
  })

  it('rejects duplicate channels instead of silently normalizing them', async () => {
    await expect(
      makeCaller().preferences.save({
        preferences: [
          {
            category: NotificationCategory.EXPENSE_CHANGED,
            channels: [NotificationChannel.PUSH, NotificationChannel.PUSH],
          },
        ],
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })
})
