import { Account, prisma } from '@spliit/db'
import { betterAuth } from 'better-auth'
import { prismaAdapter } from 'better-auth/adapters/prisma'
import { magicLink } from 'better-auth/plugins'
import { env } from '../env'
import { sendEmail } from '../mail/send'
import { getApiBaseUrl, getWebBaseUrl } from './urls'

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
  secret: env.BETTER_AUTH_SECRET ?? 'spliit-dev-secret-change-me',
  trustedOrigins: [getWebBaseUrl()],

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
      trustedProviders: ['google', 'credential', 'magic-link'],
    },
  },
  verification: {
    modelName: 'Verification',
  },

  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    minPasswordLength: 8,
    maxPasswordLength: 128,
  },

  socialProviders:
    env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
      ? {
          google: {
            clientId: env.GOOGLE_CLIENT_ID,
            clientSecret: env.GOOGLE_CLIENT_SECRET,
          },
        }
      : undefined,

  plugins: [
    magicLink({
      disableSignUp: false,
      sendMagicLink: async ({ email, url }) => {
        await sendEmail({
          to: email,
          subject: 'Your Spliit sign-in link',
          text:
            `Click the link below to sign in to Spliit.\n\n${url}\n\n` +
            `If you did not request this email, you can safely ignore it.`,
        })
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
