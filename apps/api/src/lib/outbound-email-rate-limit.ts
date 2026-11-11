import { isPlaceholderEmail } from './invitations/display'
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
  // Synthetic addresses can never receive mail. Skip without charging either
  // quota so a placeholder invitation does not consume the sender's allowance.
  if (isPlaceholderEmail(options.recipientEmail.trim())) return false

  const senderDecision = senderLimiter.hit(options.senderAccountId)
  if (!senderDecision.allowed) {
    logRateLimitExceeded({
      policy: `${options.policy}-sender`,
      identity: options.senderAccountId,
      retryAfterSeconds: senderDecision.retryAfterSeconds,
    })
    return false
  }

  const normalizedRecipient = options.recipientEmail.trim().toLowerCase()
  const recipientDecision = recipientLimiter.hit(
    hashRateLimitIdentity(normalizedRecipient),
  )
  if (recipientDecision.allowed) return true

  logRateLimitExceeded({
    policy: `${options.policy}-recipient`,
    identity: normalizedRecipient,
    retryAfterSeconds: recipientDecision.retryAfterSeconds,
  })
  return false
}
