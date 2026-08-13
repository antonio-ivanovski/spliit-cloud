import type { SuggestedSettlement } from '@/lib/balances'

export type SettlementDirection = 'pay' | 'receive'

export type SettlementGroup = {
  direction: SettlementDirection
  participantId: string
  legs: SuggestedSettlement[]
}

export function settlementLegKey(leg: SuggestedSettlement): string {
  return `${leg.from}:${leg.to}`
}

export function buildSettlementGroups(
  suggestedSettlements: SuggestedSettlement[],
  participantIds: string[],
  direction: SettlementDirection,
): SettlementGroup[] {
  const legsByParticipant = new Map<string, SuggestedSettlement[]>()

  for (const leg of suggestedSettlements) {
    const participantId = direction === 'pay' ? leg.from : leg.to
    const legs = legsByParticipant.get(participantId) ?? []
    legs.push(leg)
    legsByParticipant.set(participantId, legs)
  }

  return participantIds.flatMap((participantId) => {
    const legs = legsByParticipant.get(participantId)
    return legs?.length ? [{ direction, participantId, legs }] : []
  })
}

export function sumSettlementLegs(legs: SuggestedSettlement[]): number {
  return legs.reduce((sum, leg) => sum + leg.amount, 0)
}
