import { describe, expect, it, vi } from 'vitest'
import '../../../test/mocks'

async function loadRouterModules() {
  vi.stubEnv('EMAIL_UNSUBSCRIBE_SECRET', 'f'.repeat(32))
  vi.resetModules()
  return {
    ...(await import('../../../lib/notifications/unsubscribe')),
    ...(await import('./index')),
  }
}

describe('notifications.unsubscribe.preview', () => {
  it('returns only the category for a valid token without requiring auth', async () => {
    const { createEmailUnsubscribeToken, notificationsRouter } =
      await loadRouterModules()
    const token = await createEmailUnsubscribeToken({
      accountId: 'acct-secret',
      category: 'GROUP_INVITE_RECEIVED',
    })

    const result = await notificationsRouter
      .createCaller({ auth: null })
      .unsubscribe.preview({ token })

    expect(result).toEqual({ category: 'GROUP_INVITE_RECEIVED' })
    expect(result).not.toHaveProperty('accountId')
    vi.unstubAllEnvs()
  }, 15_000)

  it('rejects an invalid token', async () => {
    const { notificationsRouter } = await loadRouterModules()

    await expect(
      notificationsRouter
        .createCaller({ auth: null })
        .unsubscribe.preview({ token: 'invalid' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    vi.unstubAllEnvs()
  }, 15_000)
})
