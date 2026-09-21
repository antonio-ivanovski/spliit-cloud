import { describe, expect, it } from 'vitest'

import {
  AI_CANDIDATE_LIMIT,
  normalizeAiConfidences,
  suggestAiCandidates,
} from './suggest'

describe('suggestAiCandidates', () => {
  const distribution = [
    { id: 'liquor', probability: 0.6 },
    { id: 'dining-out', probability: 0.29 },
    { id: 'food-and-drink', probability: 0.11 },
    { id: 'entertainment', probability: 0.01 },
  ]

  it('keeps runners above the floor, strongest first, excluding the applied winner', () => {
    // коктели case: liquor applied at 0.6, dining-out 0.29 clears the 0.15
    // floor, food-and-drink 0.11 does not.
    expect(suggestAiCandidates(distribution, ['liquor'])).toEqual([
      { id: 'dining-out', score: 0.29, source: 'ai' },
    ])
  })

  it('includes the top pick on a miss path with no exclusions', () => {
    // Below-floor winner: nothing applied, top pick itself becomes a chip.
    const candidates = suggestAiCandidates(distribution)
    expect(candidates.map(({ id }) => id)).toEqual(['liquor', 'dining-out'])
  })

  it('returns nothing for a decisive verdict', () => {
    expect(
      suggestAiCandidates(
        [
          { id: 'taxi', probability: 0.97 },
          { id: 'transportation', probability: 0.03 },
        ],
        ['taxi'],
      ),
    ).toEqual([])
  })

  it('drops general, settlement, unknown ids and non-finite values', () => {
    expect(
      suggestAiCandidates([
        { id: 'general', probability: 0.5 },
        { id: 'settlement', probability: 0.4 },
        { id: 'nope', probability: 0.9 },
        { id: 'groceries', probability: Number.NaN },
        { id: 'movies', probability: 0.2 },
      ]),
    ).toEqual([{ id: 'movies', score: 0.2, source: 'ai' }])
  })

  it('caps at the limit with the strongest entries', () => {
    const many = [
      { id: 'movies', probability: 0.3 },
      { id: 'music', probability: 0.25 },
      { id: 'games', probability: 0.2 },
      { id: 'sports', probability: 0.18 },
    ]
    const candidates = suggestAiCandidates(many)
    expect(candidates).toHaveLength(AI_CANDIDATE_LIMIT)
    expect(candidates.map(({ id }) => id)).toEqual(['movies', 'music', 'games'])
  })
})

describe('normalizeAiConfidences', () => {
  it('rescales winner + runners to sum to 1', () => {
    const normalized = normalizeAiConfidences([
      { id: 'liquor', confidence: 0.6 },
      { id: 'dining-out', confidence: 0.3 },
    ])
    expect(normalized).toHaveLength(2)
    const total = normalized.reduce(
      (sum, { probability }) => sum + probability,
      0,
    )
    expect(total).toBeCloseTo(1)
    expect(normalized[0]?.id).toBe('liquor')
    expect(normalized[0]?.probability).toBeCloseTo(2 / 3)
  })

  it('drops raw crumbs so they cannot inflate into fake splits', () => {
    expect(
      normalizeAiConfidences([
        { id: 'liquor', confidence: 0.5 },
        { id: 'dining-out', confidence: 0.1 },
      ]),
    ).toEqual([{ id: 'liquor', probability: 1 }])
  })

  it('returns no distribution for empty or all-zero input', () => {
    expect(normalizeAiConfidences([])).toEqual([])
    expect(normalizeAiConfidences([{ id: 'liquor', confidence: 0 }])).toEqual(
      [],
    )
  })
})
