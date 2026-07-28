import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import type { createEmailUnsubscribeToken as createEmailUnsubscribeTokenType } from '../../../lib/notifications/unsubscribe'
import '../../../test/mocks'
import type { notificationsRouter as notificationsRouterType } from './index'

let createEmailUnsubscribeToken!: typeof createEmailUnsubscribeTokenType
let notificationsRouter!: typeof notificationsRouterType

beforeAll(async () => {
  vi.stubEnv('EMAIL_UNSUBSCRIBE_SECRET', 'f'.repeat(32))
  vi.resetModules()
  const unsubscribe = await import('../../../lib/notifications/unsubscribe')
  createEmailUnsubscribeToken = unsubscribe.createEmailUnsubscribeToken
  const router = await import('./index')
  notificationsRouter = router.notificationsRouter
})

afterAll(() => {
  vi.unstubAllEnvs()
})

describe('notifications.unsubscribe.preview', () => {
  it('returns only the category for a valid token without requiring auth', async () => {
    const token = await createEmailUnsubscribeToken({
      accountId: 'acct-secret',
      category: 'GROUP_INVITE_RECEIVED',
    })

    const result = await notificationsRouter
      .createCaller({ auth: null })
      .unsubscribe.preview({ token })

    expect(result).toEqual({ category: 'GROUP_INVITE_RECEIVED' })
    expect(result).not.toHaveProperty('accountId')
  })

  it('rejects an invalid token', async () => {
    await expect(
      notificationsRouter
        .createCaller({ auth: null })
        .unsubscribe.preview({ token: 'invalid' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })
})
