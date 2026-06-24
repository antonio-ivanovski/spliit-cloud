import { Account, prisma } from '@spliit/db'
import { betterAuth } from 'better-auth'
import { prismaAdapter } from 'better-auth/adapters/prisma'
import { magicLink } from 'better-auth/plugins'
import { env, webOrigins } from '../env'
import { sendEmail } from '../mail/send'
import { getApiBaseUrl } from './urls'

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
