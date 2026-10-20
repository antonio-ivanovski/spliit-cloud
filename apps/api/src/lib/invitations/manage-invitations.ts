import { Clock, Effect } from 'effect'

import { runInviteEffect } from './effects/layer'
import { InvitationRepository } from './effects/repository'
import { InviteTokens } from './effects/tokens'
import type {
  updatePendingInvitation as update,
  regenerateLinkInvitation as rotate,
} from './pending-repository'

export type {
  PendingInvitationDelivery,
  UpdatePendingInvitationInput,
  UpdatePendingInvitationResult,
  RegenerateLinkInvitationInput,
  RegenerateLinkInvitationResult,
  GetSharedLinkUrlResult,
} from './pending-repository'
export { validateSharedLinkLimits } from './effects/limits'

type UpdateInput = Parameters<typeof update>[0]
type RotateInput = Parameters<typeof rotate>[0]

export const updatePendingInvitationEffect = Effect.fn(
  'Invitations.updatePending',
)(function* (input: UpdateInput) {
  const repository = yield* InvitationRepository
  const clock = yield* Clock.Clock
  const tokens = yield* InviteTokens
  const token = yield* tokens.generate
  const tokenHash = yield* tokens.hash(token)
  return yield* repository.update(input, {
    now: () => new Date(clock.currentTimeMillisUnsafe()),
    credential: { token, tokenHash },
  })
})
export const updatePendingInvitation = (input: UpdateInput) =>
  runInviteEffect(updatePendingInvitationEffect(input))

export const regenerateLinkInvitationEffect = Effect.fn('Invitations.rotate')(
  function* (input: RotateInput) {
    const repository = yield* InvitationRepository
    const clock = yield* Clock.Clock
    const tokens = yield* InviteTokens
    const token = yield* tokens.generate
    const tokenHash = yield* tokens.hash(token)
    return yield* repository.rotate(input, {
      now: () => new Date(clock.currentTimeMillisUnsafe()),
      credential: { token, tokenHash },
    })
  },
)
export const regenerateLinkInvitation = (input: RotateInput) =>
  runInviteEffect(regenerateLinkInvitationEffect(input))

export const getSharedLinkUrlEffect = Effect.fn('Invitations.copyLink')(
  function* (input: {
    groupId: string
    invitationId: string
    accountId: string
  }) {
    const repository = yield* InvitationRepository
    const clock = yield* Clock.Clock
    return yield* repository.copy(
      input,
      () => new Date(clock.currentTimeMillisUnsafe()),
    )
  },
)
export const getSharedLinkUrl = (input: {
  groupId: string
  invitationId: string
  accountId: string
}) => runInviteEffect(getSharedLinkUrlEffect(input))
