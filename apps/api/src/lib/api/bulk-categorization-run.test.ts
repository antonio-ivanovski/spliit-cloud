import { describe, expect, it } from 'vitest'

import { DEFAULT_CATEGORY_ID } from '@spliit/domain'

import {
  buildCategorizationFeedback,
  calibrationDecision,
  changeRunSuggestion,
  finalReviewCorrections,
  getRerunCandidates,
  getRerunCandidateCounts,
  getRerunTargetCandidates,
  getAutomaticSystemOneTargets,
  mergeAutomaticSystemOneSuggestions,
  compareSystemOnePasses,
  hasUnsharedFinalReviewCorrection,
  mergeRerunSuggestions,
  nextCalibrationPhase,
  sampleCalibrationCandidates,
  scoreCalibrationRound,
  type Candidate,
  type Suggestion,
} from './bulk-categorization-run'

const candidates: Candidate[] = Array.from({ length: 120 }, (_, index) => ({
  id: `expense-${index}`,
  title: `Expense ${index}`,
  version: 1,
  expenseDate: new Date(Date.UTC(2025, 0, index + 1)).toISOString(),
  amount: 100,
  currency: 'USD',
}))

describe('calibration sampling and advancement', () => {
  it('scores General as an abstention and a missed match when corrected', () => {
    const sample = candidates.slice(0, 5).map((row, index): Suggestion => ({
      ...row,
      initialCategoryId: index < 3 ? 'food-and-drink' : DEFAULT_CATEGORY_ID,
      categoryId:
        index === 1 || index === 3
          ? 'transportation'
          : index === 2 || index === 4
            ? DEFAULT_CATEGORY_ID
            : 'food-and-drink',
      source: 'local',
      choices: [],
    }))
    expect(scoreCalibrationRound(sample, 1)).toEqual({
      round: 1,
      reviewed: 5,
      proposed: 3,
      accepted: 1,
      changed: 2,
      missed: 1,
      abstained: 1,
    })
  })

  it('spreads a sample across dates and never selects confirmed rows', () => {
    const excluded = new Set(['expense-0', 'expense-1', 'expense-2'])
    const sample = sampleCalibrationCandidates(
      candidates,
      excluded,
      12,
      () => 0,
    )
    expect(sample).toHaveLength(12)
    expect(sample.some((row) => excluded.has(row.id))).toBe(false)
    expect(
      new Date(sample.at(-1)!.expenseDate).getTime() -
        new Date(sample[0]!.expenseDate).getTime(),
    ).toBeGreaterThan(90 * 24 * 60 * 60 * 1000)
    expect(new Set(sample.map((row) => row.id)).size).toBe(12)
  })

  it('advances after adequate accurate coverage and caps poor rounds', () => {
    const confirmed = candidates.slice(0, 24).map((row): Suggestion => ({
      ...row,
      categoryId: 'food-and-drink',
      initialCategoryId: 'food-and-drink',
      source: 'local',
      choices: [],
    }))
    expect(
      calibrationDecision({
        total: 120,
        existingCategorized: 0,
        confirmed,
        metrics: [
          {
            round: 1,
            reviewed: 12,
            accepted: 10,
            changed: 0,
            missed: 0,
            abstained: 2,
            proposed: 10,
          },
          {
            round: 2,
            reviewed: 12,
            accepted: 10,
            changed: 0,
            missed: 0,
            abstained: 2,
            proposed: 10,
          },
        ],
      }),
    ).toBe('auto-full')
    expect(
      calibrationDecision({
        total: 120,
        existingCategorized: 0,
        confirmed,
        metrics: Array.from({ length: 4 }, (_, index) => ({
          round: index + 1,
          reviewed: 12,
          accepted: 2,
          changed: 8,
          missed: 2,
          abstained: 0,
          proposed: 10,
        })),
      }),
    ).toBe('offer-full')
    expect(nextCalibrationPhase('offer-full')).toBe('full')
    expect(
      calibrationDecision({
        total: 120,
        existingCategorized: 0,
        confirmed: confirmed.map((row) => ({
          ...row,
          categoryId: DEFAULT_CATEGORY_ID,
        })),
        metrics: [
          {
            round: 1,
            reviewed: 12,
            accepted: 2,
            changed: 8,
            missed: 2,
            abstained: 0,
            proposed: 10,
          },
        ],
      }),
    ).toBe('another-round')
    expect(
      calibrationDecision({
        total: 120,
        existingCategorized: 0,
        confirmed,
        metrics: [
          {
            round: 1,
            reviewed: 12,
            accepted: 0,
            changed: 0,
            missed: 0,
            abstained: 12,
            proposed: 0,
          },
        ],
      }),
    ).toBe('auto-full')
    expect(
      calibrationDecision({
        total: 120,
        existingCategorized: 0,
        confirmed,
        metrics: [
          {
            round: 1,
            reviewed: 12,
            accepted: 0,
            changed: 0,
            missed: 2,
            abstained: 10,
            proposed: 0,
          },
        ],
      }),
    ).toBe('another-round')
  })
})

describe('rerun corrections', () => {
  it('does not mark previously shared feedback as new after an unchanged choice', () => {
    const row: Suggestion = {
      ...candidates[0]!,
      categoryId: 'dining-out',
      initialCategoryId: 'food-and-drink',
      rerunFeedback: true,
      source: 'local',
      choices: [],
    }
    const calibration = {
      sample: [],
      confirmed: [],
      metrics: [],
      existingCategorized: 0,
      next: 'full' as const,
    }
    const unchanged = changeRunSuggestion(row, 'dining-out')
    expect(unchanged).toBe(row)
    expect(hasUnsharedFinalReviewCorrection([unchanged], calibration)).toBe(
      false,
    )
    const changed = changeRunSuggestion(row, 'groceries')
    expect(hasUnsharedFinalReviewCorrection([changed], calibration)).toBe(true)
    const undone = changeRunSuggestion(changed, 'food-and-drink')
    expect(hasUnsharedFinalReviewCorrection([undone], calibration)).toBe(false)
  })

  it('shares positive choices and limits rejected categories to the same title', () => {
    const rows: Suggestion[] = [
      {
        ...candidates[0]!,
        title: 'Corner Cafe',
        initialCategoryId: 'food-and-drink',
        categoryId: 'dining-out',
        source: 'local',
        choices: [],
      },
      {
        ...candidates[1]!,
        title: 'Taxi',
        initialCategoryId: 'transportation',
        categoryId: DEFAULT_CATEGORY_ID,
        source: 'local',
        choices: [],
      },
      {
        ...candidates[2]!,
        title: 'Unknown',
        initialCategoryId: DEFAULT_CATEGORY_ID,
        categoryId: DEFAULT_CATEGORY_ID,
        source: 'none',
        choices: [],
      },
    ]
    const feedback = buildCategorizationFeedback(rows, 'en-US')
    expect(feedback.positive).toEqual([
      { title: 'Corner Cafe', categoryId: 'dining-out' },
    ])
    expect(feedback.rejected).toEqual([
      { title: 'Corner Cafe', rejectedCategoryId: 'food-and-drink' },
      { title: 'Taxi', rejectedCategoryId: 'transportation' },
    ])
    expect(feedback.isRejected(' corner cafe ', 'food-and-drink')).toBe(true)
    expect(feedback.isRejected('Other Cafe', 'food-and-drink')).toBe(false)
  })

  it('keeps calibration and corrected rows out of reruns and requires new feedback', () => {
    const rows = [
      {
        ...candidates[0]!,
        categoryId: 'food-and-drink' as const,
        initialCategoryId: 'food-and-drink' as const,
        source: 'local' as const,
        choices: [],
      },
      {
        ...candidates[1]!,
        categoryId: DEFAULT_CATEGORY_ID,
        initialCategoryId: 'food-and-drink' as const,
        source: 'local' as const,
        choices: [],
      },
      {
        ...candidates[2]!,
        categoryId: DEFAULT_CATEGORY_ID,
        initialCategoryId: DEFAULT_CATEGORY_ID,
        source: 'none' as const,
        choices: [],
      },
      {
        ...candidates[3]!,
        categoryId: 'food-and-drink' as const,
        initialCategoryId: DEFAULT_CATEGORY_ID,
        source: 'system-one' as const,
        choices: [],
      },
    ] satisfies Suggestion[]
    const calibration = {
      sample: [],
      confirmed: [rows[0]!],
      metrics: [],
      existingCategorized: 0,
      next: 'full',
    }

    expect(
      finalReviewCorrections(rows, calibration).map((row) => row.id),
    ).toEqual(['expense-1', 'expense-3'])
    expect(getRerunCandidates(rows, calibration).map((row) => row.id)).toEqual([
      'expense-2',
    ])
    expect(hasUnsharedFinalReviewCorrection(rows, calibration)).toBe(true)
    expect(
      hasUnsharedFinalReviewCorrection(
        rows.map((row) => ({ ...row, rerunFeedback: true })),
        calibration,
      ),
    ).toBe(false)
  })

  it('reruns low-band automatic matches after the last General row is assigned', () => {
    const rows: Suggestion[] = [
      {
        ...candidates[0]!,
        categoryId: 'groceries',
        initialCategoryId: DEFAULT_CATEGORY_ID,
        source: 'system-one',
        choices: [],
      },
      {
        ...candidates[1]!,
        categoryId: 'taxi',
        initialCategoryId: 'taxi',
        source: 'system-one',
        choices: [
          {
            categoryId: 'taxi',
            confidence: 0.6,
            floor: 0.5,
            source: 'system-one',
          },
        ],
      },
      {
        ...candidates[2]!,
        categoryId: 'groceries',
        initialCategoryId: 'groceries',
        source: 'local',
        choices: [
          {
            categoryId: 'groceries',
            confidence: null,
            matchScore: 0.81,
            floor: 0.8,
            source: 'local',
          },
        ],
      },
      {
        ...candidates[3]!,
        categoryId: 'sports',
        initialCategoryId: 'sports',
        source: 'local',
        choices: [
          {
            categoryId: 'sports',
            confidence: null,
            matchScore: 0.98,
            floor: 0.8,
            source: 'local',
          },
        ],
      },
    ]
    const calibration = {
      sample: [],
      confirmed: [],
      metrics: [],
      existingCategorized: 0,
      next: 'full' as const,
    }
    expect(hasUnsharedFinalReviewCorrection(rows, calibration)).toBe(true)
    expect(getRerunCandidateCounts(rows, calibration)).toEqual({
      general: 0,
      uncertain: 2,
    })
    expect(getRerunCandidates(rows, calibration).map((row) => row.id)).toEqual([
      'expense-1',
      'expense-2',
    ])
    expect(
      mergeRerunSuggestions(rows, [
        { ...rows[1]!, categoryId: DEFAULT_CATEGORY_ID, source: 'none' },
      ])[1]?.categoryId,
    ).toBe(DEFAULT_CATEGORY_ID)
  })

  it('keeps older unscored local near-ties eligible but not clear local matches', () => {
    const rows: Suggestion[] = [
      {
        ...candidates[0]!,
        categoryId: 'sports',
        initialCategoryId: 'sports',
        source: 'local',
        choices: [
          { categoryId: 'sports', confidence: null, source: 'local' },
          { categoryId: 'clothing', confidence: null, source: 'local' },
        ],
      },
      {
        ...candidates[1]!,
        categoryId: 'taxi',
        initialCategoryId: 'taxi',
        source: 'local',
        choices: [{ categoryId: 'taxi', confidence: null, source: 'local' }],
      },
    ]
    expect(
      getRerunCandidates(rows, {
        sample: [],
        confirmed: [],
        metrics: [],
        existingCategorized: 0,
        next: 'full',
      }).map((row) => row.id),
    ).toEqual(['expense-0'])
  })

  it('keeps the original rerun target order after earlier chunks change categories', () => {
    const suggestions: Suggestion[] = candidates.slice(0, 2).map((row) => ({
      ...row,
      categoryId: DEFAULT_CATEGORY_ID,
      initialCategoryId: DEFAULT_CATEGORY_ID,
      source: 'none',
      choices: [],
    }))
    const calibration = {
      sample: [],
      confirmed: [],
      metrics: [],
      existingCategorized: 0,
      next: 'full' as const,
      rerunTargetIds: ['expense-0', 'expense-1'],
    }
    const changed = [
      { ...suggestions[0]!, categoryId: 'groceries' as const },
      suggestions[1]!,
    ]
    expect(
      getRerunTargetCandidates(
        candidates.slice(0, 2),
        changed,
        calibration,
      ).map((row) => row.id),
    ).toEqual(['expense-0', 'expense-1'])
  })
})

describe('automatic System One refinement', () => {
  const base = candidates.slice(0, 3).map((row, index): Suggestion => ({
    ...row,
    categoryId: index === 0 ? DEFAULT_CATEGORY_ID : 'taxi',
    initialCategoryId: index === 0 ? DEFAULT_CATEGORY_ID : 'taxi',
    source: 'system-one',
    choices:
      index === 0
        ? []
        : [
            {
              categoryId: 'taxi',
              confidence: index === 1 ? 0.55 : 0.95,
              floor: 0.5,
              source: 'system-one',
            },
          ],
  }))

  it('selects General and low-band System One rows only', () => {
    expect(getAutomaticSystemOneTargets(base).map((row) => row.id)).toEqual([
      'expense-0',
      'expense-1',
    ])
  })

  it('requires strong evidence for General and keeps an existing selection', () => {
    const additions: Suggestion[] = [
      {
        ...base[0]!,
        categoryId: 'groceries',
        initialCategoryId: 'groceries',
        choices: [
          { categoryId: 'groceries', confidence: 0.82, source: 'system-one' },
        ],
      },
      {
        ...base[1]!,
        categoryId: 'groceries',
        initialCategoryId: 'groceries',
        choices: [
          { categoryId: 'groceries', confidence: 0.9, source: 'system-one' },
        ],
      },
    ]
    const merged = mergeAutomaticSystemOneSuggestions(base, additions)
    expect(merged[0]).toMatchObject({
      categoryId: 'groceries',
      initialCategoryId: 'groceries',
      firstPass: { categoryId: 'general' },
      secondPass: { categoryId: 'groceries' },
    })
    expect(merged[1]?.categoryId).toBe('taxi')
    expect(merged[1]?.choices.map((choice) => choice.categoryId)).toContain(
      'groceries',
    )
    expect(merged[2]).toBe(base[2])
    expect(compareSystemOnePasses(merged)).toMatchObject({
      reviewed: 2,
      firstAccepted: 1,
      secondAccepted: 1,
    })
    const weak = mergeAutomaticSystemOneSuggestions(base, [
      {
        ...additions[0]!,
        choices: [
          { categoryId: 'groceries', confidence: 0.7, source: 'system-one' },
        ],
      },
    ])
    expect(weak[0]?.categoryId).toBe('general')
    expect(
      mergeRerunSuggestions(merged, [
        {
          ...merged[0]!,
          categoryId: 'taxi',
          firstPass: undefined,
          secondPass: undefined,
        },
      ])[0],
    ).toMatchObject({
      firstPass: { categoryId: 'general' },
      secondPass: { categoryId: 'groceries' },
    })
  })
})
