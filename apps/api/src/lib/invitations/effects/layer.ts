import { Effect, Layer } from 'effect'

import { InvitationRepository } from './repository'
import { InviteLiveTokens, type InviteTokens } from './tokens'

/**
 * Promise compatibility boundary; domain failures retain their tags for the
 * caller.
 */
export function runInviteEffect<A, E>(
  effect: Effect.Effect<A, E, InvitationRepository | InviteTokens>,
): Promise<A> {
  const live = Layer.mergeAll(InvitationRepository.layer, InviteLiveTokens)
  return Effect.runPromise(Effect.provide(effect, live))
}
