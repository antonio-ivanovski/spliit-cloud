// organize-imports-ignore: ./mocks must be imported before any module that
// loads better-auth or @spliit/db so vi.mock is registered before those
// modules are evaluated.
import { describe, expect, it, vi } from 'vitest'
import '../../test/mocks'

// `vi.importActual` returns the real (un-mocked) module so we can inspect the
// better-auth options we configured in `lib/auth/index.ts`. The existing
// `vi.mock('../lib/auth/index', ...)` in `./mocks` would otherwise hide the
// `options` property.
const realAuthModule = (await vi.importActual('./index')) as {
  auth: {
    options: {
      emailVerification?: { autoSignInAfterVerification?: boolean }
      emailAndPassword?: {
        sendResetPassword?: unknown
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
})
