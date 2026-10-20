import { Schema } from 'effect'

/**
 * The public vocabulary of terminal link states. Single source consumed by the
 * preview output schema, so the domain's wording and the API contract cannot
 * drift.
 */
export const InviteEndedReasons = [
  'revoked',
  'declined',
  'accepted',
  'expired',
  'full',
  'unknown',
] as const

export type InviteEndedReason = (typeof InviteEndedReasons)[number]

/** The invitation does not exist, or is not visible to the caller. */
export class InviteNotFoundError extends Schema.TaggedError<InviteNotFoundError>()(
  'InviteNotFoundError',
  { message: Schema.String },
) {}

/** The caller may not perform this operation on this invitation. */
export class InviteForbiddenError extends Schema.TaggedError<InviteForbiddenError>()(
  'InviteForbiddenError',
  { message: Schema.String },
) {}

/** The request failed domain validation (bad limits, bad delivery, …). */
export class InviteValidationError extends Schema.TaggedError<InviteValidationError>()(
  'InviteValidationError',
  { message: Schema.String },
) {}

/** The request conflicts with the current state (a live QR session, …). */
export class InviteConflictError extends Schema.TaggedError<InviteConflictError>()(
  'InviteConflictError',
  { message: Schema.String },
) {}

/** Too many joins at once — the per-group velocity brake tripped. */
export class InviteRateLimitedError extends Schema.TaggedError<InviteRateLimitedError>()(
  'InviteRateLimitedError',
  { message: Schema.String, retryAfterSeconds: Schema.Number },
) {}

/**
 * The link is dead: revoked, declined, used up, expired, or full. `isShared`
 * selects the wording (a shared link asks for a new link, a QR session asks the
 * host for a new code).
 */
export class InviteLinkEndedError extends Schema.TaggedError<InviteLinkEndedError>()(
  'InviteLinkEndedError',
  { reason: Schema.Literals(InviteEndedReasons), isShared: Schema.Boolean },
) {}

/** The account is already an active member of the group. */
export class InviteAlreadyMemberError extends Schema.TaggedError<InviteAlreadyMemberError>()(
  'InviteAlreadyMemberError',
  { message: Schema.String },
) {}

/** The account was removed or suspended and cannot rejoin through a link. */
export class InviteRejoinBlockedError extends Schema.TaggedError<InviteRejoinBlockedError>()(
  'InviteRejoinBlockedError',
  { message: Schema.String },
) {}

/** A friend ledger already exists for this account pair. */
export class InviteDuplicateFriendLedgerError extends Schema.TaggedError<InviteDuplicateFriendLedgerError>()(
  'InviteDuplicateFriendLedgerError',
  { message: Schema.String },
) {}

/** Every failure the invite domain can produce. */
export type InviteError =
  | InviteNotFoundError
  | InviteForbiddenError
  | InviteValidationError
  | InviteConflictError
  | InviteRateLimitedError
  | InviteLinkEndedError
  | InviteAlreadyMemberError
  | InviteRejoinBlockedError
  | InviteDuplicateFriendLedgerError

/** True when the failure is one of the tagged invite-domain errors. */
export function isInviteError(cause: unknown): cause is InviteError {
  return (
    cause instanceof InviteNotFoundError ||
    cause instanceof InviteForbiddenError ||
    cause instanceof InviteValidationError ||
    cause instanceof InviteConflictError ||
    cause instanceof InviteRateLimitedError ||
    cause instanceof InviteLinkEndedError ||
    cause instanceof InviteAlreadyMemberError ||
    cause instanceof InviteRejoinBlockedError ||
    cause instanceof InviteDuplicateFriendLedgerError
  )
}

/**
 * The user-facing message for a dead link. One place, so the accept error, the
 * preview, and the banner never disagree about why a link stopped working.
 */
export function inviteLinkEndedMessage(args: {
  reason: InviteEndedReason
  isShared: boolean
}): string {
  switch (args.reason) {
    case 'expired':
      return 'This invitation link has expired.'
    case 'full':
      return args.isShared
        ? 'This invitation link has reached its join limit. Ask a group member to share a new one.'
        : 'This QR session is full. Ask the host to show a new code.'
    case 'revoked':
      return 'This invitation link was revoked by an admin.'
    case 'declined':
      return 'This invitation link was declined.'
    case 'accepted':
      return 'This invitation link has already been used.'
    case 'unknown':
      return 'This invitation link is no longer valid.'
  }
}

/** Compatibility for the imperative transaction bodies; still a domain failure. */
export class InvitationError extends InviteValidationError {
  constructor(message: string) {
    super({ message })
  }
}
