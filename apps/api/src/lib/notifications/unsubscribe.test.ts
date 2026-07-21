import { NotificationCategory } from '@spliit/domain/notifications'
import { describe, expect, it, vi } from 'vitest'

describe('signed email unsubscribe tokens', () => {
  it('round-trips claims and rejects tampering', async () => {
    const secret = Buffer.alloc(32, 7).toString('base64url')
    vi.stubEnv('NOTIFICATION_UNSUBSCRIBE_KEYS', `current:${secret}`)
    vi.resetModules()
    const { createEmailUnsubscribeToken, verifyEmailUnsubscribeToken } =
      await import('./unsubscribe')
    const token = createEmailUnsubscribeToken({
      accountId: 'acct-1',
      category: NotificationCategory.EXPENSE_CHANGED,
      now: 123,
    })
    expect(verifyEmailUnsubscribeToken(token)).toMatchObject({
      aud: 'spliit:email-unsubscribe',
      accountId: 'acct-1',
      category: NotificationCategory.EXPENSE_CHANGED,
      iat: 123,
    })
    expect(verifyEmailUnsubscribeToken(`${token}x`)).toBeNull()
    expect(() =>
      createEmailUnsubscribeToken({
        accountId: 'acct-1',
        category: 'GLOBAL' as never,
      }),
    ).toThrow()
    vi.unstubAllEnvs()
  })

  it('builds RFC 8058 metadata with a visible footer', async () => {
    const secret = Buffer.alloc(32, 9).toString('base64url')
    vi.stubEnv('NOTIFICATION_UNSUBSCRIBE_KEYS', `current:${secret}`)
    vi.resetModules()
    const { buildEmailUnsubscribeMetadata } = await import('./unsubscribe')
    const metadata = buildEmailUnsubscribeMetadata({
      accountId: 'acct-1',
      category: NotificationCategory.GROUP_INVITE_RECEIVED,
    })
    expect(metadata?.headers['List-Unsubscribe-Post']).toBe(
      'List-Unsubscribe=One-Click',
    )
    expect(metadata?.textFooter).toContain('unsubscribe')
    vi.unstubAllEnvs()
  })
})
