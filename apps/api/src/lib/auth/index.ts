import { randomUUID } from 'node:crypto'

import { oauthProvider } from '@better-auth/oauth-provider'
import { betterAuth } from 'better-auth'
import { prismaAdapter } from 'better-auth/adapters/prisma'
import { APIError, createAuthMiddleware } from 'better-auth/api'
import {
  jwt,
  magicLink,
  openAPI,
  type Jwk,
  type JwtOptions,
} from 'better-auth/plugins'

import { prisma, type Account } from '@spliit/db'
import { isStrongPassword } from '@spliit/domain/password'

import { autoAcceptPendingFriendInvitationsForAccount } from '../api/friends'
import { env, webOrigins } from '../env'
import { buildProviderPlaceholderEmail } from '../invitations'
import { sendEmail } from '../mail/send'
import {
  renderMagicLinkEmail,
  renderPasswordRecoveryEmail,
  renderVerificationEmail,
} from '../mail/templates'
import { invalidateAccountCache } from './account-cache'
import {
  assertCanCreateAccount,
  enforceSignupGate,
  persistSignupInviteCookie,
} from './signup-gate'
import { getApiBaseUrl } from './urls'

const authMethodLabels: Record<string, string> = {
  credential: 'email and password',
  google: 'Google',
  github: 'GitHub',
  twitter: 'X',
  'magic-link': 'email sign-in link',
}

async function getAuthMethodLabels(userId: string) {
  const identities = await prisma.authIdentity.findMany({
    where: { userId },
    select: { providerId: true },
    orderBy: { createdAt: 'asc' },
  })

  return Array.from(
    new Set(
      identities.map(
        (identity) =>
          authMethodLabels[identity.providerId] ?? identity.providerId,
      ),
    ),
  )
}

function buildPasswordRecoveryEmail(opts: {
  resetUrl: string
  methodLabels: string[]
}) {
  return renderPasswordRecoveryEmail(opts)
}

const beforeAuthMiddleware = createAuthMiddleware(async (ctx) => {
  const password =
    ctx.path === '/sign-up/email'
      ? ctx.body?.password
      : ctx.path === '/reset-password' || ctx.path === '/change-password'
        ? ctx.body?.newPassword
        : undefined

  if (typeof password === 'string' && !isStrongPassword(password)) {
    throw new APIError('BAD_REQUEST', {
      message:
        'Password must be at least 8 characters and include uppercase, lowercase, number, and symbol.',
      code: 'PASSWORD_POLICY_NOT_MET',
    })
  }

  await persistSignupInviteCookie(ctx)
  await enforceSignupGate(ctx)
})

// Integration and unit tests share the local PostgreSQL database with the
// already-running development API. Persisting test signing keys there would
// replace or conflict with keys encrypted by the development secret. Keep test
// JWKS process-local while development and production continue using Better
// Auth's default database-backed adapter.
const testJwks: Jwk[] = []
const testJwtAdapter: JwtOptions['adapter'] | undefined =
  env.NODE_ENV === 'test'
    ? {
        async getJwks() {
          return [...testJwks]
        },
        async createJwk(data) {
          const key: Jwk = { ...data, id: randomUUID() }
          testJwks.push(key)
          return key
        },
      }
    : undefined

type OAuthToken = {
  accessToken?: string
}

type GitHubProfile = {
  id: number | string
  login?: string | null
  name?: string | null
  email?: string | null
  avatar_url?: string | null
}

type GitHubEmail = {
  email: string
  primary: boolean
  verified: boolean
  visibility: 'public' | 'private' | null
}

async function fetchGitHubJson<T>(url: string, accessToken: string) {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'User-Agent': 'spliit-cloud',
    },
  })
  if (!response.ok) return null
  return (await response.json()) as T
}

/**
 * Resolve the Spliit `Account` for a GitHub OAuth sign-in. Prefers a verified
 * email from GitHub's `/user/emails` endpoint; falls back to a synthetic
 * placeholder email (`<id>@github.placeholder.local`) when the user has no
 * verified email on file (private email, missing `user:email` scope). The
 * synthetic path is what enables "email-less accounts" — the user gets a
 * complete account and can use the app, but email-only features (magic-link
 * sign-in, password reset, notifications) skip them because the email is a
 * placeholder.
 */
export async function getVerifiedGitHubUserInfo(token: OAuthToken) {
  if (!token.accessToken) return null

  const profile = await fetchGitHubJson<GitHubProfile>(
    'https://api.github.com/user',
    token.accessToken,
  )
  if (!profile) return null

  const emails = await fetchGitHubJson<GitHubEmail[]>(
    'https://api.github.com/user/emails',
    token.accessToken,
  )

  const verifiedEmail =
    emails?.find((email) => email.primary && email.verified) ??
    emails?.find((email) => email.verified)

  const profileId = String(profile.id)
  const displayName = profile.name || profile.login || ''
  const image = profile.avatar_url ?? undefined

  if (verifiedEmail) {
    return {
      user: {
        id: profileId,
        name: displayName,
        email: verifiedEmail.email,
        image,
        emailVerified: true,
      },
      data: {
        ...profile,
        email: verifiedEmail.email,
      },
    }
  }

  // No verified email on GitHub. Synthesize a placeholder so the user
  // can still sign in. `emailVerified: false` keeps magic-link sign-in
  // and password recovery off the table for these accounts (they have
  // no real address to send to) and `isPlaceholderEmail(...)` is the
  // application-side marker to skip email-only features.
  return {
    user: {
      id: profileId,
      name: displayName,
      email: buildProviderPlaceholderEmail('github', profileId),
      image,
      emailVerified: false,
    },
    data: {
      ...profile,
      email: null,
      isPlaceholderEmail: true,
    },
  }
}

type TwitterProfile = {
  data?: {
    id?: string
    name?: string | null
    username?: string | null
    profile_image_url?: string | null
    confirmed_email?: string | null
  }
}

const TWITTER_PROFILE_FETCH_TIMEOUT_MS = 8_000

async function fetchTwitterJson<T>(url: string, accessToken: string) {
  try {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      signal: AbortSignal.timeout(TWITTER_PROFILE_FETCH_TIMEOUT_MS),
    })
    if (!response.ok) return null
    return (await response.json()) as T
  } catch {
    return null
  }
}

/**
 * Resolve the Spliit `Account` for an X (Twitter) OAuth sign-in. Prefers the
 * confirmed email from X API v2 (`user.fields=confirmed_email`); falls back to
 * a synthetic placeholder (`<id>@twitter.placeholder.local`) when the user has
 * no confirmed email. Better Auth's default uses the X username as the email in
 * that case, which is not a real address and would break account linking and
 * email-only features.
 */
export async function getVerifiedTwitterUserInfo(token: OAuthToken) {
  if (!token.accessToken) return null

  const profile = await fetchTwitterJson<TwitterProfile>(
    'https://api.x.com/2/users/me?user.fields=profile_image_url,confirmed_email',
    token.accessToken,
  )
  const data = profile?.data
  if (!data?.id) return null

  const profileId = String(data.id)
  const displayName = data.name || data.username || ''
  const image = data.profile_image_url ?? undefined
  const confirmedEmail = data.confirmed_email?.trim()

  if (confirmedEmail) {
    return {
      user: {
        id: profileId,
        name: displayName,
        email: confirmedEmail,
        image,
        emailVerified: true,
      },
      data: {
        ...data,
        email: confirmedEmail,
      },
    }
  }

  return {
    user: {
      id: profileId,
      name: displayName,
      email: buildProviderPlaceholderEmail('twitter', profileId),
      image,
      emailVerified: false,
    },
    data: {
      ...data,
      email: null,
      isPlaceholderEmail: true,
    },
  }
}

/**
 * Spliit authentication is built on better-auth. better-auth owns its own
 * schema (user, session, account, verification). We map those tables to our
 * Spliit concepts:
 *
 * Better-auth "user" -> Account (stable global user profile) better-auth
 * "account" -> AuthIdentity (provider identity records) better-auth "session"
 * -> Session (server-recognized sessions) better-auth "verification" ->
 * Verification (magic-link/email tokens)
 *
 * The mapping is achieved by passing `modelName` overrides to better-auth and
 * by naming the Prisma models to match (see packages/db/prisma/schema.prisma).
 *
 * Email identity merging: better-auth links a new OAuth/magic-link sign-in to
 * the existing `Account` when the verified email matches. We rely on the
 * library's `accountLinking` behaviour for that.
 */
export const auth = betterAuth({
  appName: 'Spliit Cloud',
  baseURL: getApiBaseUrl(),
  // The Hono mount point is `/auth/*`; tell better-auth so its internal
  // router strips the prefix when matching request paths. Without this,
  // basePath defaults to `/api/auth` and every endpoint (sign-in, callback,
  // social, session, …) returns 404.
  basePath: '/auth',
  // OAuth Provider mode exposes `/oauth2/token`; Better Auth's standalone JWT
  // token endpoint is redundant and must not be advertised or callable.
  disabledPaths: ['/token'],
  secret: env.BETTER_AUTH_SECRET ?? 'spliit-dev-secret-change-me',
  // CORS already allows every configured WEB_ORIGINS entry; pass the full
  // list to better-auth so its trusted-origin check agrees. With only the
  // first entry here, sign-in from any additional origin would pass CORS
  // and then be rejected by better-auth.
  trustedOrigins: webOrigins,

  database: prismaAdapter(prisma, {
    provider: 'postgresql',
  }),

  // Use Spliit-specific model names that match our Prisma schema.
  user: {
    modelName: 'Account',
  },
  session: {
    modelName: 'Session',
    // 180-day (6 months) rolling sessions; better-auth handles refresh/sliding expiry.
    expiresIn: 60 * 60 * 24 * 180,
    updateAge: 60 * 60 * 24,
    cookieCache: {
      enabled: true,
      maxAge: 60 * 5,
    },
  },
  account: {
    modelName: 'AuthIdentity',
    accountLinking: {
      enabled: true,
      trustedProviders: [
        'google',
        'github',
        'twitter',
        'credential',
        'magic-link',
      ],
    },
  },
  verification: {
    modelName: 'Verification',
  },

  hooks: {
    before: beforeAuthMiddleware,
  },

  // Reconcile pending friend-ledger invitations that target this
  // account's email immediately after the account row is created.
  // This is a one-time initialization — the hook fires on sign-up
  // (email/password, magic link, OAuth) and on programmatic account
  // creation. The function is idempotent: subsequent calls are no-ops
  // because all matching invitations are already flipped to ACCEPTED.
  databaseHooks: {
    user: {
      create: {
        before: async (user, context) => {
          await assertCanCreateAccount({
            email: user.email,
            context,
          })
        },
        after: async (user) => {
          if (user.email) {
            await autoAcceptPendingFriendInvitationsForAccount({
              accountId: user.id,
              accountEmail: user.email,
            })
          }
        },
      },
      update: {
        after: async (user) => {
          invalidateAccountCache(user.id)
        },
      },
      delete: {
        after: async (user) => {
          invalidateAccountCache(user.id)
        },
      },
    },
  },

  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    minPasswordLength: 8,
    maxPasswordLength: 128,
    // One-hour window between requesting the reset and clicking the link.
    // Long enough to read the email, short enough that a leaked link is
    // unlikely to still be useful to an attacker.
    resetPasswordTokenExpiresIn: 60 * 60,
    // Cut off any other sessions for this account when the password is
    // changed. Standard recovery-flow hygiene: if a stolen session cookie
    // outlived the user noticing the breach, the reset kicks it out.
    revokeSessionsOnPasswordReset: true,
    async sendResetPassword({ user, url }) {
      // Best-effort: a failed send must not break the forgot-password flow.
      // better-auth already created the verification token in the DB, so the
      // user can retry from the forgot-password page and a fresh token will
      // be issued on the next request. Mirrors the swallow-and-warn pattern
      // used for verification emails and magic links above.
      try {
        const methodLabels = await getAuthMethodLabels(user.id)
        const email = await buildPasswordRecoveryEmail({
          resetUrl: url,
          methodLabels,
        })
        await sendEmail({
          to: user.email,
          ...email,
        })
      } catch (err) {
        console.warn(
          `[password-reset] failed to send reset email to ${user.email}:`,
          err,
        )
      }
    },
  },

  emailVerification: {
    // Verification should complete the sign-up by creating a session before
    // redirecting back to the web app.
    autoSignInAfterVerification: true,
    async sendVerificationEmail({ user, url }) {
      // Best-effort: a failed send must not break the sign-up flow.
      // better-auth already created the verification token in the DB, so the
      // user can retry from the sign-in page and a fresh token will be issued.
      // Mirrors the swallow-and-warn pattern used for magic links.
      try {
        const rendered = await renderVerificationEmail({
          verificationUrl: url,
        })
        await sendEmail({
          to: user.email,
          ...rendered,
        })
      } catch (err) {
        console.warn(
          `[email-verification] failed to send verification email to ${user.email}:`,
          err,
        )
      }
    },
  },

  socialProviders: (() => {
    const providers: Record<
      string,
      {
        clientId: string
        clientSecret: string
        getUserInfo?:
          | typeof getVerifiedGitHubUserInfo
          | typeof getVerifiedTwitterUserInfo
      }
    > = {}
    if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
      providers.google = {
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
      }
    }
    if (env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET) {
      providers.github = {
        clientId: env.GITHUB_CLIENT_ID,
        clientSecret: env.GITHUB_CLIENT_SECRET,
        getUserInfo: getVerifiedGitHubUserInfo,
      }
    }
    if (env.TWITTER_CLIENT_ID && env.TWITTER_CLIENT_SECRET) {
      providers.twitter = {
        clientId: env.TWITTER_CLIENT_ID,
        clientSecret: env.TWITTER_CLIENT_SECRET,
        getUserInfo: getVerifiedTwitterUserInfo,
      }
    }
    return Object.keys(providers).length > 0 ? providers : undefined
  })(),

  plugins: [
    ...(env.ENABLE_MCP
      ? [
          oauthProvider({
            loginPage: `${webOrigins[0]}/oauth/login`,
            consentPage: `${webOrigins[0]}/oauth/consent`,
            scopes: [
              'openid',
              'profile',
              'email',
              'offline_access',
              'spliit:groups:read',
              'spliit:expenses:write',
            ],
            validAudiences: [`${env.MCP_PUBLIC_URL!}/mcp`],
            allowDynamicClientRegistration: true,
            allowUnauthenticatedClientRegistration: true,
            allowPublicClientPrelogin: true,
            silenceWarnings: { oauthAuthServerConfig: true },
            grantTypes: ['authorization_code', 'refresh_token'],
            clientRegistrationDefaultScopes: [
              'openid',
              'profile',
              'email',
              'offline_access',
              'spliit:groups:read',
              'spliit:expenses:write',
            ],
            clientRegistrationAllowedScopes: [
              'openid',
              'profile',
              'email',
              'offline_access',
              'spliit:groups:read',
              'spliit:expenses:write',
            ],
            customAccessTokenClaims: ({ user }) => ({
              account_id: user?.id,
            }),
          }),
          jwt({
            // OAuth access tokens are minted by the OAuth Provider flow. Adding a
            // JWT header to every cookie-session response is unnecessary and makes
            // ordinary `/get-session` reads depend on the OAuth signing key.
            disableSettingJwtHeader: true,
            adapter: testJwtAdapter,
          }),
        ]
      : []),
    magicLink({
      disableSignUp: false,
      sendMagicLink: async ({ email, url }) => {
        // Best-effort: a failed send must not break the magic-link sign-in
        // flow. better-auth already created the verification token in the DB,
        // so the user can retry from the sign-in page and a fresh token will
        // be issued on the next request. Mirrors the swallow-and-warn pattern
        // used in lib/invitations.ts.
        try {
          const rendered = await renderMagicLinkEmail({
            signInUrl: url,
          })
          await sendEmail({
            to: email,
            ...rendered,
          })
        } catch (err) {
          console.warn(
            `[magic-link] failed to send magic link email to ${email}:`,
            err,
          )
        }
      },
    }),
    // Exposes `auth.api.generateOpenAPISchema()` so the build-time spec
    // generator in `apps/api/scripts/generate-openapi.ts` can introspect
    // every endpoint (core + magic-link) and emit accurate paths, request
    // bodies, and responses — replacing hand-maintained auth paths that
    // drifted from the real routes. `disableDefaultReference` keeps
    // better-auth from mounting its own Scalar UI at `/auth/reference`;
    // we already serve a unified `/docs` page that merges tRPC + auth.
    //
    // Gated to non-production: the runtime schema endpoint
    // (`GET /auth/open-api/generate-schema`) leaks the auth API surface
    // and is not needed once the spec has been generated. The build
    // script runs with `NODE_ENV=` (empty), so the plugin is always
    // available at build time.
    ...(process.env.NODE_ENV === 'production'
      ? []
      : [openAPI({ disableDefaultReference: true })]),
  ],

  advanced: {
    // Use secure, HTTP-only cookies. The web client already runs on the same
    // origin in production and CORS is configured to allow credentials, so we
    // can rely on first-party cookies without exposing tokens to JS.
    useSecureCookies: process.env.NODE_ENV === 'production',
    defaultCookieAttributes: {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
    },
  },
})

export type AuthAccount = Account
export type AuthInstance = typeof auth
