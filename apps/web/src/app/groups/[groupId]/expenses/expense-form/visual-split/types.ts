export type VisualSplitParticipant = {
  id: string
  name: string
  pending?: boolean
  account?: { id: string; name?: string | null; image?: string | null } | null
}

export type VisualSplitRow = { participant: string; shares: number }
