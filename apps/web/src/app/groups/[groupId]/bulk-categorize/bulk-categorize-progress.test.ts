import { describe, expect, it } from 'vitest'

import { getBulkCategorizationProgress } from './bulk-categorize-progress'

const progress = (
  overrides: Partial<Parameters<typeof getBulkCategorizationProgress>[0]> = {},
) =>
  getBulkCategorizationProgress({
    status: 'PROCESSING',
    candidateTotal: 100,
    currentMatches: 0,
    rerunCandidates: { uncertain: 0 },
    ...overrides,
  })

describe('getBulkCategorizationProgress', () => {
  it('counts confirmed calibration categories in the run total', () => {
    expect(progress({ currentMatches: 12 })).toEqual({
      categorized: 12,
      total: 100,
      percentage: 12,
    })
  })

  it('excludes General and low-strength matches from the count', () => {
    expect(
      progress({
        currentMatches: 50,
        rerunCandidates: { uncertain: 12 },
      }),
    ).toEqual({ categorized: 38, total: 100, percentage: 38 })
  })

  it('keeps one count through the first and second System One passes', () => {
    const firstPass = progress({
      status: 'PROCESSING',
      currentMatches: 50,
      rerunCandidates: { uncertain: 8 },
    })
    const secondPass = progress({
      status: 'PROCESSING',
      currentMatches: 50,
      rerunCandidates: { uncertain: 8 },
    })

    expect(firstPass).toEqual(secondPass)
    expect(secondPass?.categorized).toBe(42)
    expect(secondPass?.percentage).toBe(42)
  })

  it('advances when a low-strength match is upgraded during refinement', () => {
    const before = progress({
      currentMatches: 50,
      rerunCandidates: { uncertain: 20 },
    })
    const after = progress({
      currentMatches: 50,
      rerunCandidates: { uncertain: 18 },
    })

    expect(before?.categorized).toBe(30)
    expect(after?.categorized).toBe(32)
  })

  it('advances when a General expense gets a medium or high match', () => {
    const before = progress({ currentMatches: 40 })
    const after = progress({ currentMatches: 41 })

    expect(before?.categorized).toBe(40)
    expect(after?.categorized).toBe(41)
  })

  it('keeps already categorized matches as the baseline for a rerun', () => {
    expect(
      progress({
        status: 'QUEUED_RERUN',
        currentMatches: 80,
        rerunCandidates: { uncertain: 15 },
      }),
    ).toEqual({ categorized: 65, total: 100, percentage: 65 })

    expect(
      progress({
        status: 'RERUNNING',
        currentMatches: 81,
        rerunCandidates: { uncertain: 14 },
      }),
    ).toEqual({ categorized: 67, total: 100, percentage: 67 })
  })

  it('can complete below 100 percent when some matches remain weak or General', () => {
    expect(
      progress({
        currentMatches: 70,
        rerunCandidates: { uncertain: 20 },
      }),
    ).toEqual({ categorized: 50, total: 100, percentage: 50 })
  })

  it('clamps counts to the captured run size', () => {
    expect(progress({ candidateTotal: 10, currentMatches: 20 })).toEqual({
      categorized: 10,
      total: 10,
      percentage: 100,
    })
    expect(progress({ currentMatches: -1 })).toEqual({
      categorized: 0,
      total: 100,
      percentage: 0,
    })
  })

  it('does not show numeric progress during calibration or review', () => {
    expect(progress({ status: 'CALIBRATING' })).toBeNull()
    expect(progress({ status: 'REVIEW' })).toBeNull()
  })
})
