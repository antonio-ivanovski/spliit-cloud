import { afterEach, describe, expect, it, vi } from 'vitest'

// Capture generation arguments so we can assert on the actual instructions.
const captured: Array<{ instructions: string; prompt: string }> = []

vi.mock('./ai', () => ({
  getModel: vi.fn(async () => ({})),
}))

vi.mock('ai', () => ({
  generateText: vi.fn(
    async (args: { instructions: string; prompt: string }) => {
      captured.push(args)
      return { text: '"groceries"' }
    },
  ),
}))

vi.mock('./env', () => ({
  env: { AI_CATEGORY_MODEL: 'test-category-model' },
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

  it('returns the parsed category id', async () => {
    await expect(
      suggestCategoryWithAI('Luigi mysterious trattoria xyzzy'),
    ).resolves.toEqual({ categoryId: 'groceries' })
  })

  it('returns null when the model falls back to general', async () => {
    vi.mocked(generateText).mockResolvedValueOnce({
      text: 'general',
    } as never)
    await expect(
      suggestCategoryWithAI('Luigi mysterious trattoria xyzzy'),
    ).resolves.toEqual({ categoryId: null })
  })
})
