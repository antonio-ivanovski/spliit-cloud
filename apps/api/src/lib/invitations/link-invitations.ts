import { Clock, Effect } from 'effect'

import { runInviteEffect } from './effects/layer'
import { validateSharedLinkLimitsEffect } from './effects/limits'
import { InvitationRepository } from './effects/repository'
import {
  InviteTokens,
  generateLinkToken,
  hashLinkToken,
} from './effects/tokens'
import type { CreateLinkInvitationInput } from './link-repository'

export type {
  CreateLinkInvitationInput,
  CreateLinkInvitationResult,
  LinkInvitationPreview,
  ShareMemberSample,
  QrSessionJoiner,
} from './link-repository'
export {
  LINK_INVITATION_DEFAULT_TTL_MS,
  QR_INVITATION_DEFAULT_TTL_MS,
  QR_SESSION_MAX_USES,
  QR_SESSION_JOINERS_LIMIT,
  listQrSessionJoiners,
} from './link-repository'
export * from '@spliit/domain/invitations'
export { generateLinkToken, hashLinkToken }

export const createLinkInvitationEffect = Effect.fn('Invitations.createLink')(
  function* (input: CreateLinkInvitationInput) {
    const repository = yield* InvitationRepository
    const clock = yield* Clock.Clock
    const tokens = yield* InviteTokens
    const token = input.token ?? (yield* tokens.generate)
    const tokenHash = yield* tokens.hash(token)
    const limits = input.isShared
      ? yield* validateSharedLinkLimitsEffect({
          label: input.label,
          maxUses: input.maxUses,
        })
      : undefined
    return yield* repository.create(
      limits
        ? { ...input, label: limits.label, maxUses: limits.maxUses }
        : input,
      {
        now: () => new Date(clock.currentTimeMillisUnsafe()),
        credential: { token, tokenHash },
      },
    )
  },
)
export const createLinkInvitation = (input: CreateLinkInvitationInput) =>
  runInviteEffect(createLinkInvitationEffect(input))

export const getLinkInvitationPreviewEffect = Effect.fn('Invitations.preview')(
  function* (token: string, options: { includeSharing?: boolean } = {}) {
    const repository = yield* InvitationRepository
    const clock = yield* Clock.Clock
    const tokens = yield* InviteTokens
    const tokenHash = yield* tokens.hash(token)
    return yield* repository.preview(
      tokenHash,
      options,
      () => new Date(clock.currentTimeMillisUnsafe()),
    )
  },
)
export const getLinkInvitationPreview = (
  token: string,
  options: { includeSharing?: boolean } = {},
) => runInviteEffect(getLinkInvitationPreviewEffect(token, options))

export type AcceptLinkInvitationInput = {
  accountId: string
  expectedGroupId?: string
} & ({ token: string } | { tokenHash: string })
export const acceptLinkInvitationEffect = Effect.fn('Invitations.acceptLink')(
  function* (input: AcceptLinkInvitationInput) {
    const repository = yield* InvitationRepository
    const clock = yield* Clock.Clock
    const tokens = yield* InviteTokens
    const tokenHash =
      'tokenHash' in input ? input.tokenHash : yield* tokens.hash(input.token)
    return yield* repository.accept(
      {
        accountId: input.accountId,
        expectedGroupId: input.expectedGroupId,
        tokenHash,
      },
      { now: () => new Date(clock.currentTimeMillisUnsafe()) },
    )
  },
)
export const acceptLinkInvitation = (input: AcceptLinkInvitationInput) =>
  runInviteEffect(acceptLinkInvitationEffect(input))
