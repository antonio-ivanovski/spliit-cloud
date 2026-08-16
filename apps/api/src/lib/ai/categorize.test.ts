import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('ai', async () => {
  const actual = await vi.importActual('ai')
  return { ...actual, generateText: vi.fn() }
})

vi.mock('../ai', () => ({ getModel: vi.fn() }))

const { generateText } = await import('ai')
const { getModel } = await import('../ai')
const {
  BULK_CATEGORIZATION_MAX_RETRIES,
  BULK_CATEGORIZATION_TIMEOUT_MS,
  buildCategorizationSystemPrompt,
  bulkPreviewResponseSchema,
  calibrationJsonSchema,
  calibrationResponseSchema,
  callBulkCategorizationModel,
  parseCategoryId,
} = await import('./categorize')

const generateTextMock = vi.mocked(generateText)
const getModelMock = vi.mocked(getModel)

beforeEach(() => {
  generateTextMock.mockReset()
  getModelMock.mockReset()
  getModelMock.mockResolvedValue({ modelId: 'test-model' } as never)
})

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

describe('callBulkCategorizationModel', () => {
  it('returns structured calibration output without reading text', async () => {
    const output = {
      needsFeedback: true,
      selections: [
        {
          expenseId: 'expense-1',
          suggestedCategoryId: 'groceries' as const,
          confidence: 'high' as const,
        },
      ],
    }
    generateTextMock.mockResolvedValue({ output } as never)

    await expect(
      callBulkCategorizationModel({
        operation: 'bulk-calibration',
        prompt: {
          model: 'configured-model',
          instructions: 'Classify expenses.',
          prompt: 'Expense candidates',
        },
        candidateCount: 1,
        priorFeedbackCount: 0,
        round: 1,
      }),
    ).resolves.toEqual(output)

    expect(getModelMock).toHaveBeenCalledWith('configured-model')
    expect(generateTextMock).toHaveBeenCalledWith(
      expect.objectContaining({
        output: expect.anything(),
        reasoning: 'none',
        maxRetries: BULK_CATEGORIZATION_MAX_RETRIES,
        timeout: BULK_CATEGORIZATION_TIMEOUT_MS,
      }),
    )
  })

  it('returns structured preview output when text is malformed', async () => {
    const output = {
      suggestions: [
        {
          expenseId: 'expense-2',
          suggestedCategoryId: 'dining-out' as const,
          confidence: 'medium' as const,
        },
      ],
    }
    generateTextMock.mockResolvedValue({
      output,
      text: 'this is not JSON',
    } as never)

    await expect(
      callBulkCategorizationModel({
        operation: 'bulk-preview',
        prompt: {
          model: 'configured-model',
          instructions: 'Classify expenses.',
          prompt: 'Expense candidates',
          temperature: 0,
        },
        candidateCount: 1,
        priorFeedbackCount: 0,
      }),
    ).resolves.toEqual(output)

    expect(generateTextMock).toHaveBeenCalledWith(
      expect.objectContaining({
        output: expect.anything(),
        temperature: 0,
        reasoning: 'none',
        maxRetries: BULK_CATEGORIZATION_MAX_RETRIES,
        timeout: BULK_CATEGORIZATION_TIMEOUT_MS,
      }),
    )
  })

  it('uses tolerant JSON parsing when the model lacks structured outputs', async () => {
    getModelMock.mockResolvedValue({
      modelId: 'compatible-model',
      supportsStructuredOutputs: false,
    } as never)
    generateTextMock.mockResolvedValue({
      output: {
        suggestions: [
          {
            expenseId: 'expense-3',
            suggestedCategoryId: 'groceries',
            confidence: ' High ',
          },
        ],
      },
    } as never)

    await expect(
      callBulkCategorizationModel({
        operation: 'bulk-preview',
        prompt: {
          model: 'compatible-model',
          instructions: 'Classify expenses.',
          prompt: 'Expense candidates',
        },
        candidateCount: 1,
        priorFeedbackCount: 0,
      }),
    ).resolves.toEqual({
      suggestions: [
        {
          expenseId: 'expense-3',
          suggestedCategoryId: 'groceries',
          confidence: 'high',
        },
      ],
    })

    expect(generateTextMock).toHaveBeenCalledWith(
      expect.objectContaining({
        output: expect.objectContaining({ name: 'json' }),
      }),
    )
  })

  it('propagates provider errors', async () => {
    const providerError = new Error('provider unavailable')
    generateTextMock.mockRejectedValue(providerError)

    await expect(
      callBulkCategorizationModel({
        operation: 'bulk-preview',
        prompt: {
          model: 'configured-model',
          instructions: 'Classify expenses.',
          prompt: 'Expense candidates',
        },
        candidateCount: 1,
        priorFeedbackCount: 0,
      }),
    ).rejects.toBe(providerError)
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
