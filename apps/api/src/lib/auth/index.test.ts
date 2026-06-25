// organize-imports-ignore: ./mocks must be imported before any module that
// loads better-auth or @spliit/db so vi.mock is registered before those
// modules are evaluated.
import { describe, expect, it, vi } from 'vitest'
import '../../test/mocks'
import { prismaMock, sendEmailMock } from '../../test/state'

// `vi.importActual` returns the real (un-mocked) module so we can inspect the
// better-auth options we configured in `lib/auth/index.ts`. The existing
// `vi.mock('../lib/auth/index', ...)` in `./mocks` would otherwise hide the
// `options` property.
const realAuthModule = (await vi.importActual('./index')) as {
  auth: {
    options: {
      emailVerification?: { autoSignInAfterVerification?: boolean }
      hooks?: { before?: unknown }
      emailAndPassword?: {
        sendResetPassword?: (params: {
          user: { id: string; email: string }
          url: string
        }) => Promise<void>
        revokeSessionsOnPasswordReset?: boolean
        resetPasswordTokenExpiresIn?: number
      }
    }
  }
}

describe('better-auth emailVerification config', () => {
  it('enables autoSignInAfterVerification', () => {
    // Without this flag, /api/auth/verify-email validates the token and 302s
    // to the callback URL without creating a session, which sends first-time
    // password sign-ups back to the sign-in page instead of profile completion.
    expect(
      realAuthModule.auth.options.emailVerification
        ?.autoSignInAfterVerification,
    ).toBe(true)
  })
})

describe('better-auth emailAndPassword config', () => {
  it('configures sendResetPassword so /api/auth/request-password-reset works', () => {
    // better-auth short-circuits the request-password-reset endpoint with a
    // "RESET_PASSWORD_DISABLED" error when no sendResetPassword callback is
    // configured. The web's forgot-password page would silently do nothing.
    expect(
      typeof realAuthModule.auth.options.emailAndPassword?.sendResetPassword,
    ).toBe('function')
  })

  it('revokes existing sessions on password reset', () => {
    // Sessions revoked on reset means a stolen cookie loses access as soon as
    // the rightful owner resets their password.
    expect(
      realAuthModule.auth.options.emailAndPassword
        ?.revokeSessionsOnPasswordReset,
    ).toBe(true)
  })

  it('configures a before hook for the app password policy', () => {
    expect(typeof realAuthModule.auth.options.hooks?.before).toBe('function')
  })

  it('mentions other linked sign-in methods in password reset emails', async () => {
    prismaMock.authIdentity.findMany.mockResolvedValueOnce([
      { providerId: 'credential' },
      { providerId: 'google' },
      { providerId: 'magic-link' },
    ])

    await realAuthModule.auth.options.emailAndPassword?.sendResetPassword?.({
      user: { id: 'acct-1', email: 'alice@example.com' },
      url: 'https://spliit.test/reset-token',
    })

    expect(sendEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'alice@example.com',
        subject: 'Reset your Spliit password',
        text: expect.stringContaining(
          'This account can also sign in with: Google, email sign-in link.',
        ),
      }),
    )
  })

  it('sends sign-in method guidance instead of reset copy for social-only accounts', async () => {
    prismaMock.authIdentity.findMany.mockResolvedValueOnce([
      { providerId: 'google' },
      { providerId: 'magic-link' },
    ])

    await realAuthModule.auth.options.emailAndPassword?.sendResetPassword?.({
      user: { id: 'acct-1', email: 'alice@example.com' },
      url: 'https://spliit.test/reset-token',
    })

    expect(sendEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'alice@example.com',
        subject: 'Sign in to Spliit',
        text: expect.stringContaining(
          'Use one of these sign-in methods instead: Google, email sign-in link.',
        ),
      }),
    )
  })
})
