/**
 * Member registry for group importers.
 *
 * Every tabular parser registers participants in first-appearance order with
 * ids like `splitwise-participant-0`; the only differences were the id prefix.
 * This is the single implementation — pure, no Effect.
 *
 * Matching is case-insensitive by default (Alice and ALICE are one
 * participant), which matches splitwise/tricount/settleup/spliit behavior.
 * Cospend is the exception: upstream member names are case-sensitive, so it
 * passes `{ caseSensitive: true }`.
 */

import type { NormalizedSource } from './types'

export type MemberRegistryOptions = {
  /** Default false. True keeps `Alex` and `alex` as separate members. */
  caseSensitive?: boolean
}

export type MemberRegistry = {
  /** Register a name; returns the stable source id. */
  register: (name: string) => string
  /** Existing id for a name, or undefined when not registered. */
  idOf: (name: string) => string | undefined
  /** Participants in first-appearance order. */
  all: () => NormalizedSource['participants']
}

export function createMemberRegistry(
  idPrefix: string,
  options?: MemberRegistryOptions,
): MemberRegistry {
  const caseSensitive = options?.caseSensitive ?? false
  const keyOf = (name: string): string =>
    caseSensitive ? name : name.toLowerCase()
  const participants: NormalizedSource['participants'] = []
  const nameToSourceId = new Map<string, string>()
  return {
    register: (name: string): string => {
      const existing = nameToSourceId.get(keyOf(name))
      if (existing) return existing
      const sourceId = `${idPrefix}-${participants.length}`
      nameToSourceId.set(keyOf(name), sourceId)
      participants.push({ sourceId, sourceName: name })
      return sourceId
    },
    idOf: (name: string): string | undefined => nameToSourceId.get(keyOf(name)),
    all: () => participants,
  }
}
