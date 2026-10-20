import { Context, Effect, Layer } from 'effect'

import * as emails from '../email-repository'
import * as links from '../link-repository'
import * as pending from '../pending-repository'
import { isInviteError, type InviteError } from './errors'

/**
 * Adapt Promise APIs honestly: expected rejections fail, infrastructure faults
 * die.
 */
function invitePromise<A>(
  run: () => Promise<A>,
): Effect.Effect<A, InviteError> {
  return Effect.tryPromise({ try: run, catch: (cause) => cause }).pipe(
    Effect.catch((cause) => {
      if (isInviteError(cause)) return Effect.fail(cause)
      return Effect.die(cause)
    }),
  )
}

const repository = {
  acceptEmail: (...args: Parameters<typeof emails.acceptEmailInvitation>) =>
    invitePromise(() => emails.acceptEmailInvitation(...args)),
  declineEmail: (...args: Parameters<typeof emails.declineEmailInvitation>) =>
    invitePromise(() => emails.declineEmailInvitation(...args)),
  create: (...args: Parameters<typeof links.createLinkInvitation>) =>
    invitePromise(() => links.createLinkInvitation(...args)),
  preview: (...args: Parameters<typeof links.getLinkInvitationPreviewByHash>) =>
    invitePromise(() => links.getLinkInvitationPreviewByHash(...args)),
  accept: (...args: Parameters<typeof links.acceptLinkInvitation>) =>
    invitePromise(() => links.acceptLinkInvitation(...args)),
  update: (...args: Parameters<typeof pending.updatePendingInvitation>) =>
    invitePromise(() => pending.updatePendingInvitation(...args)),
  rotate: (...args: Parameters<typeof pending.regenerateLinkInvitation>) =>
    invitePromise(() => pending.regenerateLinkInvitation(...args)),
  copy: (...args: Parameters<typeof pending.getSharedLinkUrl>) =>
    invitePromise(() => pending.getSharedLinkUrl(...args)),
}

/**
 * Prisma aggregates own their transactions, including activity and notification
 * writes.
 */
export class InvitationRepository extends Context.Service<
  InvitationRepository,
  typeof repository
>()('@spliit/api/invitations/Repository') {
  static readonly layer = Layer.succeed(InvitationRepository, repository)
}
