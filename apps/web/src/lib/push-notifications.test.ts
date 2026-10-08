import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  getPushRegistration,
  getPushSubscription,
  subscribeToPush,
} from './push-notifications'

function stubPushEnv(options?: {
  getRegistration?: () => Promise<unknown>
  permission?: NotificationPermission
}) {
  const notification = {
    requestPermission: vi
      .fn()
      .mockResolvedValue(options?.permission ?? 'granted'),
  }
  vi.stubGlobal('window', {
    isSecureContext: true,
    PushManager: class {},
    Notification: notification,
  })
  vi.stubGlobal('Notification', notification)
  vi.stubGlobal('navigator', {
    userAgent: 'vitest',
    serviceWorker: {
      getRegistration: options?.getRegistration ?? (async () => undefined),
    },
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('getPushSubscription', () => {
  it('returns null when push is unsupported', async () => {
    await expect(getPushSubscription()).resolves.toBeNull()
  })

  it('returns null when no service worker is registered', async () => {
    stubPushEnv()
    await expect(getPushSubscription()).resolves.toBeNull()
  })

  it('returns the subscription when a worker is registered', async () => {
    const subscription = { endpoint: 'https://push.example/sub' }
    stubPushEnv({
      getRegistration: async () => ({
        pushManager: { getSubscription: async () => subscription },
      }),
    })
    await expect(getPushSubscription()).resolves.toBe(subscription)
  })
})

describe('getPushRegistration', () => {
  it('returns null when push is unsupported', async () => {
    await expect(getPushRegistration()).resolves.toBeNull()
  })

  it('returns null without waiting when no worker is registered', async () => {
    stubPushEnv()
    await expect(getPushRegistration()).resolves.toBeNull()
  })

  it('returns the registration when a worker is registered', async () => {
    const registration = { scope: '/test' }
    stubPushEnv({
      getRegistration: async () => registration,
    })
    await expect(getPushRegistration()).resolves.toBe(registration)
  })
})

describe('subscribeToPush', () => {
  it('throws a clear error instead of hanging without a worker', async () => {
    stubPushEnv()
    await expect(subscribeToPush('key')).rejects.toThrow(
      'Push notifications are unsupported',
    )
  })

  it('throws when push is unsupported', async () => {
    await expect(subscribeToPush('key')).rejects.toThrow(
      'Push notifications are unsupported',
    )
  })
})
