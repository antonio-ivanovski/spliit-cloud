export type BulkCategorizationProgressRun = {
  status: string
  mode: 'local' | 'system-one'
  candidateTotal: number
  processed: number
  total: number
  fullPassPhase: 'first' | 'second' | 'complete'
  calibration: { confirmed: readonly unknown[] }
}

export type BulkCategorizationProgress = {
  percentage: number
  stageProcessed: number
  stageTotal: number
  overallProcessed: number
  overallTotal: number
  phase: 'first' | 'second' | 'rerun'
}

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value))

/** Calibration is complete work; a System One refinement reserves the last 20%. */
export function getBulkCategorizationProgress(
  run: BulkCategorizationProgressRun,
): BulkCategorizationProgress | null {
  if (
    run.candidateTotal <= 0 ||
    !['QUEUED', 'PROCESSING', 'QUEUED_RERUN', 'RERUNNING'].includes(run.status)
  )
    return null

  const stageTotal = Math.max(0, run.total)
  const stageProcessed = clamp(run.processed, 0, stageTotal)
  const overallTotal = run.candidateTotal

  if (run.status === 'QUEUED_RERUN' || run.status === 'RERUNNING') {
    const overallProcessed = clamp(
      overallTotal - stageTotal + stageProcessed,
      0,
      overallTotal,
    )
    return {
      percentage: Math.floor((100 * overallProcessed) / overallTotal),
      stageProcessed,
      stageTotal,
      overallProcessed,
      overallTotal,
      phase: 'rerun',
    }
  }

  if (run.mode === 'system-one' && run.fullPassPhase === 'second') {
    return {
      percentage:
        stageTotal === 0
          ? 100
          : Math.floor(80 + (20 * stageProcessed) / stageTotal),
      stageProcessed,
      stageTotal,
      overallProcessed: overallTotal,
      overallTotal,
      phase: 'second',
    }
  }

  const overallProcessed = clamp(
    run.calibration.confirmed.length + stageProcessed,
    0,
    overallTotal,
  )
  const firstPassRange = run.mode === 'system-one' ? 80 : 100
  return {
    percentage: Math.floor((firstPassRange * overallProcessed) / overallTotal),
    stageProcessed,
    stageTotal,
    overallProcessed,
    overallTotal,
    phase: 'first',
  }
}
