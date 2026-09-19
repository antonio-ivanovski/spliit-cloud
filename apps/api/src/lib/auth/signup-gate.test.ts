import type * as BetterAuthApi from 'better-auth/api'
import { afterEach, describe, expect, it, vi } from 'vitest'

const { addOAuthServerContextMock, getOAuthStateMock } = vi.hoisted(() => ({
  addOAuthServerContextMock: vi.fn(),
  getOAuthStateMock: vi.fn(),
}))

vi.mock('better-auth/api', async (importOriginal) => ({
  ...(await importOriginal<typeof BetterAuthApi>()),
  addOAuthServerContext: addOAuthServerContextMock,
  getOAuthState: getOAuthStateMock,
}))

import '../../test/mocks'
import { prismaMock } from '../../test/state'
import { env } from '../env'
import {
  SIGNUP_INVITE_HEADER,
  SIGNUP_INVITE_REQUIRED,
  assertCanCreateAccount,
  canCreateAccount,
  captureOAuthSignupInvite,
  enforceSignupGate,
  readLinkInviteToken,
} from './signup-gate'

const originalSignupMode = env.SIGNUP_MODE

afterEach(() => {
  env.SIGNUP_MODE = originalSignupMode
  addOAuthServerContextMock.mockReset()
  getOAuthStateMock.mockReset()
})

describe('canCreateAccount', () => {
  it('allows anyone when SIGNUP_MODE is open', async () => {
    env.SIGNUP_MODE = 'open'
    await expect(
      canCreateAccount({ email: 'stranger@example.com' }),
    ).resolves.toBe(true)
    expect(prismaMock.user.count).not.toHaveBeenCalled()
  })

  it('allows the first account on an invite-only instance', async () => {
    env.SIGNUP_MODE = 'invite_only'
    prismaMock.user.count.mockResolvedValue(0)
    await expect(
      canCreateAccount({ email: 'owner@example.com' }),
    ).resolves.toBe(true)
  })

  it('allows an email with a pending EMAIL invitation', async () => {
    env.SIGNUP_MODE = 'invite_only'
    prismaMock.user.count.mockResolvedValue(3)
    prismaMock.groupInvitation.findFirst.mockResolvedValue({
      id: 'inv-1',
    } as never)
    await expect(
      canCreateAccount({ email: 'invited@example.com' }),
    ).resolves.toBe(true)
  })

  it('rejects an unknown email without a live link token', async () => {
    env.SIGNUP_MODE = 'invite_only'
    prismaMock.user.count.mockResolvedValue(3)
    prismaMock.groupInvitation.findFirst.mockResolvedValue(null)
    await expect(
      canCreateAccount({ email: 'stranger@example.com' }),
    ).resolves.toBe(false)
  })

  it('allows any email when a usable link invite token is present', async () => {
    env.SIGNUP_MODE = 'invite_only'
    prismaMock.user.count.mockResolvedValue(3)
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
    prismaMock.user.count.mockResolvedValue(3)
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
    prismaMock.user.count.mockResolvedValue(2)
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
    prismaMock.user.findFirst.mockResolvedValue({ id: 'acct-1' } as never)
    await expect(
      enforceSignupGate({
        path: '/sign-in/magic-link',
        body: { email: 'existing@example.com' },
      }),
    ).resolves.toBeUndefined()
  })

  it('rejects magic-link for an unknown email without invite proof', async () => {
    env.SIGNUP_MODE = 'invite_only'
    prismaMock.user.count.mockResolvedValue(2)
    prismaMock.user.findFirst.mockResolvedValue(null)
    prismaMock.groupInvitation.findFirst.mockResolvedValue(null)
    await expect(
      enforceSignupGate({
        path: '/sign-in/magic-link',
        body: { email: 'new@example.com' },
      }),
    ).rejects.toMatchObject({ body: { code: SIGNUP_INVITE_REQUIRED } })
  })
})

describe('readLinkInviteToken', () => {
  it('reads a direct request header', async () => {
    await expect(
      readLinkInviteToken({
        headers: { get: () => 'header-token-value' },
      }),
    ).resolves.toBe('header-token-value')
  })

  it('recovers a link token from a nested magic-link callback', async () => {
    const destination = '/groups/grp-1?invite=magic-link-token-123456'
    const completeProfile = `http://localhost:3000/auth/complete-profile?redirect=${encodeURIComponent(destination)}`

    await expect(
      readLinkInviteToken({
        path: '/magic-link/verify',
        query: { newUserCallbackURL: completeProfile },
      }),
    ).resolves.toBe('magic-link-token-123456')
  })

  it('rejects invite tokens from external callback destinations', async () => {
    await expect(
      readLinkInviteToken({
        path: '/magic-link/verify',
        query: {
          newUserCallbackURL:
            'https://attacker.example/groups/grp-1?invite=stolen-token',
        },
      }),
    ).resolves.toBeUndefined()
  })

  it('reads server-controlled invite proof on an OAuth callback', async () => {
    getOAuthStateMock.mockResolvedValue({
      serverContext: { signupInviteToken: 'oauth-token-123456' },
    })

    await expect(
      readLinkInviteToken({ path: '/callback/google' }),
    ).resolves.toBe('oauth-token-123456')
  })
})

describe('captureOAuthSignupInvite', () => {
  it('adds a currently usable link token to server-controlled OAuth state', async () => {
    const token = 'o'.repeat(32)
    prismaMock.groupInvitation.findFirst.mockResolvedValue({
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 60_000),
      temporaryName: null,
      role: 'MEMBER',
      group: { id: 'grp-1', name: 'Trip', groupType: 'GROUP' },
      invitedBy: { name: 'Alice' },
    } as never)

    await captureOAuthSignupInvite({
      path: '/sign-in/social',
      headers: {
        get: (name) => (name === SIGNUP_INVITE_HEADER ? token : null),
      },
    })

    expect(addOAuthServerContextMock).toHaveBeenCalledWith({
      signupInviteToken: token,
    })
  })

  it('does not carry invalid invite proof into OAuth state', async () => {
    prismaMock.groupInvitation.findFirst.mockResolvedValue(null)

    await captureOAuthSignupInvite({
      path: '/sign-in/social',
      headers: { get: () => 'x'.repeat(32) },
    })

    expect(addOAuthServerContextMock).not.toHaveBeenCalled()
  })
})

describe('assertCanCreateAccount', () => {
  it('throws when invite-only and no proof is present', async () => {
    env.SIGNUP_MODE = 'invite_only'
    prismaMock.user.count.mockResolvedValue(1)
    prismaMock.groupInvitation.findFirst.mockResolvedValue(null)
    await expect(
      assertCanCreateAccount({ email: 'nobody@example.com', context: null }),
    ).rejects.toMatchObject({ body: { code: SIGNUP_INVITE_REQUIRED } })
  })

  it('requires a usable link for anonymous signup even on an empty instance', async () => {
    env.SIGNUP_MODE = 'invite_only'
    prismaMock.user.count.mockResolvedValue(0)
    prismaMock.groupInvitation.findFirst.mockResolvedValue(null)

    await expect(
      assertCanCreateAccount({ context: null, anonymous: true }),
    ).rejects.toMatchObject({ body: { code: SIGNUP_INVITE_REQUIRED } })
    expect(prismaMock.user.count).not.toHaveBeenCalled()
  })
})
