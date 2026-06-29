import type { NormalizedSourceParticipant } from './types'

export type DestinationParticipant = {
  id: string
  name: string
  pending: boolean
  unlinked: boolean
}

export type ParticipantMappingMode =
  | 'LINK_ACCOUNT'
  | 'INVITE_BY_EMAIL'
  | 'INVITE_BY_LINK'
  | 'UNLINKED_PARTICIPANT'
  | 'LINK_EXISTING_PARTICIPANT'

export type ParticipantMappingState = {
  key: string
  source: NormalizedSourceParticipant
  mode: ParticipantMappingMode
  linkedAccountId?: string
  inviteEmail?: string
  existingLedgerParticipantId?: string
}

export function substringsOverlap(a: string, b: string): boolean {
  const aLower = a.trim().toLowerCase()
  const bLower = b.trim().toLowerCase()
  if (!aLower || !bLower) return false
  return aLower.includes(bLower) || bLower.includes(aLower)
}

export function findBestNameMatch(
  sourceName: string,
  candidates: DestinationParticipant[],
): DestinationParticipant | null {
  const source = sourceName.toLowerCase()
  if (!source) return null

  for (const c of candidates) {
    if (c.name.toLowerCase() === source) return c
  }

  let best: DestinationParticipant | null = null
  let bestScore = -1
  for (const c of candidates) {
    const cLower = c.name.toLowerCase()
    if (cLower.includes(source) || source.includes(cLower)) {
      const score = Math.min(source.length, cLower.length)
      if (score > bestScore) {
        best = c
        bestScore = score
      }
    }
  }
  return best
}

export function applyAutoMatch(
  participants: ParticipantMappingState[],
  destinationParticipants: DestinationParticipant[],
): ParticipantMappingState[] {
  let changed = false
  const next = participants.map((p, i) => {
    if (i === 0 || p.mode !== 'INVITE_BY_EMAIL') return p
    const match = findBestNameMatch(
      p.source.sourceName,
      destinationParticipants,
    )
    if (!match) return p
    changed = true
    return {
      ...p,
      mode: 'LINK_EXISTING_PARTICIPANT' as const,
      existingLedgerParticipantId: match.id,
      inviteEmail: undefined,
      linkedAccountId: undefined,
    }
  })
  return changed ? next : participants
}

export function findImportConflicts(
  participants: ParticipantMappingState[],
  destinationParticipants?: DestinationParticipant[],
): Map<string, string> {
  const conflicts = new Map<string, string>()

  const linkExistingRows = participants.filter(
    (p) =>
      p.mode === 'LINK_EXISTING_PARTICIPANT' && !!p.existingLedgerParticipantId,
  )

  const byLp = new Map<string, ParticipantMappingState[]>()
  for (const row of linkExistingRows) {
    const list = byLp.get(row.existingLedgerParticipantId!) ?? []
    list.push(row)
    byLp.set(row.existingLedgerParticipantId!, list)
  }
  for (const rows of byLp.values()) {
    if (rows.length < 2) continue
    for (const row of rows) {
      if (!conflicts.has(row.key)) {
        conflicts.set(
          row.key,
          'Two source rows are mapped to the same existing member.',
        )
      }
    }
  }

  if (destinationParticipants) {
    const destById = new Map(destinationParticipants.map((d) => [d.id, d]))

    for (const row of participants) {
      if (row.mode !== 'INVITE_BY_EMAIL') continue
      const emailRaw = row.inviteEmail?.trim()
      if (!emailRaw) continue
      const email = emailRaw.toLowerCase()
      for (const other of linkExistingRows) {
        if (other.key === row.key) continue
        const dest = destById.get(other.existingLedgerParticipantId!)
        if (!dest) continue
        const name = dest.name.trim().toLowerCase()
        if (!name) continue
        if (!substringsOverlap(email, name)) continue
        conflicts.set(
          row.key,
          dest.pending
            ? `You're inviting ${emailRaw} but they're already a pending invite; link to them instead.`
            : `You're inviting ${emailRaw} but they're already a member of this group; link to them instead.`,
        )
        break
      }
    }

    for (let i = 0; i < linkExistingRows.length; i++) {
      for (let j = i + 1; j < linkExistingRows.length; j++) {
        const a = linkExistingRows[i]
        const b = linkExistingRows[j]
        if (a.existingLedgerParticipantId === b.existingLedgerParticipantId)
          continue
        const destA = destById.get(a.existingLedgerParticipantId!)
        const destB = destById.get(b.existingLedgerParticipantId!)
        if (!destA || !destB) continue
        if (destA.name.trim().length < 2 || destB.name.trim().length < 2)
          continue
        if (!substringsOverlap(destA.name, destB.name)) continue
        if (!conflicts.has(a.key)) {
          conflicts.set(
            a.key,
            'Two existing members look like the same person — pick one.',
          )
        }
        if (!conflicts.has(b.key)) {
          conflicts.set(
            b.key,
            'Two existing members look like the same person — pick one.',
          )
        }
      }
    }
  }

  return conflicts
}
