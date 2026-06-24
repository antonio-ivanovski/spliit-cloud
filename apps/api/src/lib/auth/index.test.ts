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
    options: { emailVerification?: { autoSignInAfterVerification?: boolean } }
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
