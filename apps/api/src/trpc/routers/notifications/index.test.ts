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
    prismaMock.pushSubscription.upsert.mockResolvedValue({
      id: 'push-1',
      endpoint: subscription.endpoint,
      updatedAt: new Date(),
    } as never)

    await makeCaller('acct-1').push.register(subscription)

    expect(prismaMock.pushSubscription.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { endpoint: subscription.endpoint },
        create: expect.objectContaining({
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
    expect(prismaMock.pushSubscription.upsert).not.toHaveBeenCalled()
  })

  it('removes only the authenticated account subscription', async () => {
    await makeCaller('acct-1').push.remove({ endpoint: subscription.endpoint })

    expect(prismaMock.pushSubscription.deleteMany).toHaveBeenCalledWith({
      where: { endpoint: subscription.endpoint, accountId: 'acct-1' },
    })
  })
})
