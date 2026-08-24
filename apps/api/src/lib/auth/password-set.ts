import {
  APIError,
  createAuthEndpoint,
  sensitiveSessionMiddleware,
  sessionMiddleware,
} from 'better-auth/api'
import { createLocalAccountIssuer } from 'better-auth/db'
import { z } from 'zod'

import { Prisma, prisma } from '@spliit/db'
import { isStrongPassword } from '@spliit/domain/password'

import { env } from '../env'
import { isPlaceholderEmail } from '../invitations'
import { sendEmail } from '../mail/send'
import {
  renderPasswordRemovedNoticeEmail,
  renderPasswordSetNoticeEmail,
} from '../mail/templates'
import {
  FixedWindowLimiter,
  logRateLimitExceeded,
  resolveClientIp,
} from '../rate-limit'
import { invalidateAccountCache } from './account-cache'

const setBody = z.object({
  newPassword: z.string().min(1).max(128),
})

const removeBody = z.object({
  currentPassword: z.string().min(1).max(128),
})

export const setLimiter = new FixedWindowLimiter({
  limit: 10,
  windowMs: 60 * 60 * 1000,
})

export const removeLimiter = new FixedWindowLimiter({
  limit: 10,
  windowMs: 60 * 60 * 1000,
})

function noStore(ctx: { setHeader(name: string, value: string): void }) {
  ctx.setHeader('Cache-Control', 'no-store')
  ctx.setHeader('Pragma', 'no-cache')
}

function requireSessionUser(ctx: {
  context: { session: { user: Record<string, unknown> } }
}) {
  const user = ctx.context.session.user
  if (typeof user.id !== 'string' || user.id.length === 0) {
    throw new APIError('UNAUTHORIZED', {
      message: 'Authentication required.',
      code: 'UNAUTHORIZED',
    })
  }
  return user as typeof user & { id: string }
}

function enforceAccountRateLimit(
  ctx: { request?: Request; setHeader(name: string, value: string): void },
  limiter: FixedWindowLimiter,
  accountId: string,
  policy: string,
) {
  const ip = resolveClientIp(ctx.request?.headers ?? new Headers(), {
    trustProxy: env.TRUST_PROXY,
  })
  const decision = limiter.hit(`${accountId}:${ip}`)
  if (decision.allowed) return
  logRateLimitExceeded({
    policy,
    identity: accountId,
    retryAfterSeconds: decision.retryAfterSeconds,
  })
  ctx.setHeader('Retry-After', String(decision.retryAfterSeconds))
  throw new APIError('TOO_MANY_REQUESTS', {
    message: 'Too many attempts. Please try again later.',
    code: 'PASSWORD_RATE_LIMITED',
  })
}

function throwAlreadyHasPassword(): never {
  throw new APIError('CONFLICT', {
    message: 'Password already set. Use change password instead.',
    code: 'ALREADY_HAS_PASSWORD',
  })
}

function isUniqueConstraintError(error: unknown) {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  ) {
    return true
  }
  if (
    error != null &&
    typeof error === 'object' &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2002'
  ) {
    return true
  }
  return false
}

async function loadAccount(accountId: string) {
  const account = await prisma.account.findUnique({
    where: { id: accountId },
    select: {
      id: true,
      email: true,
      emailVerified: true,
      isAnonymous: true,
    },
  })
  if (!account) {
    throw new APIError('UNAUTHORIZED', {
      message: 'Authentication required.',
      code: 'UNAUTHORIZED',
    })
  }
  return account
}

async function notifyPasswordSet(email: string) {
  try {
    const rendered = await renderPasswordSetNoticeEmail()
    await sendEmail({ to: email, ...rendered })
  } catch (err) {
    console.warn(`[password-set] failed to send notice to ${email}:`, err)
  }
}

async function notifyPasswordRemoved(email: string) {
  try {
    const rendered = await renderPasswordRemovedNoticeEmail()
    await sendEmail({ to: email, ...rendered })
  } catch (err) {
    console.warn(`[password-remove] failed to send notice to ${email}:`, err)
  }
}

export function passwordSet() {
  return {
    id: 'spliit-password-set',
    endpoints: {
      getPasswordStatus: createAuthEndpoint(
        '/password/status',
        { method: 'GET', use: [sessionMiddleware] },
        async (ctx) => {
          noStore(ctx)
          const sessionUser = requireSessionUser(ctx)
          const account =
            await ctx.context.internalAdapter.findCredentialAccount(
              sessionUser.id,
            )
          const hasPassword = account?.password != null
          return ctx.json({ hasPassword })
        },
      ),
      removePassword: createAuthEndpoint(
        '/password/remove',
        {
          method: 'POST',
          use: [sensitiveSessionMiddleware],
          body: removeBody,
        },
        async (ctx) => {
          noStore(ctx)
          const sessionUser = requireSessionUser(ctx)
          enforceAccountRateLimit(
            ctx,
            removeLimiter,
            sessionUser.id,
            'password-remove',
          )

          const account = await loadAccount(sessionUser.id)

          if (account.isAnonymous) {
            throw new APIError('FORBIDDEN', {
              message: 'Add a verified email before managing a password.',
              code: 'ANONYMOUS_REQUIRES_EMAIL',
            })
          }

          const identity =
            await ctx.context.internalAdapter.findCredentialAccount(account.id)

          if (!identity?.password) {
            throw new APIError('NOT_FOUND', {
              message: 'No password is set for this account.',
              code: 'CREDENTIAL_ACCOUNT_NOT_FOUND',
            })
          }

          // Current password is required for removal. If the user does not
          // know it, they must use the forgot-password flow to reset first.
          const valid = await ctx.context.password.verify({
            hash: identity.password,
            password: ctx.body.currentPassword,
          })
          if (!valid) {
            throw new APIError('BAD_REQUEST', {
              message: 'Current password is incorrect.',
              code: 'INVALID_PASSWORD',
            })
          }

          // Guard against lockout: require at least one alternative sign-in
          // method (another linked provider) or a verified real email that
          // can receive a magic link. Placeholder emails don't count.
          const otherIdentities =
            await ctx.context.internalAdapter.findAccounts(account.id)
          const hasOtherProvider = otherIdentities.some(
            (acc) => acc.providerId !== 'credential',
          )
          const hasVerifiedRealEmail =
            Boolean(account.email) &&
            !isPlaceholderEmail(account.email) &&
            account.emailVerified === true
          if (!hasOtherProvider && !hasVerifiedRealEmail) {
            throw new APIError('CONFLICT', {
              message: 'Cannot remove password without another sign-in method.',
              code: 'NO_ALTERNATIVE_SIGN_IN',
            })
          }

          await ctx.context.internalAdapter.updateAccount(identity.id, {
            password: null,
          })

          invalidateAccountCache(account.id)
          // account.email is guaranteed non-placeholder here (guarded above),
          // but keep the send best-effort — removal must succeed even if SMTP
          // is down.
          if (account.email && !isPlaceholderEmail(account.email)) {
            await notifyPasswordRemoved(account.email)
          }
          return ctx.json({ success: true })
        },
      ),
      setPassword: createAuthEndpoint(
        '/password/set',
        { method: 'POST', use: [sensitiveSessionMiddleware], body: setBody },
        async (ctx) => {
          noStore(ctx)
          const sessionUser = requireSessionUser(ctx)
          enforceAccountRateLimit(
            ctx,
            setLimiter,
            sessionUser.id,
            'password-set',
          )

          const account = await loadAccount(sessionUser.id)

          if (account.isAnonymous) {
            throw new APIError('FORBIDDEN', {
              message: 'Add a verified email before setting a password.',
              code: 'ANONYMOUS_REQUIRES_EMAIL',
            })
          }
          if (!account.email || isPlaceholderEmail(account.email)) {
            throw new APIError('FORBIDDEN', {
              message:
                'A verified email is required before setting a password.',
              code: 'PLACEHOLDER_EMAIL',
            })
          }
          if (!account.emailVerified) {
            throw new APIError('FORBIDDEN', {
              message: 'Verify your email before setting a password.',
              code: 'EMAIL_NOT_VERIFIED',
            })
          }

          const { newPassword } = ctx.body
          if (!isStrongPassword(newPassword)) {
            throw new APIError('BAD_REQUEST', {
              message:
                'Password must be at least 8 characters and include uppercase, lowercase, number, and symbol.',
              code: 'PASSWORD_POLICY_NOT_MET',
            })
          }

          const existing =
            await ctx.context.internalAdapter.findCredentialAccount(account.id)
          if (existing?.password) throwAlreadyHasPassword()

          const passwordHash = await ctx.context.password.hash(newPassword)

          try {
            if (existing) {
              await ctx.context.internalAdapter.updateAccount(existing.id, {
                password: passwordHash,
              })
            } else {
              await ctx.context.internalAdapter.linkAccount({
                userId: account.id,
                providerId: 'credential',
                issuer: createLocalAccountIssuer('credential'),
                accountId: account.id,
                password: passwordHash,
              })
            }
          } catch (error) {
            if (isUniqueConstraintError(error)) throwAlreadyHasPassword()
            throw error
          }

          invalidateAccountCache(account.id)
          await notifyPasswordSet(account.email)
          return ctx.json({ success: true })
        },
      ),
    },
  }
}
