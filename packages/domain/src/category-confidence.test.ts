import { describe, expect, it } from 'vitest'

import { categoryConfidenceBand } from './category-confidence'

describe('category confidence bands', () => {
  it('splits the accepted range above the configured floor into thirds', () => {
    expect(categoryConfidenceBand(0.49, 0.5)).toBe('none')
    expect(categoryConfidenceBand(0.5, 0.5)).toBe('low')
    expect(categoryConfidenceBand(0.66, 0.5)).toBe('low')
    expect(categoryConfidenceBand(0.67, 0.5)).toBe('medium')
    expect(categoryConfidenceBand(0.84, 0.5)).toBe('high')
    expect(categoryConfidenceBand(0.81, 0.8)).toBe('low')
    expect(categoryConfidenceBand(0.9, 0.8)).toBe('medium')
    expect(categoryConfidenceBand(1, 1)).toBe('high')
  })
})
