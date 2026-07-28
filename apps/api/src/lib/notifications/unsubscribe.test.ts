import { describe, expect, it, vi } from 'vitest'

import { NotificationCategory } from '@spliit/domain/notifications'

describe('signed email unsubscribe tokens', () => {
  it('round-trips claims and rejects tampering', async () => {
    vi.stubEnv('EMAIL_UNSUBSCRIBE_SECRET', 'a'.repeat(32))
    vi.resetModules()
    const { createEmailUnsubscribeToken, verifyEmailUnsubscribeToken } =
      await import('./unsubscribe')
    const token = await createEmailUnsubscribeToken({
      accountId: 'acct-1',
      category: NotificationCategory.EXPENSE_CHANGED,
    })
    expect(token.split('.')).toHaveLength(3)
    expect(await verifyEmailUnsubscribeToken(token)).toMatchObject({
      aud: 'spliit:email-unsubscribe',
      accountId: 'acct-1',
      category: NotificationCategory.EXPENSE_CHANGED,
      exp: expect.any(Number),
    })
    expect(await verifyEmailUnsubscribeToken(`${token}x`)).toBeNull()
    await expect(
      createEmailUnsubscribeToken({
        accountId: 'acct-1',
        category: 'GLOBAL' as never,
      }),
    ).rejects.toThrow()
    vi.unstubAllEnvs()
  })

  it('rejects an expired token and a token with a changed account claim', async () => {
    vi.stubEnv('EMAIL_UNSUBSCRIBE_SECRET', 'c'.repeat(32))
    vi.resetModules()
    const { createEmailUnsubscribeToken, verifyEmailUnsubscribeToken } =
      await import('./unsubscribe')
    const now = Math.floor(Date.now() / 1000)
    const token = await createEmailUnsubscribeToken({
      accountId: 'acct-1',
      category: NotificationCategory.EXPENSE_CHANGED,
      now,
    })
    const [header, , signature] = token.split('.')
    const changedPayload = Buffer.from(
      JSON.stringify({
        aud: 'spliit:email-unsubscribe',
        accountId: 'acct-2',
        category: NotificationCategory.EXPENSE_CHANGED,
        iat: now,
        exp: now + 90 * 24 * 60 * 60,
      }),
    ).toString('base64url')
    expect(
      await verifyEmailUnsubscribeToken(
        `${header}.${changedPayload}.${signature}`,
      ),
    ).toBeNull()

    const expiredToken = await createEmailUnsubscribeToken({
      accountId: 'acct-1',
      category: NotificationCategory.EXPENSE_CHANGED,
      now: now - 90 * 24 * 60 * 60 - 1,
    })
    expect(await verifyEmailUnsubscribeToken(expiredToken)).toBeNull()
    vi.unstubAllEnvs()
  })

  it('builds RFC 8058 metadata with a visible footer', async () => {
    vi.stubEnv('EMAIL_UNSUBSCRIBE_SECRET', 'b'.repeat(32))
    vi.resetModules()
    const { buildEmailUnsubscribeMetadata } = await import('./unsubscribe')
    const metadata = await buildEmailUnsubscribeMetadata({
      accountId: 'acct-1',
      category: NotificationCategory.GROUP_INVITE_RECEIVED,
    })
    expect(metadata?.headers['List-Unsubscribe-Post']).toBe(
      'List-Unsubscribe=One-Click',
    )
    expect(metadata?.textFooter).toContain('unsubscribe')
    vi.unstubAllEnvs()
  })

  it('builds the web preview URL with the token in the fragment', async () => {
    vi.stubEnv('EMAIL_UNSUBSCRIBE_SECRET', 'd'.repeat(32))
    vi.resetModules()
    const {
      createEmailUnsubscribeToken,
      getEmailUnsubscribePreviewUrl,
      previewEmailUnsubscribeToken,
    } = await import('./unsubscribe')
    const token = await createEmailUnsubscribeToken({
      accountId: 'acct-1',
      category: NotificationCategory.EXPENSE_CREATED,
    })

    expect(getEmailUnsubscribePreviewUrl(token)).toBe(
      `http://localhost:3000/unsubscribe#token=${encodeURIComponent(token)}`,
    )
    await expect(previewEmailUnsubscribeToken(token)).resolves.toEqual({
      category: NotificationCategory.EXPENSE_CREATED,
    })
    await expect(previewEmailUnsubscribeToken(`${token}x`)).resolves.toBeNull()
    vi.unstubAllEnvs()
  })
})
