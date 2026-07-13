/** The palette used by participant segment bars and their legends. */
export const PARTICIPANT_SEGMENT_COLORS = [
  // 500 shades – first pass for groups ≤12
  'bg-sky-500',
  'bg-amber-500',
  'bg-emerald-500',
  'bg-violet-500',
  'bg-rose-500',
  'bg-cyan-500',
  'bg-fuchsia-500',
  'bg-indigo-500',
  'bg-teal-500',
  'bg-orange-500',
  'bg-lime-500',
  'bg-blue-500',
  // 300 shades – used when 500-exclusive palette is exhausted
  'bg-sky-300',
  'bg-amber-300',
  'bg-emerald-300',
  'bg-violet-300',
  'bg-rose-300',
  'bg-cyan-300',
  'bg-fuchsia-300',
  'bg-indigo-300',
  'bg-teal-300',
  'bg-orange-300',
  'bg-lime-300',
  'bg-blue-300',
  // 700 shades – used when 500+300 palette is exhausted
  'bg-sky-700',
  'bg-amber-700',
  'bg-emerald-700',
  'bg-violet-700',
  'bg-rose-700',
  'bg-cyan-700',
  'bg-fuchsia-700',
  'bg-indigo-700',
  'bg-teal-700',
  'bg-orange-700',
  'bg-lime-700',
  'bg-blue-700',
] as const

export type ParticipantSegmentColorRow = {
  colorClass?: string
  colorIndex?: number
}

export function participantSegmentColor(
  row: ParticipantSegmentColorRow,
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
