// organize-imports-ignore: ./mocks must be imported before any module that
// loads better-auth or @spliit/db so vi.mock is registered before those
// modules are evaluated.
import { afterEach, describe, expect, it, vi } from 'vitest'
import '../../test/mocks'
import { prismaMock, sendEmailMock } from '../../test/state'

// `vi.importActual` returns the real (un-mocked) module so we can inspect the
// better-auth options we configured in `lib/auth/index.ts`. The existing
// `vi.mock('../lib/auth/index', ...)` in `./mocks` would otherwise hide the
// `options` property.
const realAuthModule = (await vi.importActual('./index')) as {
  getVerifiedGitHubUserInfo: (token: { accessToken?: string }) => Promise<{
    user: {
      id: string
      name: string
      email: string
      image?: string
      emailVerified: boolean
    }
  } | null>
  auth: {
    options: {
      emailVerification?: { autoSignInAfterVerification?: boolean }
      hooks?: { before?: unknown }
      account?: {
        accountLinking?: {
          enabled?: boolean
          trustedProviders?: string[]
        }
      }
      socialProviders?: Record<
        string,
        {
          clientId: string
          clientSecret: string
          getUserInfo?: (token: { accessToken?: string }) => Promise<{
            user: {
              id: string
              name: string
              email: string
              image?: string
              emailVerified: boolean
            }
          } | null>
        }
      >
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

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('better-auth emailVerification config', () => {
  it('enables autoSignInAfterVerification', () => {
    // Without this flag, /auth/verify-email validates the token and 302s
    // to the callback URL without creating a session, which sends first-time
    // password sign-ups back to the sign-in page instead of profile completion.
    expect(
      realAuthModule.auth.options.emailVerification
        ?.autoSignInAfterVerification,
    ).toBe(true)
  })
})

describe('better-auth emailAndPassword config', () => {
  it('configures sendResetPassword so /auth/request-password-reset works', () => {
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

describe('better-auth socialProviders config', () => {
  it('includes GitHub alongside Google in trustedProviders', () => {
    // Account linking joins a new GitHub sign-in to an existing account by
    // email. GitHub must be in the trusted list, otherwise better-auth treats
    // a same-email GitHub identity as a separate user and refuses to link.
    const trusted =
      realAuthModule.auth.options.account?.accountLinking?.trustedProviders ??
      []
    expect(trusted).toContain('github')
    expect(trusted).toContain('google')
    expect(trusted).toContain('credential')
    expect(trusted).toContain('magic-link')
  })

  it('exposes GitHub credentials from env when both are set', () => {
    // The auth test environment is configured with GITHUB_CLIENT_ID and
    // GITHUB_CLIENT_SECRET (see apps/api/.env / scripts/i18n tooling).
    // If those ever get dropped the web's "Continue with GitHub" button
    // would render but the OAuth handshake would 404 — fail loudly here.
    const providers = realAuthModule.auth.options.socialProviders ?? {}
    expect(providers.github).toEqual(
      expect.objectContaining({
        clientId: expect.any(String),
        clientSecret: expect.any(String),
        getUserInfo: expect.any(Function),
      }),
    )
  })

  it('uses the primary verified GitHub email when the profile email is private', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/user')) {
        return Response.json({
          id: 123,
          login: 'octo',
          name: null,
          email: null,
          avatar_url: 'https://github.test/avatar.png',
        })
      }
      return Response.json([
        {
          email: 'private-primary@example.com',
          primary: true,
          verified: true,
          visibility: 'private',
        },
        {
          email: 'secondary@example.com',
          primary: false,
          verified: true,
          visibility: 'private',
        },
      ])
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await realAuthModule.getVerifiedGitHubUserInfo({
      accessToken: 'token-1',
    })

    expect(result?.user).toMatchObject({
      id: '123',
      name: 'octo',
      email: 'private-primary@example.com',
      emailVerified: true,
    })
  })

  it('falls back to the first verified GitHub email when the primary email is unverified', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/user')) {
        return Response.json({
          id: 456,
          login: 'mona',
          name: 'Mona',
          email: 'unverified@example.com',
          avatar_url: null,
        })
      }
      return Response.json([
        {
          email: 'unverified@example.com',
          primary: true,
          verified: false,
          visibility: 'private',
        },
        {
          email: 'verified@example.com',
          primary: false,
          verified: true,
          visibility: 'private',
        },
      ])
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await realAuthModule.getVerifiedGitHubUserInfo({
      accessToken: 'token-2',
    })

    expect(result?.user).toMatchObject({
      id: '456',
      name: 'Mona',
      email: 'verified@example.com',
      emailVerified: true,
    })
  })

  it('falls back to a synthetic placeholder email when GitHub returns no verified email', async () => {
    // When the user has no verified email on GitHub (private email,
    // missing `user:email` scope, no verified address), we no longer
    // hard-fail the sign-in. Instead we synthesize a placeholder under
    // the reserved `.placeholder.local` domain so the user gets a
    // complete account and can sign in normally via GitHub. Email-only
    // features (magic-link sign-in, password reset, notifications) skip
    // these accounts because their email is a placeholder.
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/user')) {
        return Response.json({
          id: 789,
          login: 'no-verified-email',
          name: 'Octocat',
          email: null,
          avatar_url: 'https://github.test/avatar.png',
        })
      }
      return Response.json([
        {
          email: 'unverified@example.com',
          primary: true,
          verified: false,
          visibility: 'private',
        },
      ])
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await realAuthModule.getVerifiedGitHubUserInfo({
      accessToken: 'token-3',
    })

    expect(result?.user).toMatchObject({
      id: '789',
      name: 'Octocat',
      email: '789@github.placeholder.local',
      emailVerified: false,
    })
    expect(result?.data).toMatchObject({ isPlaceholderEmail: true })
  })

  it('keeps Google as a social provider alongside GitHub', () => {
    const providers = realAuthModule.auth.options.socialProviders ?? {}
    expect(providers.google).toEqual(
      expect.objectContaining({
        clientId: expect.any(String),
        clientSecret: expect.any(String),
      }),
    )
  })
})
