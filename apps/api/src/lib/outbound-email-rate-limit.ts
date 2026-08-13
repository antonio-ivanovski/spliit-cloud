import {
  FixedWindowLimiter,
  hashRateLimitIdentity,
  logRateLimitExceeded,
} from './rate-limit'

const senderLimiter = new FixedWindowLimiter({
  limit: 200,
  windowMs: 24 * 60 * 60 * 1000,
})
const recipientLimiter = new FixedWindowLimiter({
  limit: 10,
  windowMs: 24 * 60 * 60 * 1000,
})

/**
 * Best-effort daily brake for emails initiated directly by another user.
 * Callers intentionally suppress delivery on rejection while preserving the
 * underlying invitation/friend-ledger mutation.
 */
export function allowUserGeneratedEmail(options: {
  senderAccountId: string
  recipientEmail: string
  policy: string
}): boolean {
  const senderDecision = senderLimiter.hit(options.senderAccountId)
  const normalizedRecipient = options.recipientEmail.trim().toLowerCase()
  const recipientDecision = recipientLimiter.hit(
    hashRateLimitIdentity(normalizedRecipient),
  )
  if (senderDecision.allowed && recipientDecision.allowed) return true

  const limitedByRecipient = senderDecision.allowed
  const decision = limitedByRecipient ? recipientDecision : senderDecision
  logRateLimitExceeded({
    policy: `${options.policy}-${limitedByRecipient ? 'recipient' : 'sender'}`,
    identity: limitedByRecipient
      ? normalizedRecipient
      : options.senderAccountId,
    retryAfterSeconds: decision.retryAfterSeconds,
  })
  return false
}
