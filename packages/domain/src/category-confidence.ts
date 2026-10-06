export type CategoryConfidenceBand = 'none' | 'low' | 'medium' | 'high'

/**
 * Relative strength above an engine's acceptance floor, not a calibrated
 * probability.
 */
export function categoryConfidenceBand(
  score: number | null | undefined,
  floor: number,
): CategoryConfidenceBand {
  if (score == null || !Number.isFinite(score) || !Number.isFinite(floor))
    return 'none'
  if (score < floor) return 'none'
  if (floor >= 1) return 'high'
  const fraction = (score - floor) / (1 - floor)
  if (fraction < 1 / 3) return 'low'
  if (fraction < 2 / 3) return 'medium'
  return 'high'
}
