import { createHash, randomInt, timingSafeEqual } from 'node:crypto'

import {
  APIError,
  createAuthEndpoint,
  sessionMiddleware,
} from 'better-auth/api'
import { z } from 'zod'

import { Prisma, prisma } from '@spliit/db'

import { autoAcceptPendingFriendInvitationsForAccount } from '../api/friends'
import { randomId } from '../api/shared'
import { env } from '../env'
import { isPlaceholderEmail } from '../invitations'
import { sendEmail } from '../mail/send'
import {
  renderEmailChangedNoticeEmail,
  renderEmailChangeOtpEmail,
} from '../mail/templates'
import {
  FixedWindowLimiter,
  logRateLimitExceeded,
  resolveClientIp,
} from '../rate-limit'
import { invalidateAccountCache } from './account-cache'
import { enforceAuthEmailRecipientLimit } from './email-rate-limit'

export const EMAIL_CHANGE_OTP_LENGTH = 6
export const EMAIL_CHANGE_OTP_TTL_MS = 10 * 60 * 1000
export const EMAIL_CHANGE_OTP_MAX_ATTEMPTS = 5
export const EMAIL_CHANGE_IDENTIFIER_PREFIX = 'email-change:'

const requestBody = z.object({
  email: z.string().max(320),
  acknowledgedGraduation: z.boolean().optional(),
})
const confirmBody = z.object({
  email: z.string().max(320),
  otp: z.string().max(16),
})

const pendingPayload = z.object({
  email: z.string(),
  otpHash: z.string(),
  attempts: z.number().int().nonnegative(),
})

const requestLimiter = new FixedWindowLimiter({
  limit: 10,
  windowMs: 60 * 60 * 1000,
})
const confirmLimiter = new FixedWindowLimiter({
  limit: 20,
  windowMs: 60 * 60 * 1000,
})

const EMAIL_SCHEMA = z.string().trim().email()

function otpPepper() {
  return env.BETTER_AUTH_SECRET ?? 'spliit-dev-secret-change-me'
}

export function emailChangeVerificationIdentifier(accountId: string) {
  return `${EMAIL_CHANGE_IDENTIFIER_PREFIX}${accountId}`
}

export function generateEmailChangeOtp() {
  return randomInt(0, 10 ** EMAIL_CHANGE_OTP_LENGTH)
    .toString()
    .padStart(EMAIL_CHANGE_OTP_LENGTH, '0')
}

export function hashEmailChangeOtp(input: {
  accountId: string
  email: string
  otp: string
}) {
  return createHash('sha256')
    .update(otpPepper())
    .update('\0')
    .update(input.accountId)
    .update('\0')
    .update(input.email)
    .update('\0')
    .update(input.otp)
    .digest('hex')
}

export function emailChangeOtpMatches(
  storedHash: string,
  candidateHash: string,
) {
  const stored = Buffer.from(storedHash)
  const candidate = Buffer.from(candidateHash)
  if (stored.length !== candidate.length) return false
  return timingSafeEqual(stored, candidate)
}

export function normalizeEmailChangeAddress(email: string) {
  return email.trim().toLowerCase()
}

function parseEmailAddress(email: string) {
  const parsed = EMAIL_SCHEMA.safeParse(email)
  if (!parsed.success) {
    throw new APIError('BAD_REQUEST', {
      message: 'Enter a valid email address.',
      code: 'INVALID_EMAIL',
    })
  }
  return normalizeEmailChangeAddress(parsed.data)
}

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
    message: 'Too many email requests. Please try again later.',
    code: 'EMAIL_CHANGE_RATE_LIMITED',
  })
}

async function loadAccount(accountId: string) {
  const account = await prisma.account.findUnique({
    where: { id: accountId },
    select: {
      id: true,
      email: true,
      emailVerified: true,
      isAnonymous: true,
      name: true,
      image: true,
      createdAt: true,
      updatedAt: true,
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

function isUniqueConstraintError(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  )
}

export function emailChange() {
  return {
    id: 'spliit-email-change',
    endpoints: {
      requestEmailChange: createAuthEndpoint(
        '/email/request-change',
        { method: 'POST', use: [sessionMiddleware], body: requestBody },
        async (ctx) => {
          noStore(ctx)
          const sessionUser = requireSessionUser(ctx)
          enforceAccountRateLimit(
            ctx,
            requestLimiter,
            sessionUser.id,
            'email-change-request',
          )
          const account = await loadAccount(sessionUser.id)
          const email = parseEmailAddress(ctx.body.email)

          if (isPlaceholderEmail(email)) {
            throw new APIError('BAD_REQUEST', {
              message: 'Enter a valid email address.',
              code: 'PLACEHOLDER_EMAIL',
            })
          }
          if (
            !isPlaceholderEmail(account.email) &&
            normalizeEmailChangeAddress(account.email) === email
          ) {
            throw new APIError('BAD_REQUEST', {
              message: 'That is already your email address.',
              code: 'SAME_EMAIL',
            })
          }
          if (account.isAnonymous && ctx.body.acknowledgedGraduation !== true) {
            throw new APIError('BAD_REQUEST', {
              message:
                'Confirm that adding an email replaces anonymous sign-in link recovery.',
              code: 'GRADUATION_ACK_REQUIRED',
            })
          }

          const taken = await prisma.account.findFirst({
            where: {
              email: { equals: email, mode: 'insensitive' },
              NOT: { id: account.id },
            },
            select: { id: true },
          })
          if (taken) {
            throw new APIError('BAD_REQUEST', {
              message: 'This email is already used by another account.',
              code: 'EMAIL_IN_USE',
            })
          }

          enforceAuthEmailRecipientLimit(email, '/email/request-change')

          const otp = generateEmailChangeOtp()
          const identifier = emailChangeVerificationIdentifier(account.id)
          const expiresAt = new Date(Date.now() + EMAIL_CHANGE_OTP_TTL_MS)
          const value = JSON.stringify({
            email,
            otpHash: hashEmailChangeOtp({
              accountId: account.id,
              email,
              otp,
            }),
            attempts: 0,
          })

          try {
            const rendered = await renderEmailChangeOtpEmail({
              otp,
              expiresInMinutes: Math.round(EMAIL_CHANGE_OTP_TTL_MS / 60_000),
            })
            await sendEmail({ to: email, ...rendered })
          } catch (err) {
            console.warn(`[email-change] failed to send OTP to ${email}:`, err)
            throw new APIError('INTERNAL_SERVER_ERROR', {
              message: 'Could not send the confirmation email.',
              code: 'EMAIL_SEND_FAILED',
            })
          }

          // Persist only after the message is accepted so a failed send
          // does not clobber a still-valid code from a previous request.
          // Verification.identifier is not unique (Better Auth shares this
          // table), so clobber is delete+insert in one transaction.
          await prisma.$transaction(async (tx) => {
            await tx.verification.deleteMany({ where: { identifier } })
            await tx.verification.create({
              data: {
                id: randomId(),
                identifier,
                expiresAt,
                value,
              },
            })
          })

          return ctx.json({ sent: true })
        },
      ),
      confirmEmailChange: createAuthEndpoint(
        '/email/confirm-change',
        { method: 'POST', use: [sessionMiddleware], body: confirmBody },
        async (ctx) => {
          noStore(ctx)
          const sessionUser = requireSessionUser(ctx)
          enforceAccountRateLimit(
            ctx,
            confirmLimiter,
            sessionUser.id,
            'email-change-confirm',
          )
          const account = await loadAccount(sessionUser.id)
          const email = parseEmailAddress(ctx.body.email)
          const otp = ctx.body.otp.trim()
          if (!/^\d{6}$/.test(otp)) {
            throw new APIError('BAD_REQUEST', {
              message: 'Enter the 6-digit code from the email.',
              code: 'INVALID_OTP',
            })
          }

          const identifier = emailChangeVerificationIdentifier(account.id)
          const verification = await prisma.verification.findFirst({
            where: { identifier },
            orderBy: { createdAt: 'desc' },
          })
          if (
            !verification ||
            new Date(verification.expiresAt).getTime() <= Date.now()
          ) {
            if (verification) {
              await prisma.verification.deleteMany({ where: { identifier } })
            }
            throw new APIError('BAD_REQUEST', {
              message: 'This code has expired. Request a new one.',
              code: 'OTP_EXPIRED',
            })
          }

          let pendingValue: unknown
          try {
            pendingValue = JSON.parse(verification.value) as unknown
          } catch {
            await prisma.verification.deleteMany({ where: { identifier } })
            throw new APIError('BAD_REQUEST', {
              message: 'This code has expired. Request a new one.',
              code: 'OTP_EXPIRED',
            })
          }
          const pending = pendingPayload.safeParse(pendingValue)
          if (!pending.success || pending.data.email !== email) {
            throw new APIError('BAD_REQUEST', {
              message: 'Enter the 6-digit code from the email.',
              code: 'INVALID_OTP',
            })
          }

          const candidateHash = hashEmailChangeOtp({
            accountId: account.id,
            email,
            otp,
          })
          if (!emailChangeOtpMatches(pending.data.otpHash, candidateHash)) {
            const attempts = pending.data.attempts + 1
            if (attempts >= EMAIL_CHANGE_OTP_MAX_ATTEMPTS) {
              await prisma.verification.deleteMany({ where: { identifier } })
            } else {
              await prisma.verification.update({
                where: { id: verification.id },
                data: {
                  value: JSON.stringify({ ...pending.data, attempts }),
                },
              })
            }
            throw new APIError('BAD_REQUEST', {
              message: 'Enter the 6-digit code from the email.',
              code: 'INVALID_OTP',
            })
          }

          const previousEmail = account.email
          const previousWasPlaceholder = isPlaceholderEmail(previousEmail)
          const wasAnonymous = account.isAnonymous

          let updated: typeof account
          try {
            updated = await prisma.$transaction(async (tx) => {
              const next = await tx.account.update({
                where: { id: account.id },
                data: {
                  email,
                  emailVerified: true,
                  ...(wasAnonymous ? { isAnonymous: false } : {}),
                },
                select: {
                  id: true,
                  email: true,
                  emailVerified: true,
                  isAnonymous: true,
                  name: true,
                  image: true,
                  createdAt: true,
                  updatedAt: true,
                },
              })
              if (wasAnonymous) {
                await tx.anonymousRecoveryCredential.deleteMany({
                  where: { accountId: account.id },
                })
              }
              if (!previousWasPlaceholder) {
                await tx.authIdentity.updateMany({
                  where: {
                    userId: account.id,
                    providerId: { in: ['credential', 'magic-link'] },
                    accountId: previousEmail,
                  },
                  data: { accountId: email },
                })
              }
              await tx.verification.deleteMany({ where: { identifier } })
              return next
            })
          } catch (error) {
            if (isUniqueConstraintError(error)) {
              throw new APIError('BAD_REQUEST', {
                message: 'This email is already used by another account.',
                code: 'EMAIL_IN_USE',
              })
            }
            throw error
          }

          invalidateAccountCache(account.id)

          try {
            await autoAcceptPendingFriendInvitationsForAccount({
              accountId: account.id,
              accountEmail: email,
            })
          } catch (err) {
            console.warn(
              `[email-change] failed to auto-accept invitations for ${account.id}:`,
              err,
            )
          }

          if (!previousWasPlaceholder) {
            try {
              const rendered = await renderEmailChangedNoticeEmail({
                newEmail: email,
              })
              await sendEmail({ to: previousEmail, ...rendered })
            } catch (err) {
              console.warn(
                `[email-change] failed to notify previous inbox ${previousEmail}:`,
                err,
              )
            }
          }

          return ctx.json({
            success: true,
            email: updated.email,
            isAnonymous: updated.isAnonymous,
          })
        },
      ),
    },
  }
}
