import { NoObjectGeneratedError } from 'ai'
import { afterEach, describe, expect, it, vi } from 'vitest'

// Capture generation arguments so we can assert on the actual instructions.
const captured: Array<{ instructions: string; prompt: string }> = []

vi.mock('./ai', () => ({
  getModel: vi.fn(async () => ({})),
}))

vi.mock('ai', async (importOriginal) => ({
  ...((await importOriginal()) as object),
  generateText: vi.fn(
    async (args: { instructions: string; prompt: string }) => {
      captured.push(args)
      return {
        text: '{"categoryId":"groceries","confidence":0.85}',
        output: { categoryId: 'groceries', confidence: 0.85 },
      }
    },
  ),
}))

vi.mock('./env', () => ({
  env: {
    AI_CATEGORY_MODEL: 'test-category-model',
    AI_CATEGORY_TIMEOUT_SECONDS: 30,
  },
}))

const { generateText } = await import('ai')
const { suggestCategoryWithAI } = await import('./expense-form-actions')

afterEach(() => {
  captured.length = 0
})

function instructions(promptIndex = 0): string {
  const entry = captured[promptIndex]
  if (!entry) throw new Error(`no captured call at index ${promptIndex}`)
  return entry.instructions
}

describe('suggestCategoryWithAI', () => {
  it('produces the baseline prompt when no options are provided', async () => {
    await suggestCategoryWithAI('Luigi mysterious trattoria xyzzy')
    const prompt = instructions()
    expect(prompt).not.toContain("user's app language")
    expect(prompt).not.toContain('Group context')
    expect(prompt).not.toContain('Past expenses in this group')
    expect(prompt).toContain('Task: Receive expense titles')
    expect(prompt).toContain('Boundaries:')
    expect(captured[0]!.prompt).toBe('Luigi mysterious trattoria xyzzy')
  })

  it('does not offer settlement as an AI category', async () => {
    await suggestCategoryWithAI('Luigi mysterious trattoria xyzzy')
    expect(instructions()).not.toContain('settlement')
  })

  it('includes a soft-hint locale line when locale is provided', async () => {
    await suggestCategoryWithAI('Luigi mysterious trattoria xyzzy', {
      locale: 'es',
    })
    const prompt = instructions()
    expect(prompt).toContain("user's app language is Español")
    expect(prompt).toContain('hint, not a rule')
    expect(prompt).not.toMatch(/title (?:is|must be) in .+Español/i)
  })

  it('omits locale hint for unknown locales', async () => {
    await suggestCategoryWithAI('Luigi mysterious trattoria xyzzy', {
      locale: 'xx',
    })
    expect(instructions()).not.toContain("user's app language")
  })

  it('includes a group context section when groupContext is provided', async () => {
    await suggestCategoryWithAI('Luigi mysterious trattoria xyzzy', {
      groupContext: {
        name: 'Paris Weekend',
        currency: '$',
        currencyCode: 'EUR',
      },
    })
    const prompt = instructions()
    expect(prompt).toContain('Group context')
    expect(prompt).toContain('Paris Weekend')
    expect(prompt).toContain('EUR')
  })

  it('falls back to the currency symbol when currencyCode is null', async () => {
    await suggestCategoryWithAI('Luigi mysterious trattoria xyzzy', {
      groupContext: { name: 'Bottle Club', currency: '⛁', currencyCode: null },
    })
    const prompt = instructions()
    expect(prompt).toContain('Bottle Club')
    expect(prompt).toContain('⛁')
  })

  it('includes a past-expenses section when recentExpenses are provided', async () => {
    await suggestCategoryWithAI('Luigi mysterious trattoria xyzzy', {
      recentExpenses: [
        { title: 'Mercadona', categoryId: 'groceries' },
        { title: 'Uber', categoryId: 'taxi' },
      ],
    })
    const prompt = instructions()
    expect(prompt).toContain('Past expenses in this group')
    expect(prompt).toContain('"Mercadona" -> groceries')
    expect(prompt).toContain('"Uber" -> taxi')
  })

  it('combines group context, locale hint, and past-expenses section when all are provided', async () => {
    await suggestCategoryWithAI('Luigi mysterious trattoria xyzzy', {
      locale: 'es',
      groupContext: { name: 'Madrid Trip', currency: '$', currencyCode: 'EUR' },
      recentExpenses: [{ title: 'Café', categoryId: 'dining-out' }],
    })
    const prompt = instructions()
    expect(prompt).toContain('Madrid Trip')
    expect(prompt).toContain("user's app language is Español")
    expect(prompt).toContain('"Café" -> dining-out')
  })

  it('truncates user input to 40 characters', async () => {
    const longTitle = 'a'.repeat(100)
    await suggestCategoryWithAI(longTitle)
    expect(captured[0]!.prompt).toBe('a'.repeat(40))
  })

  it('asks for a JSON verdict with confidence', async () => {
    await suggestCategoryWithAI('Luigi mysterious trattoria xyzzy')
    const prompt = instructions()
    expect(prompt).toContain('JSON object')
    expect(prompt).toContain('confidence')
  })

  it('returns the parsed category id with its confidence', async () => {
    await expect(
      suggestCategoryWithAI('Luigi mysterious trattoria xyzzy'),
    ).resolves.toEqual({
      categoryId: 'groceries',
      confidence: 0.85,
      distribution: [{ id: 'groceries', probability: 1 }],
    })
  })

  it('returns null but preserves confidence when the model falls back to general', async () => {
    vi.mocked(generateText).mockResolvedValueOnce({
      text: '{"categoryId":"general","confidence":0.9}',
      output: { categoryId: 'general', confidence: 0.9 },
    } as never)
    await expect(
      suggestCategoryWithAI('Luigi mysterious trattoria xyzzy'),
    ).resolves.toEqual({ categoryId: null, confidence: 0.9, distribution: [] })
  })

  it('falls back to plain-text ID extraction with confidence 0 when JSON output throws', async () => {
    // A model without JSON-mode makes Output.json() raise
    // NoObjectGeneratedError carrying the raw text.
    vi.mocked(generateText).mockRejectedValueOnce(
      new NoObjectGeneratedError({
        message: 'No object generated',
        text: 'groceries',
      }),
    )
    await expect(
      suggestCategoryWithAI('Luigi mysterious trattoria xyzzy'),
    ).resolves.toEqual({
      categoryId: 'groceries',
      confidence: 0,
      distribution: [],
    })
  })

  it('falls back to plain-text ID extraction with confidence 0 when the verdict output is missing', async () => {
    vi.mocked(generateText).mockResolvedValueOnce({
      text: 'groceries',
      output: undefined,
    } as never)
    await expect(
      suggestCategoryWithAI('Luigi mysterious trattoria xyzzy'),
    ).resolves.toEqual({
      categoryId: 'groceries',
      confidence: 0,
      distribution: [],
    })
  })

  it('asks for runner-up categories with independent confidences', async () => {
    await suggestCategoryWithAI('Luigi mysterious trattoria xyzzy')
    expect(instructions()).toContain('runnersUp')
    expect(instructions()).toContain('need not sum to 1')
  })

  it('normalizes winner + validated runners into a distribution', async () => {
    vi.mocked(generateText).mockResolvedValueOnce({
      text: '{"categoryId":"liquor","confidence":0.6}',
      output: {
        categoryId: 'liquor',
        confidence: 0.6,
        runnersUp: [
          { categoryId: 'dining-out', confidence: 0.3 },
          { categoryId: 'general', confidence: 0.9 },
          { categoryId: 'nope', confidence: 0.5 },
          { categoryId: 'liquor', confidence: 0.4 },
          { categoryId: 'movies', confidence: 1.5 },
        ],
      },
    } as never)
    // general / unknown / winner-dupe dropped, 1.5 clamped to 1.
    const total = 0.6 + 0.3 + 1
    await expect(
      suggestCategoryWithAI('Luigi mysterious trattoria xyzzy'),
    ).resolves.toEqual({
      categoryId: 'liquor',
      confidence: 0.6,
      distribution: [
        { id: 'liquor', probability: 0.6 / total },
        { id: 'dining-out', probability: 0.3 / total },
        { id: 'movies', probability: 1 / total },
      ],
    })
  })

  it('returns no distribution when the winner is a no-match', async () => {
    vi.mocked(generateText).mockResolvedValueOnce({
      text: '{"categoryId":"general","confidence":0.4}',
      output: {
        categoryId: 'general',
        confidence: 0.4,
        runnersUp: [{ categoryId: 'liquor', confidence: 0.8 }],
      },
    } as never)
    await expect(
      suggestCategoryWithAI('Luigi mysterious trattoria xyzzy'),
    ).resolves.toEqual({ categoryId: null, confidence: 0.4, distribution: [] })
  })

  it('bounds the provider call with the configured timeout and no retries', async () => {
    await suggestCategoryWithAI('Luigi mysterious trattoria xyzzy')

    const request = vi.mocked(generateText).mock.calls.at(-1)?.[0] as {
      maxRetries?: number
      timeout?: number
    }
    expect(request.maxRetries).toBe(0)
    expect(request.timeout).toBe(30_000)
  })
})
