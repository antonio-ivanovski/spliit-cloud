import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto'

import {
  APIError,
  createAuthEndpoint,
  getSessionFromCtx,
  sessionMiddleware,
} from 'better-auth/api'
import { setSessionCookie } from 'better-auth/cookies'
import { z } from 'zod'

import { prisma } from '@spliit/db'

import { env, webOrigins } from '../env'
import {
  FixedWindowLimiter,
  logRateLimitExceeded,
  resolveClientIp,
} from '../rate-limit'
import { invalidateAccountCache } from './account-cache'

const RECOVERY_KEY_PREFIX = 'spliit_anonymous_v1_'
const RECOVERY_KEY_PATTERN = /^spliit_anonymous_v1_[A-Za-z0-9_-]{43}$/
const ENCRYPTION_VERSION = 'v1'
const HASH_PATTERN = /^[a-f0-9]{64}$/

const recoveryLimiter = new FixedWindowLimiter({
  limit: 10,
  windowMs: 60 * 1000,
})
const rotationLimiter = new FixedWindowLimiter({
  limit: 5,
  windowMs: 60 * 1000,
})

const recoveryBody = z.object({
  code: z.string().max(128),
  replaceCurrentSession: z.boolean().optional(),
})
const acknowledgeBody = z.object({
  confirmedCopied: z.literal(true),
})
const rotateBody = z.object({ confirmed: z.literal(true) })
const activateRotationBody = z.object({
  activationTicket: z.string().max(2048),
  confirmedCopied: z.literal(true),
})

const rotationTicketPayload = z.object({
  accountId: z.string().min(1),
  currentKeyHash: z.string().regex(HASH_PATTERN),
  replacementKeyHash: z.string().regex(HASH_PATTERN),
})

function encryptionKey(purpose = 'anonymous-recovery-key') {
  return createHash('sha256')
    .update(env.BETTER_AUTH_SECRET ?? 'spliit-dev-secret-change-me')
    .update(`\0${purpose}`)
    .digest()
}

export function generateAnonymousRecoveryKey() {
  return `${RECOVERY_KEY_PREFIX}${randomBytes(32).toString('base64url')}`
}

export function hashAnonymousRecoveryKey(key: string) {
  return createHash('sha256').update(key).digest('hex')
}

export function encryptPendingRecoveryKey(key: string, accountId: string) {
  const nonce = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), nonce)
  cipher.setAAD(Buffer.from(accountId))
  const ciphertext = Buffer.concat([cipher.update(key, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [
    ENCRYPTION_VERSION,
    nonce.toString('base64url'),
    tag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.')
}

export function decryptPendingRecoveryKey(envelope: string, accountId: string) {
  const [version, nonceValue, tagValue, ciphertextValue] = envelope.split('.')
  if (
    version !== ENCRYPTION_VERSION ||
    !nonceValue ||
    !tagValue ||
    !ciphertextValue
  ) {
    throw new Error('Invalid recovery-key envelope')
  }
  const decipher = createDecipheriv(
    'aes-256-gcm',
    encryptionKey(),
    Buffer.from(nonceValue, 'base64url'),
  )
  decipher.setAAD(Buffer.from(accountId))
  decipher.setAuthTag(Buffer.from(tagValue, 'base64url'))
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextValue, 'base64url')),
    decipher.final(),
  ]).toString('utf8')
}

export function createRotationActivationTicket(input: {
  accountId: string
  currentKeyHash: string
  replacementKeyHash: string
}) {
  const nonce = randomBytes(12)
  const cipher = createCipheriv(
    'aes-256-gcm',
    encryptionKey('anonymous-recovery-rotation'),
    nonce,
  )
  cipher.setAAD(Buffer.from(input.accountId))
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(input), 'utf8'),
    cipher.final(),
  ])
  return [
    ENCRYPTION_VERSION,
    nonce.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.')
}

export function readRotationActivationTicket(
  ticket: string,
  accountId: string,
) {
  const [version, nonceValue, tagValue, ciphertextValue] = ticket.split('.')
  if (
    version !== ENCRYPTION_VERSION ||
    !nonceValue ||
    !tagValue ||
    !ciphertextValue
  ) {
    throw new Error('Invalid rotation activation ticket')
  }
  const decipher = createDecipheriv(
    'aes-256-gcm',
    encryptionKey('anonymous-recovery-rotation'),
    Buffer.from(nonceValue, 'base64url'),
  )
  decipher.setAAD(Buffer.from(accountId))
  decipher.setAuthTag(Buffer.from(tagValue, 'base64url'))
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextValue, 'base64url')),
    decipher.final(),
  ]).toString('utf8')
  const payload = rotationTicketPayload.parse(JSON.parse(plaintext))
  if (payload.accountId !== accountId) {
    throw new Error('Rotation activation ticket belongs to another account')
  }
  return payload
}

function recoveryUrl(code: string) {
  return `${webOrigins[0]}/auth/recover#code=${encodeURIComponent(code)}`
}

function requireAnonymousSession(ctx: {
  context: { session: { user: Record<string, unknown> } }
}) {
  const user = ctx.context.session.user
  if (user.isAnonymous !== true) {
    throw new APIError('FORBIDDEN', {
      message: 'Anonymous account required.',
      code: 'ANONYMOUS_ACCOUNT_REQUIRED',
    })
  }
  return user as typeof user & { id: string; name: string; isAnonymous: true }
}

function enforceRateLimit(
  ctx: { request?: Request; setHeader(name: string, value: string): void },
  limiter: FixedWindowLimiter,
  policy: string,
) {
  const ip = resolveClientIp(ctx.request?.headers ?? new Headers(), {
    trustProxy: env.TRUST_PROXY,
  })
  const decision = limiter.hit(ip)
  if (decision.allowed) return
  logRateLimitExceeded({
    policy,
    identity: ip,
    retryAfterSeconds: decision.retryAfterSeconds,
  })
  ctx.setHeader('Retry-After', String(decision.retryAfterSeconds))
  throw new APIError('TOO_MANY_REQUESTS', {
    message: 'Too many attempts. Please try again later.',
    code: 'RECOVERY_RATE_LIMITED',
  })
}

function noStore(ctx: { setHeader(name: string, value: string): void }) {
  ctx.setHeader('Cache-Control', 'no-store')
  ctx.setHeader('Pragma', 'no-cache')
}

export function anonymousRecovery() {
  return {
    id: 'spliit-anonymous-recovery',
    endpoints: {
      anonymousRecoveryStatus: createAuthEndpoint(
        '/anonymous-recovery/status',
        { method: 'GET', use: [sessionMiddleware] },
        async (ctx) => {
          noStore(ctx)
          const user = requireAnonymousSession(ctx)
          const credential =
            await prisma.anonymousRecoveryCredential.findUnique({
              where: { accountId: user.id },
              select: {
                acknowledgedAt: true,
                onboardingCompletedAt: true,
                pendingKeyCiphertext: true,
              },
            })
          return ctx.json({
            isAnonymous: true,
            hasRecoveryKey: credential != null,
            acknowledged: credential?.acknowledgedAt != null,
            onboardingCompleted: credential?.onboardingCompletedAt != null,
            canResumeSetup: credential?.pendingKeyCiphertext != null,
          })
        },
      ),
      anonymousRecoverySetup: createAuthEndpoint(
        '/anonymous-recovery/setup',
        { method: 'POST', use: [sessionMiddleware] },
        async (ctx) => {
          noStore(ctx)
          const user = requireAnonymousSession(ctx)
          const generated = generateAnonymousRecoveryKey()
          const credential = await prisma.anonymousRecoveryCredential.upsert({
            where: { accountId: user.id },
            create: {
              accountId: user.id,
              keyHash: hashAnonymousRecoveryKey(generated),
              pendingKeyCiphertext: encryptPendingRecoveryKey(
                generated,
                user.id,
              ),
            },
            update: {},
          })
          if (credential.acknowledgedAt || !credential.pendingKeyCiphertext) {
            return ctx.json(
              { code: 'RECOVERY_KEY_ALREADY_ACKNOWLEDGED' },
              { status: 409 },
            )
          }
          try {
            const code = decryptPendingRecoveryKey(
              credential.pendingKeyCiphertext,
              user.id,
            )
            return ctx.json({ code, recoveryUrl: recoveryUrl(code) })
          } catch {
            return ctx.json(
              { code: 'PENDING_RECOVERY_KEY_UNAVAILABLE' },
              { status: 409 },
            )
          }
        },
      ),
      acknowledgeAnonymousRecovery: createAuthEndpoint(
        '/anonymous-recovery/acknowledge',
        {
          method: 'POST',
          use: [sessionMiddleware],
          body: acknowledgeBody,
        },
        async (ctx) => {
          noStore(ctx)
          const user = requireAnonymousSession(ctx)
          const now = new Date()
          await prisma.$transaction(async (tx) => {
            const credential = await tx.anonymousRecoveryCredential.findUnique({
              where: { accountId: user.id },
            })
            if (!credential?.pendingKeyCiphertext) {
              throw new APIError('CONFLICT', {
                message: 'A pending recovery key is required.',
                code: 'PENDING_RECOVERY_KEY_REQUIRED',
              })
            }
            await tx.anonymousRecoveryCredential.update({
              where: { accountId: user.id },
              data: {
                pendingKeyCiphertext: null,
                acknowledgedAt: now,
                onboardingCompletedAt: credential.onboardingCompletedAt ?? now,
              },
            })
          })
          invalidateAccountCache(user.id)
          return ctx.json({ success: true })
        },
      ),
      rotateAnonymousRecovery: createAuthEndpoint(
        '/anonymous-recovery/rotate',
        { method: 'POST', use: [sessionMiddleware], body: rotateBody },
        async (ctx) => {
          noStore(ctx)
          enforceRateLimit(ctx, rotationLimiter, 'anonymous-recovery-rotate')
          const user = requireAnonymousSession(ctx)
          const credential =
            await prisma.anonymousRecoveryCredential.findUnique({
              where: { accountId: user.id },
              select: {
                keyHash: true,
                acknowledgedAt: true,
                onboardingCompletedAt: true,
                pendingKeyCiphertext: true,
              },
            })
          if (
            !credential?.acknowledgedAt ||
            !credential.onboardingCompletedAt ||
            credential.pendingKeyCiphertext
          ) {
            throw new APIError('CONFLICT', {
              message: 'The recovery key is not ready.',
              code: 'RECOVERY_KEY_NOT_READY',
            })
          }
          const code = generateAnonymousRecoveryKey()
          const activationTicket = createRotationActivationTicket({
            accountId: user.id,
            currentKeyHash: credential.keyHash,
            replacementKeyHash: hashAnonymousRecoveryKey(code),
          })
          return ctx.json({
            recoveryUrl: recoveryUrl(code),
            activationTicket,
          })
        },
      ),
      activateAnonymousRecoveryRotation: createAuthEndpoint(
        '/anonymous-recovery/rotate/activate',
        {
          method: 'POST',
          use: [sessionMiddleware],
          body: activateRotationBody,
        },
        async (ctx) => {
          noStore(ctx)
          const user = requireAnonymousSession(ctx)
          let ticket: z.infer<typeof rotationTicketPayload>
          try {
            ticket = readRotationActivationTicket(
              ctx.body.activationTicket,
              user.id,
            )
          } catch {
            throw new APIError('BAD_REQUEST', {
              message: 'The recovery-link replacement is invalid.',
              code: 'INVALID_ROTATION_TICKET',
            })
          }

          const updated = await prisma.anonymousRecoveryCredential.updateMany({
            where: {
              accountId: user.id,
              keyHash: ticket.currentKeyHash,
              acknowledgedAt: { not: null },
              onboardingCompletedAt: { not: null },
              pendingKeyCiphertext: null,
            },
            data: { keyHash: ticket.replacementKeyHash },
          })
          if (updated.count === 1) {
            return ctx.json({ success: true })
          }

          const current = await prisma.anonymousRecoveryCredential.findUnique({
            where: { accountId: user.id },
            select: { keyHash: true },
          })
          if (current?.keyHash === ticket.replacementKeyHash) {
            return ctx.json({ success: true })
          }
          throw new APIError('CONFLICT', {
            message: 'The recovery link has changed since replacement began.',
            code: 'ROTATION_TICKET_STALE',
          })
        },
      ),
      replacePendingAnonymousRecovery: createAuthEndpoint(
        '/anonymous-recovery/setup/replace',
        { method: 'POST', use: [sessionMiddleware], body: rotateBody },
        async (ctx) => {
          noStore(ctx)
          enforceRateLimit(
            ctx,
            rotationLimiter,
            'anonymous-recovery-setup-replace',
          )
          const user = requireAnonymousSession(ctx)
          const code = generateAnonymousRecoveryKey()
          const updated = await prisma.anonymousRecoveryCredential.updateMany({
            where: { accountId: user.id, acknowledgedAt: null },
            data: {
              keyHash: hashAnonymousRecoveryKey(code),
              pendingKeyCiphertext: encryptPendingRecoveryKey(code, user.id),
            },
          })
          if (updated.count !== 1) {
            throw new APIError('CONFLICT', {
              message: 'The recovery key is not ready.',
              code: 'RECOVERY_KEY_NOT_READY',
            })
          }
          return ctx.json({ code, recoveryUrl: recoveryUrl(code) })
        },
      ),
      signInAnonymousRecovery: createAuthEndpoint(
        '/sign-in/anonymous-recovery',
        { method: 'POST', body: recoveryBody },
        async (ctx) => {
          noStore(ctx)
          enforceRateLimit(ctx, recoveryLimiter, 'anonymous-recovery-sign-in')
          const code = ctx.body.code.trim()
          const hasValidFormat = RECOVERY_KEY_PATTERN.test(code)
          const credential =
            await prisma.anonymousRecoveryCredential.findUnique({
              where: { keyHash: hashAnonymousRecoveryKey(code) },
              include: { account: true },
            })
          if (
            !hasValidFormat ||
            !credential?.acknowledgedAt ||
            !credential.onboardingCompletedAt ||
            !credential.account.isAnonymous
          ) {
            return ctx.json({ code: 'INVALID_RECOVERY_KEY' }, { status: 400 })
          }

          const current = await getSessionFromCtx(ctx, { disableRefresh: true })
          if (current?.user.id === credential.accountId) {
            return ctx.json({
              success: true,
              user: credential.account,
              alreadySignedIn: true,
            })
          }
          if (current && !ctx.body.replaceCurrentSession) {
            return ctx.json(
              {
                code: 'ANONYMOUS_RECOVERY_ACCOUNT_CONFLICT',
                displayName: credential.account.name,
              },
              { status: 409 },
            )
          }

          const session = await ctx.context.internalAdapter.createSession(
            credential.accountId,
          )
          if (!session) {
            throw new APIError('INTERNAL_SERVER_ERROR', {
              message: 'Could not create session.',
              code: 'COULD_NOT_CREATE_SESSION',
            })
          }
          await setSessionCookie(ctx, {
            session,
            user: credential.account,
          })
          return ctx.json({ success: true, user: credential.account })
        },
      ),
    },
  }
}
