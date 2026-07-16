import type { Reimbursement } from '@/lib/balances'

export type SettlementDirection = 'pay' | 'receive'

export type SettlementGroup = {
  direction: SettlementDirection
  participantId: string
  legs: Reimbursement[]
}

export function settlementLegKey(leg: Reimbursement): string {
  return `${leg.from}:${leg.to}`
}

export function buildSettlementGroups(
  reimbursements: Reimbursement[],
  participantIds: string[],
  direction: SettlementDirection,
): SettlementGroup[] {
  const legsByParticipant = new Map<string, Reimbursement[]>()

  for (const leg of reimbursements) {
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

export function sumSettlementLegs(legs: Reimbursement[]): number {
  return legs.reduce((sum, leg) => sum + leg.amount, 0)
}
