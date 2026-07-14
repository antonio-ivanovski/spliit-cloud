import type { AccountIdentity } from '@/lib/account'

/** The palette used by participant segment bars and their legends. */
export const PARTICIPANT_SEGMENT_COLORS = [
  'bg-sky-500',
  'bg-amber-500',
  'bg-emerald-500',
  'bg-violet-500',
  'bg-rose-500',
  'bg-cyan-500',
] as const

export type ParticipantSegmentParticipant = {
  id: string
  name: string
  account?: AccountIdentity | null
}

/**
 * A settlement (or split) leg represented by one segment in the bar.
 * `colorIndex` lets callers keep colors stable when the visible row order
 * differs from the group's participant order.
 */
export type ParticipantSegment = {
  id: string
  name: string
  amount: number
  participant?: ParticipantSegmentParticipant
  colorClass?: string
  colorIndex?: number
}

export function participantSegmentColor(
  row: Pick<ParticipantSegment, 'colorClass' | 'colorIndex'>,
  fallbackIndex: number,
): string {
  if (row.colorClass) return row.colorClass
  const index = row.colorIndex ?? fallbackIndex
  const normalizedIndex =
    ((index % PARTICIPANT_SEGMENT_COLORS.length) +
      PARTICIPANT_SEGMENT_COLORS.length) %
    PARTICIPANT_SEGMENT_COLORS.length
  return PARTICIPANT_SEGMENT_COLORS[normalizedIndex]
}
