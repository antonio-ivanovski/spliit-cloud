import {
  getSuggestedSettlements,
  type Balances,
  type SuggestedSettlement,
} from './balances'

/** A persisted subgroup as consumed by the settlement projection. */
export type SubgroupDefinition = {
  id: string
  name: string
  memberIds: string[]
}

export type SettlementUnitKind = 'subgroup' | 'participant'

export type SettlementUnit = {
  kind: SettlementUnitKind
  id: string
  name: string
  memberIds: string[]
  total: number
}

export type SettlementParty = Pick<SettlementUnit, 'kind' | 'id'>

export type SubgroupSettlementLeg = {
  from: SettlementParty
  to: SettlementParty
  fromMemberIds: string[]
  toMemberIds: string[]
  amount: number
  payerId: string
  receiverId: string
}

export type IndividualSettlementPolicy =
  | 'standard'
  | 'within-subgroups'
  | 'all-individual'

export type IndividualSettlementPlan = {
  suggestedSettlements: SuggestedSettlement[]
  policy: IndividualSettlementPolicy
}

export type SubgroupSettlementPlan = {
  units: SettlementUnit[]
  legs: SubgroupSettlementLeg[]
  hasInternalBalances: boolean
}

function totalForMembers(balances: Balances, memberIds: string[]) {
  return memberIds.reduce(
    (total, memberId) => total + (balances[memberId]?.total ?? 0),
    0,
  )
}

function normalizeSubgroups(
  subgroups: SubgroupDefinition[],
  participantIds: Iterable<string>,
): SubgroupDefinition[] {
  const participantIdSet = new Set(participantIds)
  const used = new Set<string>()

  return subgroups.flatMap((subgroup) => {
    const memberIds = [...new Set(subgroup.memberIds)].filter(
      (memberId) => participantIdSet.has(memberId) && !used.has(memberId),
    )
    if (memberIds.length < 2) return []
    memberIds.forEach((memberId) => used.add(memberId))
    return [{ id: subgroup.id, name: subgroup.name, memberIds }]
  })
}

function partyKey(party: SettlementParty) {
  return `${party.kind}:${party.id}`
}

function resolveRepresentativeMembers(
  memberIds: string[],
  projectedBalances: Map<string, number>,
  participantOrder: Map<string, number>,
) {
  const ordered = [...memberIds].sort(
    (a, b) =>
      (projectedBalances.get(a) ?? 0) - (projectedBalances.get(b) ?? 0) ||
      (participantOrder.get(a) ?? 0) - (participantOrder.get(b) ?? 0),
  )
  return ordered[0]
}

function resolveRepresentativeReceiver(
  memberIds: string[],
  projectedBalances: Map<string, number>,
  participantOrder: Map<string, number>,
) {
  const ordered = [...memberIds].sort(
    (a, b) =>
      (projectedBalances.get(b) ?? 0) - (projectedBalances.get(a) ?? 0) ||
      (participantOrder.get(a) ?? 0) - (participantOrder.get(b) ?? 0),
  )
  return ordered[0]
}

/**
 * Build settlement legs after replacing each valid subgroup with one virtual
 * unit. Ungrouped participants remain one-person units. Representative payer
 * and receiver identities are resolved in the same deterministic projection so
 * the UI and settlement form use the exact same people.
 */
export function getSubgroupSettlementPlan(
  balances: Balances,
  participantIds: Iterable<string>,
  subgroups: SubgroupDefinition[],
): SubgroupSettlementPlan {
  const allParticipantIds = [
    ...new Set([...participantIds, ...Object.keys(balances)]),
  ]
  const normalizedSubgroups = normalizeSubgroups(subgroups, allParticipantIds)
  const assigned = new Set(
    normalizedSubgroups.flatMap((subgroup) => subgroup.memberIds),
  )
  const units: SettlementUnit[] = [
    ...normalizedSubgroups.map((subgroup) => ({
      kind: 'subgroup' as const,
      id: subgroup.id,
      name: subgroup.name,
      memberIds: subgroup.memberIds,
      total: totalForMembers(balances, subgroup.memberIds),
    })),
    ...allParticipantIds
      .filter((participantId) => !assigned.has(participantId))
      .map((participantId) => ({
        kind: 'participant' as const,
        id: participantId,
        name: participantId,
        memberIds: [participantId],
        total: balances[participantId]?.total ?? 0,
      })),
  ]

  const virtualBalances: Balances = Object.fromEntries(
    units.map((unit) => [
      partyKey(unit),
      { paid: 0, paidFor: 0, total: unit.total },
    ]),
  )
  const participantOrder = new Map(
    allParticipantIds.map((participantId, index) => [participantId, index]),
  )
  const projectedBalances = new Map(
    allParticipantIds.map((participantId) => [
      participantId,
      balances[participantId]?.total ?? 0,
    ]),
  )

  const legs = getSuggestedSettlements(virtualBalances).map(
    (settlement): SubgroupSettlementLeg => {
      const from = units.find((unit) => partyKey(unit) === settlement.from)
      const to = units.find((unit) => partyKey(unit) === settlement.to)
      if (!from || !to) {
        throw new Error('Settlement leg references an unknown virtual unit')
      }

      const payerId = resolveRepresentativeMembers(
        from.memberIds,
        projectedBalances,
        participantOrder,
      )
      const receiverId = resolveRepresentativeReceiver(
        to.memberIds,
        projectedBalances,
        participantOrder,
      )
      projectedBalances.set(
        payerId,
        (projectedBalances.get(payerId) ?? 0) + settlement.amount,
      )
      projectedBalances.set(
        receiverId,
        (projectedBalances.get(receiverId) ?? 0) - settlement.amount,
      )

      return {
        from: { kind: from.kind, id: from.id },
        to: { kind: to.kind, id: to.id },
        fromMemberIds: from.memberIds,
        toMemberIds: to.memberIds,
        amount: settlement.amount,
        payerId,
        receiverId,
      }
    },
  )

  return {
    units,
    legs,
    hasInternalBalances: normalizedSubgroups.some((subgroup) =>
      subgroup.memberIds.some(
        (memberId) => (projectedBalances.get(memberId) ?? 0) !== 0,
      ),
    ),
  }
}

/**
 * Build the individual settlement projection for a group with optional
 * subgroups.
 *
 * When every virtual unit is already balanced, the individual view can settle
 * each subgroup independently. This keeps the suggestions inside the subgroup
 * boundaries without changing the final balances. If any subgroup (or an
 * ungrouped participant) still has a non-zero virtual total, a cross-boundary
 * transfer is mathematically required, so we fall back to the standard
 * group-wide projection.
 */
export function getIndividualSettlementPlan(
  balances: Balances,
  subgroups: SubgroupDefinition[],
  participantIds: Iterable<string> = Object.keys(balances),
): IndividualSettlementPlan {
  const allParticipantIds = [
    ...new Set([...participantIds, ...Object.keys(balances)]),
  ]
  const normalizedSubgroups = normalizeSubgroups(subgroups, allParticipantIds)

  const assigned = new Set(
    normalizedSubgroups.flatMap((subgroup) => subgroup.memberIds),
  )
  const virtualUnits = [
    ...normalizedSubgroups.map((subgroup) => ({
      memberIds: subgroup.memberIds,
      total: totalForMembers(balances, subgroup.memberIds),
    })),
    ...allParticipantIds
      .filter((participantId) => !assigned.has(participantId))
      .map((participantId) => ({
        memberIds: [participantId],
        total: balances[participantId]?.total ?? 0,
      })),
  ]

  if (
    normalizedSubgroups.length > 0 &&
    virtualUnits.every((unit) => unit.total === 0)
  ) {
    const suggestedSettlements = normalizedSubgroups.flatMap((subgroup) =>
      getSuggestedSettlements(
        Object.fromEntries(
          subgroup.memberIds.map((memberId) => [
            memberId,
            balances[memberId] ?? { paid: 0, paidFor: 0, total: 0 },
          ]),
        ),
      ),
    )

    return {
      suggestedSettlements,
      policy: 'within-subgroups',
    }
  }

  return {
    suggestedSettlements: getSuggestedSettlements(balances),
    policy: normalizedSubgroups.length > 0 ? 'all-individual' : 'standard',
  }
}
