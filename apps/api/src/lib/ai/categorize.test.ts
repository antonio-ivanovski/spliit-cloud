import { describe, expect, it } from 'vitest'
import {
  buildCategorizationSystemPrompt,
  bulkPreviewResponseSchema,
  calibrationJsonSchema,
  calibrationResponseSchema,
  parseCategoryId,
} from './categorize'

describe('buildCategorizationSystemPrompt', () => {
  it('emits the category allowlist and fallback', () => {
    const prompt = buildCategorizationSystemPrompt({})
    expect(prompt).toContain('Categories:')
    expect(prompt).toContain('(ID: groceries)')
    expect(prompt).toContain('Fallback:')
    expect(prompt).toContain('Boundaries:')
  })

  it('skips optional sections when context is missing', () => {
    const prompt = buildCategorizationSystemPrompt({})
    expect(prompt).not.toContain('Group context')
    expect(prompt).not.toContain("user's app language")
    expect(prompt).not.toContain('Past expenses')
  })

  it('includes optional sections when provided', () => {
    const prompt = buildCategorizationSystemPrompt({
      locale: 'es',
      groupContext: { name: 'Trip', currency: '$', currencyCode: 'EUR' },
      recentExpenses: [
        { title: 'Mercadona', categoryId: 'groceries' },
        { title: 'Uber', categoryId: 'taxi' },
      ],
    })
    expect(prompt).toContain('Trip')
    expect(prompt).toContain('EUR')
    expect(prompt).toContain("user's app language is Español")
    expect(prompt).toContain('"Mercadona" -> groceries')
    expect(prompt).toContain('"Uber" -> taxi')
  })
})

describe('calibration JSON schema', () => {
  it('round-trips through Zod', () => {
    const parsed = calibrationResponseSchema.parse({
      needsFeedback: true,
      selections: [
        {
          expenseId: 'abc',
          suggestedCategoryId: 'groceries',
          confidence: 'high',
        },
      ],
    })
    expect(parsed.selections[0]?.suggestedCategoryId).toBe('groceries')
  })

  it('rejects unknown category ids', () => {
    expect(() =>
      calibrationResponseSchema.parse({
        needsFeedback: false,
        selections: [
          {
            expenseId: 'abc',
            suggestedCategoryId: 'unknown',
            confidence: 'high',
          },
        ],
      }),
    ).toThrow()
  })

  it('uses schema constants that line up with the JSON schema', () => {
    expect(calibrationJsonSchema.required).toContain('selections')
    expect(
      (calibrationJsonSchema.properties as Record<string, unknown>).selections,
    ).toBeDefined()
  })
})

describe('bulk preview schemas', () => {
  it('parses suggestions with valid category ids', () => {
    const parsed = bulkPreviewResponseSchema.parse({
      suggestions: [
        {
          expenseId: 'x',
          suggestedCategoryId: 'dining-out',
          confidence: 'high',
        },
      ],
    })
    expect(parsed.suggestions[0]?.confidence).toBe('high')
  })

  it('rejects unknown confidence values', () => {
    expect(() =>
      bulkPreviewResponseSchema.parse({
        suggestions: [
          {
            expenseId: 'x',
            suggestedCategoryId: 'dining-out',
            confidence: 'unsure',
          },
        ],
      }),
    ).toThrow()
  })

  it('normalizes confidence casing and whitespace', () => {
    expect(
      bulkPreviewResponseSchema.parse({
        suggestions: [
          {
            expenseId: 'x',
            suggestedCategoryId: 'dining-out',
            confidence: ' High ',
          },
        ],
      }),
    ).toEqual({
      suggestions: [
        {
          expenseId: 'x',
          suggestedCategoryId: 'dining-out',
          confidence: 'high',
        },
      ],
    })
  })
})

describe('parseCategoryId', () => {
  it('returns the input when it matches an allowed id', () => {
    expect(parseCategoryId('groceries')).toBe('groceries')
  })

  it('falls back to the default id on garbage input', () => {
    expect(parseCategoryId('not-a-real-category')).toBe('general')
    expect(parseCategoryId(null)).toBe('general')
    expect(parseCategoryId(undefined)).toBe('general')
    expect(parseCategoryId('<think>unknown</think>')).toBe('general')
  })
})
