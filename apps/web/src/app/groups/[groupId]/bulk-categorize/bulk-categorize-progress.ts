export type BulkCategorizationProgressRun = {
  status: string
  candidateTotal: number
  currentMatches: number
  rerunCandidates?: { uncertain?: number }
}

export type BulkCategorizationProgress = {
  categorized: number
  total: number
  percentage: number
}

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value))

/**
 * Returns cumulative categorized matches for the current run journey.
 * Low-strength automatic matches are eligible for another pass and do not count
 * until they are upgraded; confirmed calibration choices do count.
 */
export function getBulkCategorizationProgress(
  run: BulkCategorizationProgressRun,
): BulkCategorizationProgress | null {
  if (
    run.candidateTotal <= 0 ||
    !['QUEUED', 'PROCESSING', 'QUEUED_RERUN', 'RERUNNING'].includes(run.status)
  )
    return null

  const total = run.candidateTotal
  const lowStrengthMatches = Math.max(0, run.rerunCandidates?.uncertain ?? 0)
  const categorized = clamp(run.currentMatches - lowStrengthMatches, 0, total)

  return {
    categorized,
    total,
    percentage: Math.floor((100 * categorized) / total),
  }
}
