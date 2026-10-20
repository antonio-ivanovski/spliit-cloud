import { Cause, Effect, Exit, Result, Schema } from 'effect'

import { InviteValidationError } from './errors'

/* Shared-link limits, one source of truth.
 *
 * These bounds live here (not in the request schemas) because several
 * surfaces must enforce the same values: the link-creation form, the shared
 * manage dialog, the tRPC inputs, and the idempotency discriminator. The
 * tRPC inputs stay zod (their transport contract), the domain validation
 * below is the authority every write path runs through.
 */

import {
  SHARED_LINK_MIN_USES,
  SHARED_LINK_MAX_USES_LIMIT,
  SHARED_LINK_MAX_TTL_MS,
  SHARED_LINK_MIN_TTL_MS,
  SHARED_LINK_LABEL_MAX_LENGTH,
} from '@spliit/domain/invitations'
export {
  SHARED_LINK_DEFAULT_MAX_USES,
  SHARED_LINK_DEFAULT_TTL_MS,
  SHARED_LINK_MIN_USES,
  SHARED_LINK_MAX_USES_LIMIT,
  SHARED_LINK_MAX_TTL_MS,
  SHARED_LINK_MIN_TTL_MS,
  SHARED_LINK_MAX_PENDING_PER_GROUP,
  SHARED_LINK_LABEL_MAX_LENGTH,
} from '@spliit/domain/invitations'

/** A member-facing label: at most 40 characters. */
export const SharedLinkLabelSchema = Schema.String.check(
  Schema.isMaxLength(SHARED_LINK_LABEL_MAX_LENGTH),
)

/**
 * A join cap: an integer between 2 and 1000. The schema validates concrete
 * values; `null` (unlimited) is modelled by omission, not by the schema.
 */
export const SharedLinkMaxUsesSchema = Schema.Int.check(
  Schema.isBetween({
    minimum: SHARED_LINK_MIN_USES,
    maximum: SHARED_LINK_MAX_USES_LIMIT,
  }),
)

/** An expiry duration in milliseconds: between 1 hour and 1 year. */
export const SharedLinkTtlMsSchema = Schema.Int.check(
  Schema.isBetween({
    minimum: SHARED_LINK_MIN_TTL_MS,
    maximum: SHARED_LINK_MAX_TTL_MS,
  }),
)

export type SharedLinkLimitsInput = {
  label?: string | null
  maxUses?: number | null
  ttlMs?: number | null
}

export type SharedLinkLimits = {
  /** Normalised label (`null` = none). Empty or whitespace-only means none. */
  label: string | null
  /** Normalised join cap (`null` = unlimited). */
  maxUses: number | null
  /** Normalised expiry duration (`null` = never expires). */
  ttlMs: number | null
}

/**
 * Validate shared-link limits and normalise them. Every provided field is
 * validated against the single shared schema above; absent fields normalise to
 * `null`.
 */
export const validateSharedLinkLimitsEffect = Effect.fnUntraced(function* (
  input: SharedLinkLimitsInput,
): Effect.fn.Return<SharedLinkLimits, InviteValidationError> {
  const label = input.label?.trim() || null
  if (label !== null && !Schema.is(SharedLinkLabelSchema)(label)) {
    return yield* new InviteValidationError({
      message: `Link label must be at most ${SHARED_LINK_LABEL_MAX_LENGTH} characters.`,
    })
  }
  const maxUses = input.maxUses ?? null
  if (maxUses !== null && !Schema.is(SharedLinkMaxUsesSchema)(maxUses)) {
    return yield* new InviteValidationError({
      message: `Join limit must be between ${SHARED_LINK_MIN_USES} and ${SHARED_LINK_MAX_USES_LIMIT}, or unlimited.`,
    })
  }
  const ttlMs = input.ttlMs ?? null
  if (ttlMs !== null && !Schema.is(SharedLinkTtlMsSchema)(ttlMs)) {
    return yield* new InviteValidationError({
      message: 'Expiry must be between 1 hour and 1 year.',
    })
  }
  return { label, maxUses, ttlMs }
})

/**
 * Synchronous variant for imperative call sites (the create path and the
 * idempotency discriminator). Runs the same Effect program and rethrows its
 * tagged failure, so sync and async callers can never diverge.
 */
export function validateSharedLinkLimits(
  input: SharedLinkLimitsInput,
): SharedLinkLimits {
  const exit = Effect.runSyncExit(validateSharedLinkLimitsEffect(input))
  return Exit.match(exit, {
    onSuccess: (limits) => limits,
    onFailure: (cause) => {
      const found = Cause.findError(cause)
      if (Result.isSuccess(found)) throw found.success
      throw Cause.squash(cause)
    },
  })
}
