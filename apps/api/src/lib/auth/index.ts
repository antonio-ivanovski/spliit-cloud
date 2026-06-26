import { Account, prisma } from '@spliit/db'
import { isStrongPassword } from '@spliit/domain/password'
import { betterAuth } from 'better-auth'
import { prismaAdapter } from 'better-auth/adapters/prisma'
import { APIError, createAuthMiddleware } from 'better-auth/api'
import { magicLink } from 'better-auth/plugins'
import { env, webOrigins } from '../env'
import { sendEmail } from '../mail/send'
import { getApiBaseUrl } from './urls'

const authMethodLabels: Record<string, string> = {
  credential: 'email and password',
  google: 'Google',
  github: 'GitHub',
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
  const hasPassword = opts.methodLabels.includes(authMethodLabels.credential)
  const otherMethods = opts.methodLabels.filter(
    (method) => method !== authMethodLabels.credential,
  )

  if (hasPassword) {
    const extra =
      otherMethods.length > 0
        ? `\n\nThis account can also sign in with: ${otherMethods.join(', ')}.`
        : ''
    return {
      subject: 'Reset your Spliit password',
      text:
        `Click the link below to reset your Spliit password.\n\n${opts.resetUrl}` +
        extra +
        `\n\nIf you did not request a password reset, you can safely ignore this email.`,
    }
  }

  const methods =
    otherMethods.length > 0 ? otherMethods.join(', ') : 'an email sign-in link'

  return {
    subject: 'Sign in to Spliit',
    text:
      `We received a password reset request for this Spliit account, but it does not have a password sign-in method.\n\n` +
      `Use one of these sign-in methods instead: ${methods}.\n\n` +
      `If you did not request this email, you can safely ignore it.`,
  }
}

const passwordPolicyMiddleware = createAuthMiddleware(async (ctx) => {
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
})

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

  if (!verifiedEmail) {
    throw new APIError('BAD_REQUEST', {
      code: 'GITHUB_VERIFIED_EMAIL_REQUIRED',
      message:
        'GitHub did not provide a verified email address. Verify an email on GitHub, then try again.',
    })
  }

  return {
    user: {
      id: String(profile.id),
      name: profile.name || profile.login || '',
      email: verifiedEmail.email,
      image: profile.avatar_url ?? undefined,
      emailVerified: true,
    },
    data: {
      ...profile,
      email: verifiedEmail.email,
    },
  }
}

/**
 * Spliit authentication is built on better-auth. better-auth owns its own
 * schema (user, session, account, verification). We map those tables to our
 * Spliit concepts:
 *
 *   better-auth "user"     -> Account     (stable global user profile)
 *   better-auth "account"  -> AuthIdentity (provider identity records)
 *   better-auth "session"  -> Session     (server-recognized sessions)
 *   better-auth "verification" -> Verification (magic-link/email tokens)
 *
 * The mapping is achieved by passing `modelName` overrides to better-auth and
 * by naming the Prisma models to match (see packages/db/prisma/schema.prisma).
 *
 * Email identity merging: better-auth links a new OAuth/magic-link sign-in
 * to the existing `Account` when the verified email matches. We rely on the
 * library's `accountLinking` behaviour for that.
 */
export const auth = betterAuth({
  appName: 'Spliit',
  baseURL: getApiBaseUrl(),
  // The Hono mount point is `/auth/*`; tell better-auth so its internal
  // router strips the prefix when matching request paths. Without this,
  // basePath defaults to `/api/auth` and every endpoint (sign-in, callback,
  // social, session, …) returns 404.
  basePath: '/auth',
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
    // 7-day rolling sessions; better-auth handles refresh/sliding expiry.
    expiresIn: 60 * 60 * 24 * 7,
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
      trustedProviders: ['google', 'github', 'credential', 'magic-link'],
    },
  },
  verification: {
    modelName: 'Verification',
  },

  hooks: {
    before: passwordPolicyMiddleware,
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
        const email = buildPasswordRecoveryEmail({
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
        await sendEmail({
          to: user.email,
          subject: 'Verify your Spliit account',
          text:
            `Click the link below to verify your email address and sign in to Spliit.\n\n${url}\n\n` +
            `If you did not create a Spliit account, you can safely ignore this email.`,
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
        getUserInfo?: typeof getVerifiedGitHubUserInfo
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
    return Object.keys(providers).length > 0 ? providers : undefined
  })(),

  plugins: [
    magicLink({
      disableSignUp: false,
      sendMagicLink: async ({ email, url }) => {
        // Best-effort: a failed send must not break the magic-link sign-in
        // flow. better-auth already created the verification token in the DB,
        // so the user can retry from the sign-in page and a fresh token will
        // be issued on the next request. Mirrors the swallow-and-warn pattern
        // used in lib/invitations.ts.
        try {
          await sendEmail({
            to: email,
            subject: 'Your Spliit sign-in link',
            text:
              `Click the link below to sign in to Spliit.\n\n${url}\n\n` +
              `If you did not request this email, you can safely ignore it.`,
          })
        } catch (err) {
          console.warn(
            `[magic-link] failed to send magic link email to ${email}:`,
            err,
          )
        }
      },
    }),
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
