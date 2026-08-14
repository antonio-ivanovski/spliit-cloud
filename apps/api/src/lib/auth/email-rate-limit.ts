import { APIError } from 'better-auth/api'

import {
  FixedWindowLimiter,
  hashRateLimitIdentity,
  logRateLimitExceeded,
} from '../rate-limit'

const authEmailRecipientLimiter = new FixedWindowLimiter({
  limit: 10,
  windowMs: 60 * 60 * 1000,
})

export function enforceAuthEmailRecipientLimit(
  email: string,
  path: string,
): void {
  const normalizedEmail = email.trim().toLowerCase()
  const decision = authEmailRecipientLimiter.hit(
    hashRateLimitIdentity(normalizedEmail),
  )
  if (decision.allowed) return

  logRateLimitExceeded({
    policy: 'auth-email-recipient',
    identity: normalizedEmail,
    retryAfterSeconds: decision.retryAfterSeconds,
    path,
  })
  throw new APIError(
    'TOO_MANY_REQUESTS',
    {
      message: 'Too many email requests. Please try again later.',
      code: 'EMAIL_RATE_LIMIT_EXCEEDED',
    },
    { 'Retry-After': String(decision.retryAfterSeconds) },
  )
}
