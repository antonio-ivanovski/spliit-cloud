import { TRPCError } from '@trpc/server'

import {
  isInviteError,
  inviteLinkEndedMessage,
} from '../lib/invitations/effects/errors'

/** The only translation from invitation domain failures into transport codes. */
export function mapInviteErrorToTRPC(
  cause: unknown,
  responseHeaders?: Headers,
): never {
  if (!isInviteError(cause)) throw cause
  switch (cause._tag) {
    case 'InviteNotFoundError':
      throw new TRPCError({ code: 'NOT_FOUND', message: cause.message, cause })
    case 'InviteForbiddenError':
      throw new TRPCError({ code: 'FORBIDDEN', message: cause.message, cause })
    case 'InviteConflictError':
      throw new TRPCError({ code: 'CONFLICT', message: cause.message, cause })
    case 'InviteRateLimitedError':
      responseHeaders?.set('Retry-After', String(cause.retryAfterSeconds))
      throw new TRPCError({
        code: 'TOO_MANY_REQUESTS',
        message: cause.message,
        cause,
      })
    case 'InviteLinkEndedError':
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: inviteLinkEndedMessage(cause),
        cause,
      })
    case 'InviteValidationError':
    case 'InviteAlreadyMemberError':
    case 'InviteRejoinBlockedError':
    case 'InviteDuplicateFriendLedgerError':
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: cause.message,
        cause,
      })
  }
}
