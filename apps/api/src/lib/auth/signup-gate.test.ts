import { afterEach, describe, expect, it, vi } from 'vitest'

import '../../test/mocks'
import { prismaMock } from '../../test/state'
import { env } from '../env'
import {
  SIGNUP_INVITE_COOKIE,
  SIGNUP_INVITE_HEADER,
  SIGNUP_INVITE_REQUIRED,
  assertCanCreateAccount,
  canCreateAccount,
  enforceSignupGate,
  persistSignupInviteCookie,
  readLinkInviteToken,
} from './signup-gate'

const originalSignupMode = env.SIGNUP_MODE

afterEach(() => {
  env.SIGNUP_MODE = originalSignupMode
})

describe('canCreateAccount', () => {
  it('allows anyone when SIGNUP_MODE is open', async () => {
    env.SIGNUP_MODE = 'open'
    await expect(
      canCreateAccount({ email: 'stranger@example.com' }),
    ).resolves.toBe(true)
    expect(prismaMock.account.count).not.toHaveBeenCalled()
  })

  it('allows the first account on an invite-only instance', async () => {
    env.SIGNUP_MODE = 'invite_only'
    prismaMock.account.count.mockResolvedValue(0)
    await expect(
      canCreateAccount({ email: 'owner@example.com' }),
    ).resolves.toBe(true)
  })

  it('allows an email with a pending EMAIL invitation', async () => {
    env.SIGNUP_MODE = 'invite_only'
    prismaMock.account.count.mockResolvedValue(3)
    prismaMock.groupInvitation.findFirst.mockResolvedValue({
      id: 'inv-1',
    } as never)
    await expect(
      canCreateAccount({ email: 'invited@example.com' }),
    ).resolves.toBe(true)
  })

  it('rejects an unknown email without a live link token', async () => {
    env.SIGNUP_MODE = 'invite_only'
    prismaMock.account.count.mockResolvedValue(3)
    prismaMock.groupInvitation.findFirst.mockResolvedValue(null)
    await expect(
      canCreateAccount({ email: 'stranger@example.com' }),
    ).resolves.toBe(false)
  })

  it('allows any email when a usable link invite token is present', async () => {
    env.SIGNUP_MODE = 'invite_only'
    prismaMock.account.count.mockResolvedValue(3)
    const token = 'a'.repeat(32)
    prismaMock.groupInvitation.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        status: 'PENDING',
        expiresAt: new Date(Date.now() + 60_000),
        temporaryName: null,
        role: 'MEMBER',
        group: { id: 'grp-1', name: 'Trip', groupType: 'GROUP' },
        invitedBy: { name: 'Alice' },
      } as never)

    await expect(
      canCreateAccount({
        email: 'anyone@example.com',
        linkInviteToken: token,
      }),
    ).resolves.toBe(true)
  })

  it('rejects an expired link invite token', async () => {
    env.SIGNUP_MODE = 'invite_only'
    prismaMock.account.count.mockResolvedValue(3)
    prismaMock.groupInvitation.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        status: 'PENDING',
        expiresAt: new Date(Date.now() - 60_000),
        temporaryName: null,
        role: 'MEMBER',
        group: { id: 'grp-1', name: 'Trip', groupType: 'GROUP' },
        invitedBy: { name: 'Alice' },
      } as never)

    await expect(
      canCreateAccount({
        email: 'anyone@example.com',
        linkInviteToken: 'd'.repeat(32),
      }),
    ).resolves.toBe(false)
  })
})

describe('enforceSignupGate', () => {
  it('does nothing in open mode', async () => {
    env.SIGNUP_MODE = 'open'
    await expect(
      enforceSignupGate({
        path: '/sign-up/email',
        body: { email: 'a@example.com' },
      }),
    ).resolves.toBeUndefined()
  })

  it('rejects password sign-up without invite proof', async () => {
    env.SIGNUP_MODE = 'invite_only'
    prismaMock.account.count.mockResolvedValue(2)
    prismaMock.groupInvitation.findFirst.mockResolvedValue(null)
    await expect(
      enforceSignupGate({
        path: '/sign-up/email',
        body: { email: 'a@example.com' },
      }),
    ).rejects.toMatchObject({
      status: 'FORBIDDEN',
      body: { code: SIGNUP_INVITE_REQUIRED },
    })
  })

  it('allows magic-link for an existing account', async () => {
    env.SIGNUP_MODE = 'invite_only'
    prismaMock.account.findFirst.mockResolvedValue({ id: 'acct-1' } as never)
    await expect(
      enforceSignupGate({
        path: '/sign-in/magic-link',
        body: { email: 'existing@example.com' },
      }),
    ).resolves.toBeUndefined()
  })

  it('rejects magic-link for an unknown email without invite proof', async () => {
    env.SIGNUP_MODE = 'invite_only'
    prismaMock.account.count.mockResolvedValue(2)
    prismaMock.account.findFirst.mockResolvedValue(null)
    prismaMock.groupInvitation.findFirst.mockResolvedValue(null)
    await expect(
      enforceSignupGate({
        path: '/sign-in/magic-link',
        body: { email: 'new@example.com' },
      }),
    ).rejects.toMatchObject({ body: { code: SIGNUP_INVITE_REQUIRED } })
  })
})

describe('persistSignupInviteCookie', () => {
  it('stores a usable link token from the header on social sign-in', async () => {
    const token = 'b'.repeat(32)
    prismaMock.groupInvitation.findFirst.mockResolvedValue({
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 60_000),
      temporaryName: null,
      role: 'MEMBER',
      group: { id: 'grp-1', name: 'Trip', groupType: 'GROUP' },
      invitedBy: { name: 'Alice' },
    } as never)
    const setCookie = vi.fn()
    await persistSignupInviteCookie({
      path: '/sign-in/social',
      headers: {
        get: (name) => (name === SIGNUP_INVITE_HEADER ? token : null),
      },
      setCookie,
    })
    expect(setCookie).toHaveBeenCalledWith(
      SIGNUP_INVITE_COOKIE,
      token,
      expect.objectContaining({ httpOnly: true, sameSite: 'lax', path: '/' }),
    )
  })

  it('does not store an unusable token', async () => {
    prismaMock.groupInvitation.findFirst.mockResolvedValue(null)
    const setCookie = vi.fn()
    await persistSignupInviteCookie({
      path: '/sign-in/social',
      headers: {
        get: (name) => (name === SIGNUP_INVITE_HEADER ? 'c'.repeat(32) : null),
      },
      setCookie,
    })
    expect(setCookie).not.toHaveBeenCalled()
  })
})

describe('readLinkInviteToken', () => {
  it('prefers the request header over the cookie', () => {
    expect(
      readLinkInviteToken({
        headers: { get: () => 'header-token-value' },
        getCookie: () => 'cookie-token-value',
      }),
    ).toBe('header-token-value')
  })
})

describe('assertCanCreateAccount', () => {
  it('throws when invite-only and no proof is present', async () => {
    env.SIGNUP_MODE = 'invite_only'
    prismaMock.account.count.mockResolvedValue(1)
    prismaMock.groupInvitation.findFirst.mockResolvedValue(null)
    await expect(
      assertCanCreateAccount({ email: 'nobody@example.com', context: null }),
    ).rejects.toMatchObject({ body: { code: SIGNUP_INVITE_REQUIRED } })
  })
})
