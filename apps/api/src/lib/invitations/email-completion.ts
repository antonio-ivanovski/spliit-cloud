import { Clock, Effect } from 'effect'

import { runInviteEffect } from './effects/layer'
import { InvitationRepository } from './effects/repository'
import type {
  acceptEmailInvitation,
  declineEmailInvitation,
} from './email-repository'

type AcceptInput = Parameters<typeof acceptEmailInvitation>[0]
type DeclineInput = Parameters<typeof declineEmailInvitation>[0]

export const acceptInvitationEffect = Effect.fn('Invitations.acceptEmail')(
  function* (input: AcceptInput) {
    const repository = yield* InvitationRepository
    const clock = yield* Clock.Clock
    return yield* repository.acceptEmail(input, {
      now: () => new Date(clock.currentTimeMillisUnsafe()),
    })
  },
)
export const acceptInvitation = (input: AcceptInput) =>
  runInviteEffect(acceptInvitationEffect(input))

export const declineInvitationEffect = Effect.fn('Invitations.declineEmail')(
  function* (input: DeclineInput) {
    const repository = yield* InvitationRepository
    return yield* repository.declineEmail(input)
  },
)
export const declineInvitation = (input: DeclineInput) =>
  runInviteEffect(declineInvitationEffect(input))
