import { beforeEach, describe, expect, it, vi } from 'vitest'

import '../../test/mocks'
import { prismaMock, sendEmailMock } from '../../test/state'
import {
  EMAIL_CHANGE_OTP_MAX_ATTEMPTS,
  emailChange,
  emailChangeVerificationIdentifier,
  generateEmailChangeOtp,
  hashEmailChangeOtp,
} from './email-change'

const autoAcceptMock = vi.hoisted(() => vi.fn())

vi.mock('../api/friends', () => ({
  autoAcceptPendingFriendInvitationsForAccount: autoAcceptMock,
}))

const plugin = emailChange()

function sessionRequest(input: {
  body: Record<string, unknown>
  user?: Record<string, unknown>
  headers?: Headers
}) {
  return {
    body: input.body,
    context: {
      session: {
        session: { id: 'session-1' },
        user: {
          id: 'account-1',
          email: 'user@example.com',
          isAnonymous: false,
          ...input.user,
        },
      },
    },
    request: new Request('https://api.example/auth/email/request-change', {
      headers: input.headers,
    }),
    setHeader() {},
  } as never
}

function accountRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'account-1',
    email: 'user@example.com',
    emailVerified: true,
    isAnonymous: false,
    name: 'User',
    image: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  }
}

describe('email change plugin', () => {
  beforeEach(() => {
    autoAcceptMock.mockResolvedValue(undefined)
    prismaMock.account.findUnique.mockResolvedValue(accountRow() as never)
    prismaMock.account.findFirst.mockResolvedValue(null)
  })

  it('generates a 6-digit OTP', () => {
    expect(generateEmailChangeOtp()).toMatch(/^\d{6}$/)
  })

  it('rejects a placeholder target address', async () => {
    await expect(
      plugin.endpoints.requestEmailChange(
        sessionRequest({
          body: { email: 'abc@github.placeholder.local' },
        }),
      ),
    ).rejects.toMatchObject({ body: { code: 'PLACEHOLDER_EMAIL' } })
    expect(sendEmailMock).not.toHaveBeenCalled()
  })

  it('rejects changing to the current real email', async () => {
    await expect(
      plugin.endpoints.requestEmailChange(
        sessionRequest({ body: { email: 'User@example.com' } }),
      ),
    ).rejects.toMatchObject({ body: { code: 'SAME_EMAIL' } })
  })

  it('requires graduation acknowledgment for anonymous accounts', async () => {
    prismaMock.account.findUnique.mockResolvedValue(
      accountRow({
        email: 'guest-1@anonymous.placeholder.local',
        emailVerified: false,
        isAnonymous: true,
      }) as never,
    )

    await expect(
      plugin.endpoints.requestEmailChange(
        sessionRequest({
          body: { email: 'new@example.com' },
          user: { isAnonymous: true },
        }),
      ),
    ).rejects.toMatchObject({ body: { code: 'GRADUATION_ACK_REQUIRED' } })
  })

  it('sends an OTP after an anonymous account acknowledges graduation', async () => {
    prismaMock.account.findUnique.mockResolvedValue(
      accountRow({
        email: 'guest-1@anonymous.placeholder.local',
        emailVerified: false,
        isAnonymous: true,
      }) as never,
    )

    await expect(
      plugin.endpoints.requestEmailChange(
        sessionRequest({
          body: { email: 'new@example.com', acknowledgedGraduation: true },
          user: { isAnonymous: true },
        }),
      ),
    ).resolves.toEqual({ sent: true })
    expect(sendEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'new@example.com' }),
    )
  })

  it('lets GitHub placeholder accounts add an email without graduation', async () => {
    prismaMock.account.findUnique.mockResolvedValue(
      accountRow({
        email: '789@github.placeholder.local',
        emailVerified: false,
        isAnonymous: false,
      }) as never,
    )

    await expect(
      plugin.endpoints.requestEmailChange(
        sessionRequest({ body: { email: 'new@example.com' } }),
      ),
    ).resolves.toEqual({ sent: true })

    expect(prismaMock.$transaction).toHaveBeenCalled()
    expect(prismaMock.verification.deleteMany).toHaveBeenCalled()
    expect(prismaMock.verification.create).toHaveBeenCalled()
    expect(sendEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'new@example.com',
        subject: 'Your Spliit Cloud email confirmation code',
      }),
    )
  })

  it('does not persist a verification when sending the OTP email fails', async () => {
    sendEmailMock.mockRejectedValueOnce(new Error('SMTP down'))

    await expect(
      plugin.endpoints.requestEmailChange(
        sessionRequest({ body: { email: 'new@example.com' } }),
      ),
    ).rejects.toMatchObject({ body: { code: 'EMAIL_SEND_FAILED' } })
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
    expect(prismaMock.verification.deleteMany).not.toHaveBeenCalled()
    expect(prismaMock.verification.create).not.toHaveBeenCalled()
  })

  it('rejects an email already used by another account before sending', async () => {
    prismaMock.account.findFirst.mockResolvedValue({ id: 'other' } as never)

    await expect(
      plugin.endpoints.requestEmailChange(
        sessionRequest({ body: { email: 'taken@example.com' } }),
      ),
    ).rejects.toMatchObject({ body: { code: 'EMAIL_IN_USE' } })
    expect(sendEmailMock).not.toHaveBeenCalled()
  })

  it('graduates an anonymous account and deletes URL recovery on confirm', async () => {
    const email = 'new@example.com'
    const otp = '123456'
    prismaMock.account.findUnique.mockResolvedValue(
      accountRow({
        email: 'guest-1@anonymous.placeholder.local',
        emailVerified: false,
        isAnonymous: true,
      }) as never,
    )
    prismaMock.verification.findFirst.mockResolvedValue({
      id: 'ver-1',
      identifier: emailChangeVerificationIdentifier('account-1'),
      expiresAt: new Date(Date.now() + 60_000),
      value: JSON.stringify({
        email,
        otpHash: hashEmailChangeOtp({
          accountId: 'account-1',
          email,
          otp,
        }),
        attempts: 0,
      }),
    } as never)
    prismaMock.account.update.mockResolvedValue(
      accountRow({ email, emailVerified: true, isAnonymous: false }) as never,
    )

    await expect(
      plugin.endpoints.confirmEmailChange(
        sessionRequest({
          body: { email, otp },
          user: { isAnonymous: true },
        }),
      ),
    ).resolves.toEqual({
      success: true,
      email,
      isAnonymous: false,
    })

    expect(prismaMock.account.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          email,
          emailVerified: true,
          isAnonymous: false,
        }),
      }),
    )
    expect(
      prismaMock.anonymousRecoveryCredential.deleteMany,
    ).toHaveBeenCalledWith({ where: { accountId: 'account-1' } })
    expect(prismaMock.authIdentity.updateMany).not.toHaveBeenCalled()
    expect(sendEmailMock).not.toHaveBeenCalled()
    expect(autoAcceptMock).toHaveBeenCalledWith({
      accountId: 'account-1',
      accountEmail: email,
    })
  })

  it('adds email to a GitHub placeholder account without touching anonymous recovery', async () => {
    const email = 'new@example.com'
    const otp = '654321'
    prismaMock.account.findUnique.mockResolvedValue(
      accountRow({
        email: '789@github.placeholder.local',
        emailVerified: false,
        isAnonymous: false,
      }) as never,
    )
    prismaMock.verification.findFirst.mockResolvedValue({
      id: 'ver-1',
      identifier: emailChangeVerificationIdentifier('account-1'),
      expiresAt: new Date(Date.now() + 60_000),
      value: JSON.stringify({
        email,
        otpHash: hashEmailChangeOtp({
          accountId: 'account-1',
          email,
          otp,
        }),
        attempts: 0,
      }),
    } as never)
    prismaMock.account.update.mockResolvedValue(
      accountRow({ email, emailVerified: true, isAnonymous: false }) as never,
    )

    await plugin.endpoints.confirmEmailChange(
      sessionRequest({ body: { email, otp } }),
    )

    expect(prismaMock.account.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { email, emailVerified: true },
      }),
    )
    expect(
      prismaMock.anonymousRecoveryCredential.deleteMany,
    ).not.toHaveBeenCalled()
    expect(sendEmailMock).not.toHaveBeenCalled()
  })

  it('notifies the previous inbox and rewrites credential identities on change', async () => {
    const email = 'new@example.com'
    const otp = '111222'
    prismaMock.verification.findFirst.mockResolvedValue({
      id: 'ver-1',
      identifier: emailChangeVerificationIdentifier('account-1'),
      expiresAt: new Date(Date.now() + 60_000),
      value: JSON.stringify({
        email,
        otpHash: hashEmailChangeOtp({
          accountId: 'account-1',
          email,
          otp,
        }),
        attempts: 0,
      }),
    } as never)
    prismaMock.account.update.mockResolvedValue(
      accountRow({ email, emailVerified: true }) as never,
    )

    await plugin.endpoints.confirmEmailChange(
      sessionRequest({ body: { email, otp } }),
    )

    expect(prismaMock.authIdentity.updateMany).toHaveBeenCalledWith({
      where: {
        userId: 'account-1',
        providerId: { in: ['credential', 'magic-link'] },
        accountId: 'user@example.com',
      },
      data: { accountId: email },
    })
    expect(sendEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'user@example.com',
        subject: 'Your Spliit Cloud email address was changed',
      }),
    )
    expect(prismaMock.session.deleteMany).not.toHaveBeenCalled()
  })

  it('rejects an expired or wrong OTP', async () => {
    prismaMock.verification.findFirst.mockResolvedValueOnce({
      id: 'ver-1',
      identifier: emailChangeVerificationIdentifier('account-1'),
      expiresAt: new Date(Date.now() - 1000),
      value: JSON.stringify({
        email: 'new@example.com',
        otpHash: 'dead',
        attempts: 0,
      }),
    } as never)

    await expect(
      plugin.endpoints.confirmEmailChange(
        sessionRequest({ body: { email: 'new@example.com', otp: '123456' } }),
      ),
    ).rejects.toMatchObject({ body: { code: 'OTP_EXPIRED' } })

    prismaMock.verification.findFirst.mockResolvedValueOnce({
      id: 'ver-1',
      identifier: emailChangeVerificationIdentifier('account-1'),
      expiresAt: new Date(Date.now() + 60_000),
      value: JSON.stringify({
        email: 'new@example.com',
        otpHash: hashEmailChangeOtp({
          accountId: 'account-1',
          email: 'new@example.com',
          otp: '000000',
        }),
        attempts: EMAIL_CHANGE_OTP_MAX_ATTEMPTS - 1,
      }),
    } as never)

    await expect(
      plugin.endpoints.confirmEmailChange(
        sessionRequest({ body: { email: 'new@example.com', otp: '123456' } }),
      ),
    ).rejects.toMatchObject({ body: { code: 'INVALID_OTP' } })
    expect(prismaMock.verification.deleteMany).toHaveBeenCalled()
  })
})
