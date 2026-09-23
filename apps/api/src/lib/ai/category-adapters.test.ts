import { describe, expect, it } from 'vitest'

import { adaptSystemOneCategory, adaptLlmCategory } from './category-adapters'

describe('AI category adapters', () => {
  it('does not promote a System One runner-up after General', () => {
    const result = adaptSystemOneCategory(
      {
        categoryId: 'general',
        confidence: 0.95,
        probabilities: [{ categoryId: 'groceries', probability: 0.9 }],
      },
      0.5,
    )
    expect(result.categoryId).toBeNull()
    expect(result.alternatives[0]?.categoryId).toBe('groceries')
  })

  it('keeps a weak System One primary for review and uses only its confidence to select', () => {
    const result = adaptSystemOneCategory(
      {
        categoryId: 'groceries',
        confidence: 0.4,
        probabilities: [
          { categoryId: 'groceries', probability: 0.4 },
          { categoryId: 'dining-out', probability: 0.8 },
        ],
      },
      0.5,
    )
    expect(result.categoryId).toBeNull()
    expect(result.primary?.evidence.kind).toBe('model-confidence')
    expect(result.alternatives[0]?.categoryId).toBe('dining-out')
  })

  it('excludes rejected System One categories only for the supplied title', () => {
    const answer = {
      categoryId: 'groceries' as const,
      confidence: 0.9,
      probabilities: [{ categoryId: 'dining-out' as const, probability: 0.7 }],
    }
    expect(
      adaptSystemOneCategory(answer, 0.5, new Set(['groceries'])).categoryId,
    ).toBeNull()
    expect(adaptSystemOneCategory(answer, 0.5).categoryId).toBe('groceries')
  })

  it('labels LLM confidence separately from normalized alternative probabilities', () => {
    const result = adaptLlmCategory(
      {
        categoryId: 'groceries',
        confidence: 0.8,
        distribution: [
          { id: 'groceries', probability: 0.55 },
          { id: 'dining-out', probability: 0.45 },
        ],
      },
      0.5,
    )
    expect(result.categoryId).toBe('groceries')
    expect(result.primary?.evidence.kind).toBe('self-reported-confidence')
    expect(result.alternatives[0]?.evidence.kind).toBe('option-probability')
  })
})
