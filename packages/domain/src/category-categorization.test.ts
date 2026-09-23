import { describe, expect, it } from 'vitest'

import {
  categorizeLocally,
  categorizerChoiceBand,
  interpretCategorizerResult,
} from './category-categorization'
import { createCategorySearchDocumentsForLocale } from './category-search'

const documents = createCategorySearchDocumentsForLocale('en-US')

describe('shared categorization interpretation', () => {
  it('never promotes an alternative when the primary abstains', () => {
    const result = interpretCategorizerResult('system-one', null, [
      {
        categoryId: 'groceries',
        source: 'system-one',
        evidence: { kind: 'option-probability', value: 0.9 },
      },
    ])
    expect(result.categoryId).toBeNull()
    expect(result.alternatives).toHaveLength(1)
  })

  it('keeps a below-floor primary reviewable without selecting it', () => {
    const result = interpretCategorizerResult('local', {
      categoryId: 'groceries',
      source: 'dictionary',
      evidence: { kind: 'heuristic', value: 0.6, floor: 0.7 },
    })
    expect(result.categoryId).toBeNull()
    expect(result.primary?.categoryId).toBe('groceries')
    expect(categorizerChoiceBand(result.primary!)).toBe('none')
  })

  it('filters General and settlement from primary and alternatives', () => {
    const result = interpretCategorizerResult('system-one', null, [
      {
        categoryId: 'general',
        source: 'system-one',
        evidence: { kind: 'option-probability', value: 0.9 },
      },
      {
        categoryId: 'settlement',
        source: 'system-one',
        evidence: { kind: 'option-probability', value: 0.8 },
      },
      {
        categoryId: 'taxi',
        source: 'system-one',
        evidence: { kind: 'option-probability', value: 0.7 },
      },
    ])
    expect(result.alternatives.map((choice) => choice.categoryId)).toEqual([
      'taxi',
    ])
  })
})

describe('Local categorizer adapter', () => {
  it('uses the shared matcher and preserves typed heuristic strength', () => {
    const result = categorizeLocally({ title: 'uber', documents })
    expect(result.categoryId).toBe('taxi')
    expect(result.primary).toMatchObject({
      source: 'dictionary',
      evidence: { kind: 'heuristic' },
    })
  })

  it('uses a confirmed choice for the exact title and rejects a prior proposal only there', () => {
    const feedback = {
      positive: [{ title: 'uber', categoryId: 'groceries' as const }],
      rejected: [{ title: 'uber', rejectedCategoryId: 'taxi' as const }],
    }
    expect(
      categorizeLocally({ title: 'uber', documents, feedback }).categoryId,
    ).toBe('groceries')
    expect(
      categorizeLocally({ title: 'uber ride', documents, feedback }).categoryId,
    ).toBe('taxi')
  })

  it('uses confirmed choices as history hints for similar titles', () => {
    const result = categorizeLocally({
      title: 'Luigi mysterious trattori',
      documents,
      feedback: {
        positive: [
          { title: 'Luigi mysterious trattoria', categoryId: 'dining-out' },
          { title: 'Luigi mysterious trattoria', categoryId: 'dining-out' },
        ],
      },
    })
    expect(result.categoryId).toBe('dining-out')
    expect(result.primary?.source).toBe('history')
  })

  it('honors the Local engine settings and score floor', () => {
    const disabled = categorizeLocally({
      title: 'uber',
      documents,
      options: { dictionaryEnabled: false, historyEnabled: false },
    })
    expect(disabled.categoryId).toBeNull()
    const highFloor = categorizeLocally({
      title: 'uber',
      documents,
      options: { thresholds: { minScore: 0.8, settlementMinScore: 1 } },
    })
    expect(highFloor.primary?.evidence).toMatchObject({ floor: 0.8 })
  })
})
