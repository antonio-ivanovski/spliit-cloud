import { describe, expect, it } from 'vitest'

import { getBulkCategorizationProgress } from './bulk-categorize-progress'

const progress = (
  overrides: Partial<Parameters<typeof getBulkCategorizationProgress>[0]> = {},
) =>
  getBulkCategorizationProgress({
    status: 'PROCESSING',
    mode: 'local',
    candidateTotal: 100,
    processed: 0,
    total: 100,
    fullPassPhase: 'first',
    calibration: { confirmed: [] },
    ...overrides,
  })

describe('getBulkCategorizationProgress', () => {
  it('tracks processed work even when nothing matches', () => {
    expect(progress({ processed: 30, total: 100 })).toEqual({
      percentage: 30,
      stageProcessed: 30,
      stageTotal: 100,
      overallProcessed: 30,
      overallTotal: 100,
      phase: 'first',
    })
  })

  it('counts confirmed calibration choices as completed work', () => {
    expect(
      progress({
        processed: 10,
        total: 100,
        calibration: { confirmed: [{}, {}, {}] },
      }),
    ).toMatchObject({
      overallProcessed: 13,
      overallTotal: 100,
      percentage: 13,
      phase: 'first',
    })
  })

  it('reserves the last 20 percent for the System One refinement pass', () => {
    const firstPass = progress({
      mode: 'system-one',
      processed: 100,
      total: 100,
      fullPassPhase: 'first',
    })
    expect(firstPass?.percentage).toBe(80)
    expect(firstPass?.overallProcessed).toBe(100)

    const secondPass = progress({
      mode: 'system-one',
      processed: 50,
      total: 100,
      fullPassPhase: 'second',
    })
    expect(secondPass).toEqual({
      percentage: 90,
      stageProcessed: 50,
      stageTotal: 100,
      overallProcessed: 100,
      overallTotal: 100,
      phase: 'second',
    })
  })

  it('keeps already processed work as the baseline for a rerun', () => {
    expect(
      progress({
        status: 'QUEUED_RERUN',
        processed: 5,
        total: 20,
      }),
    ).toMatchObject({
      overallProcessed: 85,
      percentage: 85,
      phase: 'rerun',
    })

    expect(
      progress({
        status: 'RERUNNING',
        processed: 6,
        total: 20,
      }),
    ).toMatchObject({
      overallProcessed: 86,
      percentage: 86,
      phase: 'rerun',
    })
  })

  it('clamps processed counts to the stage and run size', () => {
    expect(progress({ candidateTotal: 10, processed: 20, total: 10 })).toEqual({
      percentage: 100,
      stageProcessed: 10,
      stageTotal: 10,
      overallProcessed: 10,
      overallTotal: 10,
      phase: 'first',
    })
    expect(progress({ processed: -1 })).toMatchObject({
      percentage: 0,
      stageProcessed: 0,
      overallProcessed: 0,
    })
  })

  it('does not show numeric progress during calibration or review', () => {
    expect(progress({ status: 'CALIBRATING' })).toBeNull()
    expect(progress({ status: 'REVIEW' })).toBeNull()
    expect(progress({ status: 'DONE', processed: 100 })).toBeNull()
    expect(progress({ candidateTotal: 0 })).toBeNull()
  })
})
