import { describe, expect, it } from 'vitest'

import { createEmailUnsubscribeToken } from '../../../lib/notifications/unsubscribe'
import '../../../test/mocks'
import { notificationsRouter } from './index'

// The EMAIL_UNSUBSCRIBE_SECRET comes from the package-level .env.test file
// (loaded before Vitest starts), so the router and token helpers can be
// imported statically — no module-registry reloads required.

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
